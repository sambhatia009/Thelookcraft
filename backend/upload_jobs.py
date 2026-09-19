"""Durable, idempotent clothing uploads. Mobile requests never wait for inference."""
import asyncio
import hashlib
import io
import logging
import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger("stylevault.uploads")
MAX_BYTES = 16 * 1024 * 1024
TAG_TIMEOUT = 25
CUTOUT_TIMEOUT = 25
STORAGE_TIMEOUT = 25


def now():
    return datetime.now(timezone.utc)


class UploadJobResult(BaseModel):
    id: str
    status: str
    stage: str
    item: Optional[dict] = None
    error: Optional[str] = None


def normalize_photo(raw: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.width * source.height > 40_000_000:
                raise HTTPException(413, "Photo resolution is too large. Choose a smaller photo.")
            source = ImageOps.exif_transpose(source)
            source.thumbnail((1280, 1280))
            image = source.convert("RGB")
            output = io.BytesIO()
            image.save(output, "JPEG", quality=85)
            return output.getvalue()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(400, "This photo could not be read. Choose a JPEG or PNG photo.")


async def cutout_photo(raw: bytes) -> Optional[bytes]:
    # Unlike a timed-out thread, a subprocess can actually be stopped and free its memory.
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(Path(__file__).with_name("cutout_worker.py")),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"},
        )
    except OSError:
        logger.warning("cutout could not start; keeping original")
        return None
    try:
        output, errors = await asyncio.wait_for(process.communicate(raw), CUTOUT_TIMEOUT)
        if process.returncode == 0 and output.startswith(b"\x89PNG"):
            return output
        logger.warning("cutout unavailable exit=%s details=%s", process.returncode, errors.decode(errors="replace")[-200:])
        return None
    except asyncio.TimeoutError:
        logger.warning("cutout exceeded %ss; keeping original", CUTOUT_TIMEOUT)
        return None
    except Exception as exc:
        logger.warning("cutout failed type=%s; keeping original", type(exc).__name__)
        return None
    finally:
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            logger.warning("cutout cleanup exceeded 5s after kill; continuing with original")


