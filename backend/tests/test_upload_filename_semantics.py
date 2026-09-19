"""Backend regression for the upload endpoint — proves the filename is what
turns the incoming part into a proper `UploadFile` (200) and that omitting
filename fails validation (422). Mirrors what Expo's convertFormDataAsync
would send with the new File-based approach.
"""
import io
import os
import time
import uuid

import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://stylevault-app.preview.emergentagent.com"
).rstrip("/") + "/api"


def _jpeg_bytes() -> bytes:
    # Minimal valid JPEG (single 8x8 white block). PIL is available in backend deps.
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (255, 255, 255)).save(buf, format="JPEG", quality=80)
    return buf.getvalue()


@pytest.fixture(scope="module")
def auth_token():
    email = f"iter4.upload+{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(f"{BASE_URL}/auth/register",
                      json={"name": "Iter4", "email": email, "password": "pass1234"},
                      timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return r.json()["session_token"]


class TestUploadFilenameSemantics:
    """Confirm FastAPI accepts multipart parts as expo would send them."""

    def test_upload_with_filename_and_content_type_returns_200(self, auth_token):
        """Simulates the fixed native path: File-like part → convertFormDataAsync
        writes Content-Disposition: form-data; name=file; filename=item_1.jpg
        and Content-Type: image/jpeg — FastAPI treats it as UploadFile."""
        data = _jpeg_bytes()
        files = {"file": ("item_1.jpg", data, "image/jpeg")}
        t0 = time.monotonic()
        r = requests.post(f"{BASE_URL}/items/upload",
                          headers={"Authorization": f"Bearer {auth_token}"},
                          files=files, timeout=90)
        elapsed = time.monotonic() - t0
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("id"), "item id present"
        assert body.get("category") in {"Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"}
        assert body.get("storage_path"), "storage_path persisted"
        print(f"\nupload_with_filename OK in {elapsed:.1f}s → {body.get('name')} / {body.get('category')}")

    def test_upload_without_filename_returns_422(self, auth_token):
        """A multipart part with NO filename is not treated as a file by
        Starlette — it becomes a plain form field, so `UploadFile = File(...)`
        cannot be satisfied and validation returns 422. This documents WHY the
        native fix has to expose `name` on the File-like object."""
        data = _jpeg_bytes()
        # Manually craft multipart without a filename parameter on the part.
        boundary = "----NoFilenameBoundary123"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"\r\n'
            f"Content-Type: image/jpeg\r\n\r\n"
        ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
        r = requests.post(
            f"{BASE_URL}/items/upload",
            headers={
                "Authorization": f"Bearer {auth_token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            data=body, timeout=30,
        )
        assert r.status_code == 422, f"expected 422 without filename, got {r.status_code}: {r.text[:300]}"
        print(f"\nno-filename correctly rejected with 422: {r.text[:200]}")

    def test_upload_requires_auth(self):
        r = requests.post(f"{BASE_URL}/items/upload",
                          files={"file": ("x.jpg", b"\xff\xd8\xff", "image/jpeg")},
                          timeout=30)
        assert r.status_code == 401
