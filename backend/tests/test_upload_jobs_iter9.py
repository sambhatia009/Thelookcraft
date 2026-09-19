"""Upload jobs regression tests (iter9): durable mobile upload route and ownership/error handling."""

import io
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests
from PIL import Image, ImageDraw


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    pytest.skip("EXPO_PUBLIC_BACKEND_URL is required", allow_module_level=True)
API = f"{BASE_URL}/api"


def _jpeg(width: int = 1200, height: int = 1600, quality: int = 88) -> bytes:
    img = Image.new("RGB", (width, height), (220, 225, 230))
    draw = ImageDraw.Draw(img)
    for y in range(0, height, 8):
        draw.line([(0, y), (width, y)], fill=(90 + (y % 80), 110 + (y % 70), 150), width=2)
    draw.rectangle((width // 6, height // 8, 5 * width // 6, 6 * height // 7), fill=(35, 68, 130), outline=(25, 25, 35), width=5)
    draw.polygon(
        [
            (width // 2 - width // 14, height // 8),
            (width // 2 + width // 14, height // 8),
            (width // 2, height // 8 + height // 12),
        ],
        fill=(220, 220, 230),
    )
    b = io.BytesIO()
    img.save(b, format="JPEG", quality=quality)
    return b.getvalue()


def _register(email: str, password: str = "pass1234") -> dict:
    res = requests.post(
        f"{API}/auth/register",
        json={"name": "Upload QA", "email": email, "password": password},
        timeout=40,
    )
    assert res.status_code == 200, res.text
    token = res.json()["session_token"]
    return {"token": token, "headers": {"Authorization": f"Bearer {token}"}}


def _login(email: str, password: str = "pass1234") -> dict:
    res = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password},
        timeout=30,
    )
    assert res.status_code == 200, f"login failed for {email}: {res.status_code} {res.text[:200]}"
    token = res.json()["session_token"]
    return {"token": token, "headers": {"Authorization": f"Bearer {token}"}}


def _post_job(job_id: str, photo: bytes, headers: dict, timeout: int = 60):
    return requests.post(
        f"{API}/items/upload-jobs/{job_id}",
        headers={**headers, "Content-Type": "image/jpeg"},
        data=photo,
        timeout=timeout,
    )


def _poll_until_complete(job_id: str, headers: dict, timeout_s: int = 120) -> tuple[dict, float]:
    started = time.monotonic()
    while time.monotonic() - started < timeout_s:
        res = requests.get(f"{API}/items/upload-jobs/{job_id}", headers=headers, timeout=30)
        assert res.status_code in (200, 202), f"poll failed {res.status_code}: {res.text[:300]}"
        payload = res.json()
        if payload.get("status") == "complete" and payload.get("item"):
            return payload, (time.monotonic() - started)
        if payload.get("status") in ("failed", "upload_failed"):
            pytest.fail(f"job entered failure state: {payload}")
        time.sleep(1.5)
    pytest.fail("job did not complete within timeout")


@pytest.fixture(scope="module")
def owner_account():
    # Existing created account from test credentials (do not create unnecessarily).
    return _login("lookbook.tryon.qa@example.com", "pass1234")


@pytest.fixture(scope="module")
def foreign_account():
    return _login("iter7_foreign.bf2358ee29@example.com", "pass1234")


class TestUploadJobsCore:
    """Core upload job behaviour: 202 ack, polling completion, dedupe, and ownership."""

    def test_ack_then_complete_with_private_file_access(self, owner_account):
        photo = _jpeg()
        job_id = f"job_{uuid.uuid4().hex[:24]}"

        t0 = time.monotonic()
        create = _post_job(job_id, photo, owner_account["headers"])
        ack = time.monotonic() - t0

        assert create.status_code == 202, create.text
        body = create.json()
        assert body["id"] == job_id
        assert body["status"] in ("queued", "processing", "complete")
        assert ack < 8.0, f"202 acknowledgement too slow: {ack:.2f}s"

        done, total = _poll_until_complete(job_id, owner_account["headers"], timeout_s=140)
        item = done["item"]
        assert item["id"]
        assert item["storage_path"]
        assert item["original_storage_path"]
        assert item["category"] in ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"]
        assert isinstance(item.get("background_removed"), bool)

        file_res = requests.get(
            f"{API}/files/{item['storage_path']}",
            headers=owner_account["headers"],
            timeout=30,
        )
        assert file_res.status_code == 200, file_res.text[:200]
        assert file_res.headers.get("content-type", "").startswith("image/")
        assert len(file_res.content) > 200
        print(f"ack_seconds={ack:.3f}, total_seconds={total:.3f}")

    def test_same_id_same_photo_idempotent_even_when_concurrent(self, owner_account):
        photo = _jpeg(1100, 1450)
        job_id = f"job_{uuid.uuid4().hex[:24]}"

        with ThreadPoolExecutor(max_workers=2) as pool:
            fut1 = pool.submit(_post_job, job_id, photo, owner_account["headers"], 80)
            fut2 = pool.submit(_post_job, job_id, photo, owner_account["headers"], 80)
            r1 = fut1.result()
            r2 = fut2.result()

        assert r1.status_code == 202, r1.text
        assert r2.status_code == 202, r2.text

        done, _ = _poll_until_complete(job_id, owner_account["headers"], timeout_s=140)
        item_id = done["item"]["id"]

        items = requests.get(f"{API}/items", headers=owner_account["headers"], timeout=30)
        assert items.status_code == 200
        matches = [i for i in items.json() if i["id"] == item_id and i.get("deleted_at") is None]
        assert len(matches) == 1, "duplicate closet entries created for same upload id/photo"

    def test_same_id_different_photo_conflict_409(self, owner_account):
        job_id = f"job_{uuid.uuid4().hex[:24]}"
        p1 = _jpeg(900, 1200)
        p2 = _jpeg(900, 1200, quality=76)

        first = _post_job(job_id, p1, owner_account["headers"])
        assert first.status_code == 202, first.text

        second = _post_job(job_id, p2, owner_account["headers"])
        assert second.status_code == 409, second.text

    def test_job_and_file_ownership_and_auth(self, owner_account, foreign_account):
        photo = _jpeg(1000, 1000)
        job_id = f"job_{uuid.uuid4().hex[:24]}"

        create = _post_job(job_id, photo, owner_account["headers"])
        assert create.status_code == 202
        done, _ = _poll_until_complete(job_id, owner_account["headers"], timeout_s=140)

        unauth_get = requests.get(f"{API}/items/upload-jobs/{job_id}", timeout=30)
        assert unauth_get.status_code == 401
        foreign_get = requests.get(f"{API}/items/upload-jobs/{job_id}", headers=foreign_account["headers"], timeout=30)
        assert foreign_get.status_code == 404

        path = done["item"]["storage_path"]
        unauth_file = requests.get(f"{API}/files/{path}", timeout=30)
        assert unauth_file.status_code == 401
        foreign_file = requests.get(f"{API}/files/{path}", headers=foreign_account["headers"], timeout=30)
        assert foreign_file.status_code == 403


class TestUploadJobsValidationAndLifecycle:
    """Validation paths and lifecycle corner cases for upload jobs."""

    def test_rejects_empty_malformed_and_oversize(self, owner_account):
        empty = _post_job(f"job_{uuid.uuid4().hex[:24]}", b"", owner_account["headers"])
        assert empty.status_code == 400

        malformed = _post_job(f"job_{uuid.uuid4().hex[:24]}", b"not-a-real-image", owner_account["headers"])
        assert malformed.status_code == 400

        # >16MB hard limit
        too_big = b"x" * (16 * 1024 * 1024 + 64)
        huge = _post_job(f"job_{uuid.uuid4().hex[:24]}", too_big, owner_account["headers"], timeout=80)
        assert huge.status_code == 413

    def test_deleted_completed_item_returns_410(self, owner_account):
        photo = _jpeg(960, 1280)
        job_id = f"job_{uuid.uuid4().hex[:24]}"

        create = _post_job(job_id, photo, owner_account["headers"])
        assert create.status_code == 202
        done, _ = _poll_until_complete(job_id, owner_account["headers"], timeout_s=140)
        item_id = done["item"]["id"]

        delete = requests.delete(f"{API}/items/{item_id}", headers=owner_account["headers"], timeout=30)
        assert delete.status_code == 200

        again = requests.get(f"{API}/items/upload-jobs/{job_id}", headers=owner_account["headers"], timeout=30)
        assert again.status_code == 410, again.text