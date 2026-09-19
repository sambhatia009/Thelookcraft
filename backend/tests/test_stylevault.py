"""StyleVault backend integration tests"""
import io
import os
import time
import uuid

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://stylevault-app.preview.emergentagent.com"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


def _make_jpeg_bytes() -> bytes:
    """Create a small non-uniform JPEG (features/edges/colors) for upload tests."""
    img = Image.new("RGB", (320, 400), (230, 230, 230))
    px = img.load()
    # draw a simple shirt-like shape with color variance
    for y in range(60, 340):
        for x in range(60, 260):
            if 100 < x < 220 and 90 < y < 320:
                px[x, y] = (30, 60, 120)  # navy body
            elif abs(x - 160) < 90 and y < 100:
                px[x, y] = (200, 200, 210)  # collar area
    for y in range(0, 400, 8):
        for x in range(0, 320):
            px[x, y] = (255, 255, 255)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


@pytest.fixture(scope="module")
def account():
    email = f"test.sv+{uuid.uuid4().hex[:10]}@example.com"
    password = "pass1234"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/register", json={"name": "Test User", "email": email, "password": password})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    assert "session_token" in data and data["user"]["email"] == email
    s.headers.update({"Authorization": f"Bearer {data['session_token']}"})
    return {"session": s, "token": data["session_token"], "email": email, "password": password, "user": data["user"]}


# ----- Auth -----
class TestAuth:
    def test_register_seeds_five_items(self, account):
        r = account["session"].get(f"{API}/items")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 5, f"expected 5 seed items, got {len(items)}"
        cats = {i["category"] for i in items}
        assert {"Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"} <= cats

    def test_login_success(self, account):
        r = requests.post(f"{API}/auth/login", json={"email": account["email"], "password": account["password"]})
        assert r.status_code == 200
        assert "session_token" in r.json()

    def test_login_bad_password(self, account):
        r = requests.post(f"{API}/auth/login", json={"email": account["email"], "password": "wrong"})
        assert r.status_code == 401

    def test_me_with_token(self, account):
        r = account["session"].get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == account["email"]

    def test_me_without_token(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


# ----- Items -----
class TestItems:
    def test_category_filter(self, account):
        r = account["session"].get(f"{API}/items", params={"category": "Tops"})
        assert r.status_code == 200
        items = r.json()
        assert all(i["category"] == "Tops" for i in items)
        assert len(items) >= 1

    def test_patch_and_delete(self, account):
        r = account["session"].get(f"{API}/items")
        item = r.json()[0]
        item_id = item["id"]

        # patch
        r2 = account["session"].patch(f"{API}/items/{item_id}", json={"color": "TEST_Color"})
        assert r2.status_code == 200
        assert r2.json()["color"] == "TEST_Color"

        # verify via GET
        items = account["session"].get(f"{API}/items").json()
        assert next(i for i in items if i["id"] == item_id)["color"] == "TEST_Color"

        # delete (soft)
        r3 = account["session"].delete(f"{API}/items/{item_id}")
        assert r3.status_code == 200
        items_after = account["session"].get(f"{API}/items").json()
        assert not any(i["id"] == item_id for i in items_after)


# ----- Upload (real JPEG, AI tags + rembg) -----
class TestUpload:
    def test_upload_jpeg_returns_tags_and_storage_path(self, account):
        img = _make_jpeg_bytes()
        # Use a fresh request without session JSON default headers
        r = requests.post(
            f"{API}/items/upload",
            headers={"Authorization": f"Bearer {account['token']}"},
            files={"file": ("shirt.jpg", img, "image/jpeg")},
            timeout=180,
        )
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert data.get("storage_path"), "storage_path missing"
        assert data.get("category") in ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"]
        assert "name" in data and "color" in data and "season" in data
        # Serve the file
        path = data["storage_path"]
        r2 = account["session"].get(f"{API}/files/{path}", params={"token": account["token"]})
        assert r2.status_code == 200
        assert len(r2.content) > 100
        assert r2.headers.get("content-type", "").startswith("image/")


# ----- Stylist -----
class TestStylist:
    def test_generate_outfit(self, account):
        r = account["session"].post(f"{API}/stylist/generate", json={"prompt": "Style a smart casual office look"})
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        for k in ("outfit_name", "item_ids", "items", "stylist_note", "missing_suggestion"):
            assert k in d
        assert isinstance(d["item_ids"], list) and len(d["item_ids"]) >= 1
        # ids subset of wardrobe
        items = account["session"].get(f"{API}/items").json()
        valid = {i["id"] for i in items}
        assert set(d["item_ids"]).issubset(valid)

    def test_generate_with_focus_item(self, account):
        items = account["session"].get(f"{API}/items").json()
        focus = items[0]["id"]
        r = account["session"].post(f"{API}/stylist/generate", json={"prompt": "Build around this", "focus_item_id": focus})
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d["item_ids"], list)


# ----- Outfits -----
class TestOutfits:
    def test_save_list_delete_outfit(self, account):
        items = account["session"].get(f"{API}/items").json()
        payload = {"title": "TEST_Look", "item_ids": [items[0]["id"], items[1]["id"]], "stylist_note": "note"}
        r = account["session"].post(f"{API}/outfits", json=payload)
        assert r.status_code == 200
        outfit_id = r.json()["id"]

        # list
        outs = account["session"].get(f"{API}/outfits").json()
        assert any(o["id"] == outfit_id for o in outs)
        o = next(o for o in outs if o["id"] == outfit_id)
        assert len(o["items"]) == 2

        # delete
        r2 = account["session"].delete(f"{API}/outfits/{outfit_id}")
        assert r2.status_code == 200
        outs_after = account["session"].get(f"{API}/outfits").json()
        assert not any(o["id"] == outfit_id for o in outs_after)


# ----- Profile -----
class TestProfile:
    def test_get_and_update_profile(self, account):
        r = account["session"].get(f"{API}/profile")
        assert r.status_code == 200
        p = r.json()
        assert "counts" in p and "total_items" in p
        assert p["email"] == account["email"]

        r2 = account["session"].put(f"{API}/profile", json={"dress_code": "Streetwear", "weather": "Cold", "color_palette": ["Black", "White"]})
        assert r2.status_code == 200
        r3 = account["session"].get(f"{API}/profile").json()
        assert r3["dress_code"] == "Streetwear"
        assert r3["weather"] == "Cold"
        assert set(r3["color_palette"]) == {"Black", "White"}
