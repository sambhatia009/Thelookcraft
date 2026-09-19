"""StyleVault — upload-bugfix regression tests (iteration 3).

Covers the fixes shipped with the "camera silent bounce" bug:
  * Large ~4032x3024 JPEG (~8-10MB) uploads succeed <30s and returns tags + storage_path
  * Normal ~1280px JPEG uploads succeed <15s
  * Empty file body -> 400 'Empty image'
  * Missing auth -> 401
  * Served file endpoint returns image/* for owner
"""
import io
import os
import time
import uuid

import pytest
import requests
from PIL import Image, ImageDraw

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://stylevault-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _make_jpeg(width: int, height: int, target_kb_min: int = 0) -> bytes:
    """Create a photorealistic-ish, non-uniform JPEG at requested dims."""
    img = Image.new("RGB", (width, height), (240, 235, 225))
    draw = ImageDraw.Draw(img)
    # gradient bands to add variance
    for y in range(0, height, 6):
        draw.line([(0, y), (width, y)], fill=(200 + (y % 40), 180, 160), width=2)
    # a "shirt" rectangle with different color
    draw.rectangle([(width // 6, height // 6), (5 * width // 6, 5 * height // 6)], fill=(30, 60, 120))
    # collar-like shape
    draw.polygon([
        (width // 2 - width // 10, height // 6),
        (width // 2 + width // 10, height // 6),
        (width // 2, height // 6 + height // 12),
    ], fill=(220, 220, 230))
    # sleeves
    draw.rectangle([(width // 12, height // 6), (width // 6, height // 2)], fill=(30, 60, 120))
    draw.rectangle([(5 * width // 6, height // 6), (11 * width // 12, height // 2)], fill=(30, 60, 120))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    data = buf.getvalue()
    if target_kb_min and len(data) < target_kb_min * 1024:
        # bump quality to grow the file
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=98, subsampling=0)
        data = buf.getvalue()
    return data


@pytest.fixture(scope="module")
def account():
    email = f"test.sv+upload{uuid.uuid4().hex[:10]}@example.com"
    password = "pass1234"
    r = requests.post(f"{API}/auth/register", json={"name": "Upload Tester", "email": email, "password": password})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    return {"token": data["session_token"], "email": email}


class TestUploadBugfix:
    def test_large_jpeg_upload_under_30s(self, account):
        """A ~4032x3024 JPEG (roughly matching iPhone camera output) must upload in <30s."""
        data = _make_jpeg(4032, 3024)
        assert len(data) > 500 * 1024, f"expected a beefy JPEG, got {len(data)} bytes"
        t0 = time.monotonic()
        r = requests.post(
            f"{API}/items/upload",
            headers={"Authorization": f"Bearer {account['token']}"},
            files={"file": ("big.jpg", data, "image/jpeg")},
            timeout=60,
        )
        elapsed = time.monotonic() - t0
        assert r.status_code == 200, f"large upload failed: {r.status_code} {r.text[:400]}"
        payload = r.json()
        assert payload.get("name")
        assert payload.get("category") in ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"]
        assert payload.get("storage_path"), "storage_path missing on large upload"
        assert elapsed < 30.0, f"large upload took {elapsed:.1f}s, should be <30s after downscale fix"
        # ensure item is now visible in GET /items
        r2 = requests.get(f"{API}/items", headers={"Authorization": f"Bearer {account['token']}"})
        assert r2.status_code == 200
        assert any(it["id"] == payload["id"] for it in r2.json()), "uploaded item missing from GET /items"

    def test_normal_1280_upload_under_15s(self, account):
        data = _make_jpeg(1280, 960)
        t0 = time.monotonic()
        r = requests.post(
            f"{API}/items/upload",
            headers={"Authorization": f"Bearer {account['token']}"},
            files={"file": ("normal.jpg", data, "image/jpeg")},
            timeout=30,
        )
        elapsed = time.monotonic() - t0
        assert r.status_code == 200, f"normal upload failed: {r.status_code} {r.text[:400]}"
        assert elapsed < 15.0, f"normal upload took {elapsed:.1f}s"

    def test_empty_body_returns_400(self, account):
        r = requests.post(
            f"{API}/items/upload",
            headers={"Authorization": f"Bearer {account['token']}"},
            files={"file": ("empty.jpg", b"", "image/jpeg")},
            timeout=30,
        )
        assert r.status_code == 400, f"expected 400 on empty, got {r.status_code} {r.text[:200]}"
        try:
            body = r.json()
        except Exception:
            body = {}
        assert "empty" in (body.get("detail") or "").lower()

    def test_missing_auth_returns_401(self):
        data = _make_jpeg(400, 400)
        r = requests.post(
            f"{API}/items/upload",
            files={"file": ("noauth.jpg", data, "image/jpeg")},
            timeout=30,
        )
        assert r.status_code == 401, f"expected 401 without auth, got {r.status_code}"

    def test_uploaded_file_is_served_as_image(self, account):
        # upload a small image, then hit /api/files/{path}?token=...
        data = _make_jpeg(600, 800)
        r = requests.post(
            f"{API}/items/upload",
            headers={"Authorization": f"Bearer {account['token']}"},
            files={"file": ("srv.jpg", data, "image/jpeg")},
            timeout=45,
        )
        assert r.status_code == 200
        path = r.json()["storage_path"]

        r2 = requests.get(f"{API}/files/{path}", params={"token": account["token"]}, timeout=30)
        assert r2.status_code == 200, f"file fetch failed: {r2.status_code}"
        ct = r2.headers.get("content-type", "")
        assert ct.startswith("image/"), f"unexpected content-type {ct!r}"
        assert len(r2.content) > 200, "served file suspiciously small"