class UploadJobs:
    def __init__(self, db, tag, put, get, app_name):
        self.db, self.tag, self.put, self.get, self.app_name = db, tag, put, get, app_name
        self.worker = None

    def identity(self, user_id, job_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", job_id):
            raise HTTPException(400, "Invalid upload reference")
        return {"user_id": user_id, "id": job_id}

    async def result(self, user_id, job_id):
        doc = await self.db.upload_jobs.find_one(self.identity(user_id, job_id), {"_id": 0})
        if not doc:
            raise HTTPException(404, "Upload not found")
        # A server interruption during receipt must not leave a permanent spinner.
        expired = await self.db.upload_jobs.update_one(
            {**self.identity(user_id, job_id), "status": "receiving", "lease_until": {"$lt": now()}},
            {"$set": {"status": "upload_failed", "stage": "failed",
                      "error": "Photo transfer was interrupted. Tap Try Again to send the same photo."}},
        )
        if expired.modified_count:
            doc = await self.db.upload_jobs.find_one(self.identity(user_id, job_id), {"_id": 0})
        item = None
        if doc["status"] == "complete":
            item = await self.db.items.find_one({"id": doc["item_id"], "user_id": user_id, "deleted_at": None}, {"_id": 0})
            if not item:
                raise HTTPException(410, "This uploaded item was removed. Choose another photo.")
        return UploadJobResult(id=job_id, status=doc["status"], stage=doc["stage"], item=item, error=doc.get("error"))

    async def accept(self, user_id, job_id, raw):
        query = self.identity(user_id, job_id)
        if not raw:
            raise HTTPException(400, "Empty image")
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, "Photo is too large. Choose a photo smaller than 16 MB.")
        digest = hashlib.sha256(raw).hexdigest()
        existing = await self.db.upload_jobs.find_one(query, {"_id": 0})
        if existing and existing["digest"] != digest:
            raise HTTPException(409, "This upload reference belongs to another photo.")
        if existing and existing["status"] in ("queued", "processing", "complete"):
            return await self.result(user_id, job_id)
        photo = await run_in_threadpool(normalize_photo, raw)
        item_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{user_id}:{job_id}"))
        initial = {**query, "item_id": item_id, "digest": digest, "status": "receiving", "stage": "uploading",
                   "created_at": now(), "lease_until": now(), "original_path": f"{self.app_name}/uploads/{user_id}/{item_id}-original.jpg"}
        try:
            await self.db.upload_jobs.update_one(query, {"$setOnInsert": initial}, upsert=True)
        except DuplicateKeyError:
            pass
        owner = uuid.uuid4().hex
        claimed = await self.db.upload_jobs.find_one_and_update(
            {**query, "digest": digest, "$or": [{"status": {"$in": ["upload_failed", "failed"]}},
                                                     {"status": "receiving", "lease_until": {"$lte": now()}}]},
            {"$set": {"status": "receiving", "stage": "uploading", "owner": owner,
                      "lease_until": now() + timedelta(seconds=60), "error": None}},
            return_document=ReturnDocument.AFTER, projection={"_id": 0},
        )
        if not claimed:
            persisted = await self.db.upload_jobs.find_one(query, {"_id": 0})
            if persisted and persisted["digest"] != digest:
                raise HTTPException(409, "This upload reference belongs to another photo.")
            return await self.result(user_id, job_id)
        started = asyncio.get_running_loop().time()
        try:
            stored = await asyncio.wait_for(run_in_threadpool(self.put, claimed["original_path"], photo, "image/jpeg"), STORAGE_TIMEOUT)
            await self.db.upload_jobs.update_one({**query, "owner": owner}, {"$set": {
                "status": "queued", "stage": "queued", "original_path": stored["path"], "updated_at": now(), "error": None,
            }})
            logger.info("upload accepted job=%s input_bytes=%s stored_bytes=%s duration=%.2fs", job_id, len(raw), len(photo), asyncio.get_running_loop().time() - started)
        except Exception as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            message = "Photo storage is temporarily unavailable. Your photo is kept on this screen; tap Try Again."
            if status == 402:
                message = "Photo storage is unavailable for this account. Please contact the app owner."
            await self.db.upload_jobs.update_one({**query, "owner": owner}, {"$set": {"status": "upload_failed", "error": message}})
            logger.warning("upload storage failed job=%s type=%s status=%s", job_id, type(exc).__name__, status)
            raise HTTPException(402 if status == 402 else 503, message)
        return await self.result(user_id, job_id)

    async def tag_bounded(self, photo):
        try:
            return await asyncio.wait_for(self.tag(photo), TAG_TIMEOUT)
        except Exception as exc:
            logger.warning("tagging unavailable type=%s", type(exc).__name__)
            return {}

    async def process(self, job):
        query = {"id": job["id"], "user_id": job["user_id"], "owner": job["owner"]}
        try:
            photo, _ = await asyncio.wait_for(run_in_threadpool(self.get, job["original_path"]), STORAGE_TIMEOUT)
            await self.db.upload_jobs.update_one(query, {"$set": {"stage": "analysing"}})
            tags, cutout = await asyncio.gather(self.tag_bounded(photo), cutout_photo(photo))
            warning = []
            path = job["original_path"]
            if cutout:
                await self.db.upload_jobs.update_one(query, {"$set": {"stage": "saving"}})
                try:
                    stored = await asyncio.wait_for(run_in_threadpool(self.put, f"{self.app_name}/uploads/{job['user_id']}/{job['item_id']}.png", cutout, "image/png"), STORAGE_TIMEOUT)
                    path = stored["path"]
                except Exception:
                    cutout = None
            if not cutout:
                warning.append("Background removal was unavailable; your original photo was kept.")
            if not tags.get("name"):
                warning.append("Automatic tags were unavailable. Please enter the item details below.")
            item = {"id": job["item_id"], "user_id": job["user_id"], "name": tags.get("name") or "New Item",
                    "category": tags.get("category") if tags.get("category") in ("Tops", "Bottoms", "Outerwear", "Shoes", "Accessories") else "Tops",
                    **{k: tags.get(k) or "" for k in ("subcategory", "color", "formality", "fabric", "season")},
                    "storage_path": path, "original_storage_path": job["original_path"], "image_url": None,
                    "processing_warning": " ".join(warning) or None, "background_removed": bool(cutout),
                    "is_mock": False, "deleted_at": None, "created_at": now()}
            # Deterministic item ID + unique index means a retry/restart cannot create duplicates.
            await self.db.items.update_one({"id": item["id"], "user_id": item["user_id"]}, {"$setOnInsert": item}, upsert=True)
            await self.db.upload_jobs.update_one(query, {"$set": {"status": "complete", "stage": "ready", "error": None, "updated_at": now()}})
            logger.info("upload complete job=%s background_removed=%s auto_tagged=%s", job["id"], bool(cutout), bool(tags.get("name")))
        except asyncio.CancelledError:
            await self.db.upload_jobs.update_one(query, {"$set": {"status": "queued", "stage": "queued"}})
            raise
        except Exception as exc:
            logger.exception("upload processing failed job=%s type=%s", job["id"], type(exc).__name__)
            await self.db.upload_jobs.update_one(query, {"$set": {"status": "failed", "stage": "failed",
                "error": "Processing was interrupted. Your photo is safe; tap Try Again.", "updated_at": now()}})

    async def run(self):
        while True:
            try:
                job = await self.db.upload_jobs.find_one_and_update(
                    {"$or": [{"status": "queued"}, {"status": "processing", "lease_until": {"$lt": now()}}]},
                    {"$set": {"status": "processing", "stage": "analysing", "owner": uuid.uuid4().hex,
                              "lease_until": now() + timedelta(seconds=150)}},
                    sort=[("created_at", 1)], projection={"_id": 0}, return_document=ReturnDocument.AFTER)
                if job:
                    await asyncio.wait_for(self.process(job), timeout=100)
                else:
                    await asyncio.sleep(1)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("upload worker recovering")
                await asyncio.sleep(2)

    async def start(self):
        await self.db.upload_jobs.create_index([("user_id", 1), ("id", 1)], unique=True)
        await self.db.upload_jobs.create_index([("status", 1), ("created_at", 1)])
        await self.db.items.create_index([("user_id", 1), ("id", 1)], unique=True)
        self.worker = asyncio.create_task(self.run())

    async def stop(self):
        if self.worker:
            self.worker.cancel()
            try:
                await self.worker
            except asyncio.CancelledError:
                pass