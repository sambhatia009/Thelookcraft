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


# ----- Occasion tags, wear tracking, insights (new features) -----
class TestOccasionWearInsights:
    def test_save_outfit_with_occasion_persists(self, account):
        items = account["session"].get(f"{API}/items").json()
        payload = {
            "title": "TEST_Work_Look",
            "item_ids": [items[0]["id"], items[1]["id"]],
            "stylist_note": "office look",
            "occasion": "Work",
        }
        r = account["session"].post(f"{API}/outfits", json=payload)
        assert r.status_code == 200
        outfit = r.json()
        assert outfit["occasion"] == "Work"
        outfit_id = outfit["id"]

        # Verify via GET
        outs = account["session"].get(f"{API}/outfits").json()
        got = next(o for o in outs if o["id"] == outfit_id)
        assert got["occasion"] == "Work"

    def test_patch_outfit_occasion(self, account):
        items = account["session"].get(f"{API}/items").json()
        r = account["session"].post(f"{API}/outfits", json={
            "title": "TEST_TagChange", "item_ids": [items[0]["id"]], "occasion": "Work",
        })
        outfit_id = r.json()["id"]

        r2 = account["session"].patch(f"{API}/outfits/{outfit_id}", json={"occasion": "Brunch"})
        assert r2.status_code == 200
        assert r2.json()["occasion"] == "Brunch"

        outs = account["session"].get(f"{API}/outfits").json()
        assert next(o for o in outs if o["id"] == outfit_id)["occasion"] == "Brunch"

    def test_patch_unknown_outfit_returns_404(self, account):
        r = account["session"].patch(f"{API}/outfits/does-not-exist-xyz", json={"occasion": "Work"})
        assert r.status_code == 404

    def test_wear_outfit_increments_counts(self, account):
        items = account["session"].get(f"{API}/items").json()
        ids = [items[0]["id"], items[1]["id"]]
        # baseline wear_count
        baseline = {i["id"]: int(i.get("wear_count") or 0) for i in items if i["id"] in ids}

        r = account["session"].post(f"{API}/outfits", json={
            "title": "TEST_WearLook", "item_ids": ids, "occasion": "Casual",
        })
        outfit_id = r.json()["id"]

        r2 = account["session"].post(f"{API}/outfits/{outfit_id}/wear")
        assert r2.status_code == 200
        data = r2.json()
        assert data.get("ok") is True
        assert data.get("items_logged") == len(ids)

        # outfit wear_count present in list
        outs = account["session"].get(f"{API}/outfits").json()
        o = next(o for o in outs if o["id"] == outfit_id)
        assert int(o.get("wear_count") or 0) >= 1

        # each item wear_count incremented
        items_after = account["session"].get(f"{API}/items").json()
        for it in items_after:
            if it["id"] in ids:
                assert int(it.get("wear_count") or 0) >= baseline[it["id"]] + 1

    def test_wear_item_and_unknown(self, account):
        items = account["session"].get(f"{API}/items").json()
        target = items[2]  # pick a different item
        before = int(target.get("wear_count") or 0)
        r = account["session"].post(f"{API}/items/{target['id']}/wear")
        assert r.status_code == 200
        assert int(r.json().get("wear_count") or 0) == before + 1

        # unknown id
        r2 = account["session"].post(f"{API}/items/nonexistent-item-id/wear")
        assert r2.status_code == 404

    def test_wear_other_users_item_returns_404(self, account):
        # Create a second account, then try to wear its item using first account's token
        email = f"test.sv+other{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register", json={"name": "Other", "email": email, "password": "pass1234"})
        assert r.status_code == 200
        other_token = r.json()["session_token"]
        other_items = requests.get(f"{API}/items", headers={"Authorization": f"Bearer {other_token}"}).json()
        other_id = other_items[0]["id"]

        r2 = account["session"].post(f"{API}/items/{other_id}/wear")
        assert r2.status_code == 404

    def test_insights_shape(self, account):
        r = account["session"].get(f"{API}/insights")
        assert r.status_code == 200
        d = r.json()
        for k in ("total_items", "total_wears", "saved_outfits", "most_worn",
                  "never_worn_count", "color_balance", "category_balance"):
            assert k in d, f"missing key {k}"
        assert d["total_wears"] >= 1  # we wore items in prior tests
        assert d["saved_outfits"] >= 1
        # most_worn sorted by wear_count*2 + outfit_appearances
        prev = None
        for m in d["most_worn"]:
            assert "wear_count" in m and "outfit_appearances" in m
            score = int(m["wear_count"]) * 2 + int(m["outfit_appearances"])
            if prev is not None:
                assert prev >= score
            prev = score
        # color balance percentages sum roughly to 100 (rounding tolerance)
        s = sum(c["pct"] for c in d["color_balance"])
        assert 95 <= s <= 105, f"color pct sum out of range: {s}"
        # 5 categories present
        cats = [c["category"] for c in d["category_balance"]]
        assert cats == ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"]


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
