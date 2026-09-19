"""Durable, idempotent clothing uploads. Mobile requests never wait for inference."""
import asyncio
import hashlib
import io
import logging
import os
import re
import struct
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
MAX_CONCURRENT = 3
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


def shrink_for_vision(photo: bytes, max_edge: int = 768) -> bytes:
    try:
        with Image.open(io.BytesIO(photo)) as image:
            if max(image.size) <= max_edge:
                return photo
            image = image.convert("RGB")
            image.thumbnail((max_edge, max_edge))
            output = io.BytesIO()
            image.save(output, "JPEG", quality=82)
            return output.getvalue()
    except Exception:
        return photo


async def cutout_photo(raw: bytes) -> Optional[bytes]:
    return await cutout_service.cutout(raw)


class CutoutService:
    """One warm rembg subprocess (model loaded once). A photo that exceeds the time limit
    gets the process killed and respawned, so a stuck cutout can never wedge the queue."""

    def __init__(self):
        self.process = None
        self.lock = asyncio.Lock()

    async def _spawn(self):
        process = await asyncio.create_subprocess_exec(
            sys.executable, str(Path(__file__).with_name("cutout_worker.py")), "--serve",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env={**os.environ, "OMP_NUM_THREADS": "4", "OPENBLAS_NUM_THREADS": "4"},
        )
        try:
            await asyncio.wait_for(process.stdout.readexactly(4), 90)  # model loaded
        except BaseException:
            process.kill()
            raise
        self.process = process
        logger.info("cutout worker warm pid=%s", process.pid)

    async def _kill(self):
        process, self.process = self.process, None
        if process is None or process.returncode is not None:
            return
        try:
            process.kill()
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(process.wait(), timeout=5)
        except asyncio.TimeoutError:
            logger.warning("cutout worker did not exit within 5s after kill")

    async def warm(self):
        try:
            async with self.lock:
                if self.process is None or self.process.returncode is not None:
                    await self._spawn()
        except Exception as exc:
            logger.warning("cutout worker could not start type=%s", type(exc).__name__)

    async def cutout(self, raw: bytes) -> Optional[bytes]:
        async with self.lock:
            try:
                if self.process is None or self.process.returncode is not None:
                    await self._spawn()
                process = self.process
                process.stdin.write(struct.pack(">I", len(raw)) + raw)
                await asyncio.wait_for(process.stdin.drain(), CUTOUT_TIMEOUT)
                header = await asyncio.wait_for(process.stdout.readexactly(4), CUTOUT_TIMEOUT)
                size = struct.unpack(">I", header)[0]
                if size == 0:
                    logger.warning("cutout unavailable for this photo; keeping original")
                    return None
                png = await asyncio.wait_for(process.stdout.readexactly(size), CUTOUT_TIMEOUT)
                return png if png.startswith(b"\x89PNG") else None
            except asyncio.TimeoutError:
                logger.warning("cutout exceeded %ss; restarting worker, keeping original", CUTOUT_TIMEOUT)
                await self._kill()
                return None
            except asyncio.CancelledError:
                await self._kill()
                raise
            except Exception as exc:
                logger.warning("cutout failed type=%s; restarting worker, keeping original", type(exc).__name__)
                await self._kill()
                return None

    async def stop(self):
        await self._kill()


cutout_service = CutoutService()


class UploadJobs:
    def __init__(self, db, tag, put, get, app_name):
        self.db, self.tag, self.put, self.get, self.app_name = db, tag, put, get, app_name
        self.worker = None
        self.inflight = set()
        self.wake = asyncio.Event()      # accept() sets it so processing starts immediately
        self.changed = asyncio.Event()   # process() sets it so long-polling clients return at once

    def identity(self, user_id, job_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,80}", job_id):
            raise HTTPException(400, "Invalid upload reference")
        return {"user_id": user_id, "id": job_id}

    async def result(self, user_id, job_id, wait: float = 0):
        """Current job state. With `wait`, holds the request until the job settles (or the wait ends),
        so the phone learns the result the moment it is ready instead of on its next poll."""
        deadline = asyncio.get_running_loop().time() + min(max(wait, 0), 25)
        while True:
            result = await self._result(user_id, job_id)
            remaining = deadline - asyncio.get_running_loop().time()
            if result.status in ("complete", "failed", "upload_failed") or remaining <= 0:
                return result
            self.changed.clear()
            try:
                await asyncio.wait_for(self.changed.wait(), min(remaining, 1.0))
            except asyncio.TimeoutError:
                pass

    async def _result(self, user_id, job_id):
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
            self.wake.set()
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
            # A smaller copy is enough for tagging and cuts vision latency (fewer image tokens to upload/process).
            small = await run_in_threadpool(shrink_for_vision, photo)
            return await asyncio.wait_for(self.tag(small), TAG_TIMEOUT)
        except Exception as exc:
            logger.warning("tagging unavailable type=%s", type(exc).__name__)
            return {}

    async def process(self, job):
        query = {"id": job["id"], "user_id": job["user_id"], "owner": job["owner"]}
        try:
            photo, _ = await asyncio.wait_for(run_in_threadpool(self.get, job["original_path"]), STORAGE_TIMEOUT)
            await self.db.upload_jobs.update_one(query, {"$set": {"stage": "analysing"}})
            self.changed.set()
            timed = asyncio.get_running_loop().time()
            tags, cutout = await asyncio.gather(self.tag_bounded(photo), cutout_photo(photo))
            logger.info("upload processed job=%s tag+cutout=%.2fs", job["id"], asyncio.get_running_loop().time() - timed)
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

    async def _run_one(self, job):
        try:
            await asyncio.wait_for(self.process(job), timeout=100)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("upload job crashed job=%s", job["id"])
        finally:
            self.changed.set()

    async def run(self):
        while True:
            try:
                if len(self.inflight) >= MAX_CONCURRENT:
                    await asyncio.wait(self.inflight, return_when=asyncio.FIRST_COMPLETED)
                    continue
                self.wake.clear()
                job = await self.db.upload_jobs.find_one_and_update(
                    {"$or": [{"status": "queued"}, {"status": "processing", "lease_until": {"$lt": now()}}]},
                    {"$set": {"status": "processing", "stage": "analysing", "owner": uuid.uuid4().hex,
                              "lease_until": now() + timedelta(seconds=150)}},
                    sort=[("created_at", 1)], projection={"_id": 0}, return_document=ReturnDocument.AFTER)
                if job:
                    task = asyncio.create_task(self._run_one(job))
                    self.inflight.add(task)
                    task.add_done_callback(self.inflight.discard)
                else:
                    try:
                        await asyncio.wait_for(self.wake.wait(), 1.0)
                    except asyncio.TimeoutError:
                        pass
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
        asyncio.create_task(cutout_service.warm())  # load the model before the first photo arrives

    async def stop(self):
        tasks = [t for t in [self.worker, *self.inflight] if t]
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
        await cutout_service.stop()