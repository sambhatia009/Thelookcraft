"""Upload jobs fault-injection tests (iter9): timeout/fallback behavior without production integration mocking."""

import sys
import asyncio
from datetime import timedelta
from pathlib import Path

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))
from upload_jobs import UploadJobs
import upload_jobs as upload_jobs_module


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _FakeCollection:
    def __init__(self):
        self.docs = {}

    async def update_one(self, query, update, upsert=False):
        key = (query.get("user_id"), query.get("id"))
        doc = self.docs.get(key, {"id": query.get("id"), "user_id": query.get("user_id")})
        if "$set" in update:
            doc.update(update["$set"])
        if "$setOnInsert" in update and (upsert and key not in self.docs):
            doc.update(update["$setOnInsert"])
        self.docs[key] = doc

    async def find_one(self, query, projection=None):
        key = (query.get("user_id"), query.get("id"))
        return self.docs.get(key)


class _FakeItems:
    def __init__(self):
        self.docs = {}

    async def update_one(self, query, update, upsert=False):
        key = (query.get("user_id"), query.get("id"))
        if key not in self.docs and upsert and "$setOnInsert" in update:
            self.docs[key] = dict(update["$setOnInsert"])

    async def find_one(self, query, projection=None):
        return self.docs.get((query.get("user_id"), query.get("id")))


class _FakeDB:
    def __init__(self):
        self.upload_jobs = _FakeCollection()
        self.items = _FakeItems()


class _ResultCollection:
    def __init__(self, doc):
        self.doc = dict(doc)

    async def find_one(self, query, projection=None):
        if self.doc.get("id") == query.get("id") and self.doc.get("user_id") == query.get("user_id"):
            return dict(self.doc)
        return None

    async def update_one(self, query, update, upsert=False):
        modified = 0
        lease_filter = query.get("lease_until", {}).get("$lt")
        if (
            self.doc.get("id") == query.get("id")
            and self.doc.get("user_id") == query.get("user_id")
            and self.doc.get("status") == query.get("status")
            and lease_filter is not None
            and self.doc.get("lease_until") < lease_filter
        ):
            self.doc.update(update.get("$set", {}))
            modified = 1

        class _Res:
            modified_count = modified

        return _Res()


class _FakePipe:
    """Warm-worker protocol double: answers the readiness header, then stalls on the photo reply."""

    def __init__(self, delay):
        self._delay = delay
        self._ready_sent = False
        self.written = b""

    def write(self, data):
        self.written += data

    async def drain(self):
        return None

    async def readexactly(self, n):
        if not self._ready_sent:
            self._ready_sent = True
            return b"\x00" * n
        await asyncio.sleep(self._delay)
        return b"\x00" * n


class _FakeProc:
    def __init__(self, communicate_delay=0.05, kill_raises=False):
        self.returncode = None
        self.pid = 4242
        self.kill_called = False
        self.wait_called = False
        self._kill_raises = kill_raises
        self.stdin = _FakePipe(communicate_delay)
        self.stdout = self.stdin

    def kill(self):
        self.kill_called = True
        if self._kill_raises:
            raise ProcessLookupError("already exited")
        self.returncode = -9

    async def wait(self):
        self.wait_called = True
        self.returncode = self.returncode if self.returncode is not None else 0
        return self.returncode


class _RunCollection:
    def __init__(self, docs):
        self.docs = [dict(d) for d in docs]
        self.claimed_ids = []

    async def find_one_and_update(self, query, update, sort=None, projection=None, return_document=None):
        now_value = query["$or"][1]["lease_until"]["$lt"]
        eligible = [d for d in self.docs if d["status"] == "queued" or (d["status"] == "processing" and d["lease_until"] < now_value)]
        if not eligible:
            return None
        eligible.sort(key=lambda d: d["created_at"])
        target = eligible[0]
        target.update(update.get("$set", {}))
        self.claimed_ids.append(target["id"])
        return dict(target)


class _RunDB:
    def __init__(self, jobs):
        self.upload_jobs = _RunCollection(jobs)
        self.items = _FakeItems()


@pytest.mark.anyio
async def test_processing_completes_with_manual_details_when_tag_and_cutout_unavailable(monkeypatch):
    """When AI tag + cutout fail, item still completes with original and processing_warning."""
    db = _FakeDB()

    async def bad_tag(_photo: bytes):
        await asyncio.sleep(1)
        raise AssertionError("tag timeout should cancel before this line")

    monkeypatch.setattr(upload_jobs_module, "TAG_TIMEOUT", 0.01)

    def fake_get(_path: str):
        return b"jpeg-bytes", "image/jpeg"

    def fake_put(path: str, _data: bytes, _ctype: str):
        return {"path": path}

    uploader = UploadJobs(db, bad_tag, fake_put, fake_get, "stylevault")

    async def no_cutout(_raw: bytes):
        return None

    monkeypatch.setattr("upload_jobs.cutout_photo", no_cutout)

    job = {
        "id": "job_timeout_case",
        "user_id": "u_1",
        "item_id": "item_1",
        "owner": "owner_1",
        "original_path": "stylevault/uploads/u_1/item_1-original.jpg",
    }

    await uploader.process(job)

    saved = await db.items.find_one({"user_id": "u_1", "id": "item_1"})
    assert saved is not None
    assert saved["name"] == "New Item"
    assert saved["storage_path"] == job["original_path"]
    assert saved["background_removed"] is False
    assert "Background removal was unavailable" in (saved.get("processing_warning") or "")
    assert "Automatic tags were unavailable" in (saved.get("processing_warning") or "")

    status = await db.upload_jobs.find_one({"user_id": "u_1", "id": "job_timeout_case"})
    assert status["status"] == "complete"
    assert status["stage"] == "ready"


@pytest.mark.anyio
async def test_cutout_store_failure_falls_back_to_original_and_completes(monkeypatch):
    """If cutout PNG storage fails, processing still completes using original storage path."""
    db = _FakeDB()

    async def tag_ok(_photo: bytes):
        return {"name": "TEST_Top", "category": "Tops", "color": "Blue", "season": "All Season"}

    def fake_get(_path: str):
        return b"jpeg-bytes", "image/jpeg"

    def fake_put(path: str, _data: bytes, _ctype: str):
        if path.endswith(".png"):
            raise RuntimeError("storage outage")
        return {"path": path}

    uploader = UploadJobs(db, tag_ok, fake_put, fake_get, "stylevault")

    async def cutout_bytes(_raw: bytes):
        return b"\x89PNGdummy"

    monkeypatch.setattr("upload_jobs.cutout_photo", cutout_bytes)

    job = {
        "id": "job_cutout_store_fail",
        "user_id": "u_2",
        "item_id": "item_2",
        "owner": "owner_2",
        "original_path": "stylevault/uploads/u_2/item_2-original.jpg",
    }

    await uploader.process(job)

    saved = await db.items.find_one({"user_id": "u_2", "id": "item_2"})
    assert saved is not None
    assert saved["name"] == "TEST_Top"
    assert saved["storage_path"] == job["original_path"]
    assert saved["background_removed"] is False
    assert "Background removal was unavailable" in (saved.get("processing_warning") or "")

    status = await db.upload_jobs.find_one({"user_id": "u_2", "id": "job_cutout_store_fail"})
    assert status["status"] == "complete"
    assert status["stage"] == "ready"


@pytest.mark.anyio
async def test_cutout_spawn_failure_returns_none(monkeypatch):
    async def explode(*_args, **_kwargs):
        raise OSError("cannot spawn")

    monkeypatch.setattr(upload_jobs_module.asyncio, "create_subprocess_exec", explode)
    monkeypatch.setattr(upload_jobs_module, "cutout_service", upload_jobs_module.CutoutService())
    out = await upload_jobs_module.cutout_photo(b"jpeg")
    assert out is None


@pytest.mark.anyio
async def test_cutout_timeout_kills_and_waits(monkeypatch):
    fake = _FakeProc(communicate_delay=0.1)

    async def create_proc(*_args, **_kwargs):
        return fake

    monkeypatch.setattr(upload_jobs_module.asyncio, "create_subprocess_exec", create_proc)
    monkeypatch.setattr(upload_jobs_module, "cutout_service", upload_jobs_module.CutoutService())
    monkeypatch.setattr(upload_jobs_module, "CUTOUT_TIMEOUT", 0.01)

    out = await upload_jobs_module.cutout_photo(b"jpeg")
    assert out is None
    assert fake.kill_called is True
    assert fake.wait_called is True


@pytest.mark.anyio
async def test_cutout_timeout_processlookuperror_still_waits(monkeypatch):
    fake = _FakeProc(communicate_delay=0.1, kill_raises=True)

    async def create_proc(*_args, **_kwargs):
        return fake

    monkeypatch.setattr(upload_jobs_module.asyncio, "create_subprocess_exec", create_proc)
    monkeypatch.setattr(upload_jobs_module, "cutout_service", upload_jobs_module.CutoutService())
    monkeypatch.setattr(upload_jobs_module, "CUTOUT_TIMEOUT", 0.01)

    out = await upload_jobs_module.cutout_photo(b"jpeg")
    assert out is None
    assert fake.kill_called is True
    assert fake.wait_called is True


@pytest.mark.anyio
async def test_expired_receiving_is_marked_upload_failed_with_retry_message():
    stale = {
        "id": "job_receiving_expired",
        "user_id": "u_exp",
        "status": "receiving",
        "stage": "uploading",
        "lease_until": upload_jobs_module.now() - timedelta(seconds=10),
        "item_id": "item_x",
    }
    db = type("DB", (), {"upload_jobs": _ResultCollection(stale), "items": _FakeItems()})()
    uploader = UploadJobs(db, None, None, None, "stylevault")

    result = await uploader.result("u_exp", "job_receiving_expired")
    assert result.status == "upload_failed"
    assert result.stage == "failed"
    assert "interrupted" in (result.error or "").lower()


@pytest.mark.anyio
async def test_processing_cancelled_requeues_job(monkeypatch):
    db = _FakeDB()

    async def tag_slow(_photo):
        await asyncio.sleep(1)
        return {"name": "TEST"}

    def fake_get(_path):
        return b"jpeg-bytes", "image/jpeg"

    def fake_put(path: str, _data: bytes, _ctype: str):
        return {"path": path}

    uploader = UploadJobs(db, tag_slow, fake_put, fake_get, "stylevault")

    async def cutout_slow(_raw):
        await asyncio.sleep(1)
        return None

    monkeypatch.setattr("upload_jobs.cutout_photo", cutout_slow)

    job = {
        "id": "job_cancelled",
        "user_id": "u_cancel",
        "item_id": "item_cancel",
        "owner": "owner_cancel",
        "original_path": "stylevault/uploads/u_cancel/item_cancel-original.jpg",
    }

    task = asyncio.create_task(uploader.process(job))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    status = await db.upload_jobs.find_one({"user_id": "u_cancel", "id": "job_cancelled"})
    assert status["status"] == "queued"
    assert status["stage"] == "queued"


@pytest.mark.anyio
async def test_run_claims_expired_processing_lease_and_keeps_fifo(monkeypatch):
    now = upload_jobs_module.now()
    jobs = [
        {
            "id": "job_oldest_queued",
            "user_id": "u_fifo",
            "status": "queued",
            "stage": "queued",
            "created_at": now - timedelta(seconds=30),
            "lease_until": now + timedelta(seconds=10),
        },
        {
            "id": "job_expired_processing",
            "user_id": "u_fifo",
            "status": "processing",
            "stage": "analysing",
            "created_at": now - timedelta(seconds=10),
            "lease_until": now - timedelta(seconds=1),
        },
    ]
    db = _RunDB(jobs)
    uploader = UploadJobs(db, None, None, None, "stylevault")
    processed = []

    async def fake_process(job):
        processed.append(job["id"])
        for doc in db.upload_jobs.docs:
            if doc["id"] == job["id"]:
                doc["status"] = "complete"

    monkeypatch.setattr(uploader, "process", fake_process)

    # The loop now hands each claimed job to its own task; stop it once both jobs were processed.
    runner = asyncio.create_task(uploader.run())
    for _ in range(200):
        if len(processed) == 2:
            break
        await asyncio.sleep(0.01)
    runner.cancel()
    with pytest.raises(asyncio.CancelledError):
        await runner

    assert processed[0] == "job_oldest_queued"
    assert db.upload_jobs.claimed_ids[0] == "job_oldest_queued"
    assert processed == ["job_oldest_queued", "job_expired_processing"]
    assert db.upload_jobs.claimed_ids == processed
