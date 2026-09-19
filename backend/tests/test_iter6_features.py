"""Backend tests for iteration 6: notes/preference PATCH, feedback, taste, profile+photo, visualise."""
import io
import os
import time
import uuid

import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://stylevault-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _jpeg(w=600, h=900, color=(80, 120, 180)) -> bytes:
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


@pytest.fixture(scope="module")
def account():
    email = f"iter6_{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(f"{API}/auth/register", json={"name": "Iter6", "email": email, "password": "pass1234"}, timeout=30)
    assert r.status_code == 200, r.text
    tok = r.json()["session_token"]
    headers = {"Authorization": f"Bearer {tok}"}
    items = requests.get(f"{API}/items", headers=headers, timeout=30).json()
    assert len(items) == 5
    return {"headers": headers, "items": items, "token": tok}


# ---- Items PATCH ----------------------------------------------------------
class TestItemsPatch:
    def test_notes_persists(self, account):
        it = account["items"][0]
        r = requests.patch(f"{API}/items/{it['id']}", json={"notes": "Runs small"}, headers=account["headers"], timeout=15)
        assert r.status_code == 200
        # re-fetch
        items = requests.get(f"{API}/items", headers=account["headers"], timeout=15).json()
        got = next(i for i in items if i["id"] == it["id"])
        assert got.get("notes") == "Runs small"

    def test_preference_avoid_persists(self, account):
        it = account["items"][1]
        r = requests.patch(f"{API}/items/{it['id']}", json={"preference": "avoid"}, headers=account["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json().get("preference") == "avoid"

    def test_preference_invalid_400(self, account):
        it = account["items"][2]
        r = requests.patch(f"{API}/items/{it['id']}", json={"preference": "x"}, headers=account["headers"], timeout=15)
        assert r.status_code == 400

    def test_preference_neutral_clears(self, account):
        it = account["items"][1]  # already avoid from above
        r = requests.patch(f"{API}/items/{it['id']}", json={"preference": "neutral"}, headers=account["headers"], timeout=15)
        assert r.status_code == 200
        assert r.json().get("preference") == "neutral"


# ---- Stylist generate w/ avoid + prefer_unworn ----------------------------
class TestStylistGenerate:
    def test_prefer_unworn(self, account):
        r = requests.post(
            f"{API}/stylist/generate",
            json={"prompt": "Casual weekend outfit", "prefer_unworn": True},
            headers=account["headers"],
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("item_ids"), "empty item_ids"

    def test_avoided_item_never_in_result(self, account):
        # Mark first item as avoid
        target = account["items"][0]["id"]
        requests.patch(f"{API}/items/{target}", json={"preference": "avoid"}, headers=account["headers"], timeout=15)
        # Run twice
        for _ in range(2):
            r = requests.post(
                f"{API}/stylist/generate",
                json={"prompt": "Smart casual work outfit"},
                headers=account["headers"],
                timeout=90,
            )
            assert r.status_code == 200
            assert target not in r.json()["item_ids"], "avoided item leaked into result"

    def test_focus_on_avoided_allowed(self, account):
        target = account["items"][0]["id"]  # still avoid
        r = requests.post(
            f"{API}/stylist/generate",
            json={"prompt": "Build around this", "focus_item_id": target},
            headers=account["headers"],
            timeout=90,
        )
        assert r.status_code == 200
        # focus on avoided item should be allowed (server explicitly permits)
        assert target in r.json()["item_ids"], "focus item should be included even if avoided"

    def test_clear_avoid_at_end(self, account):
        target = account["items"][0]["id"]
        requests.patch(f"{API}/items/{target}", json={"preference": "neutral"}, headers=account["headers"], timeout=15)


# ---- Feedback + taste -----------------------------------------------------
class TestFeedback:
    def test_down_ok(self, account):
        ids = [i["id"] for i in account["items"][:2]]
        r = requests.post(
            f"{API}/stylist/feedback",
            json={"verdict": "down", "item_ids": ids, "outfit_name": "X", "prompt": "test"},
            headers=account["headers"],
            timeout=15,
        )
        assert r.status_code == 200

    def test_up_ok(self, account):
        ids = [i["id"] for i in account["items"][:2]]
        r = requests.post(
            f"{API}/stylist/feedback",
            json={"verdict": "up", "item_ids": ids, "outfit_name": "Y"},
            headers=account["headers"],
            timeout=15,
        )
        assert r.status_code == 200

    def test_meh_400(self, account):
        r = requests.post(
            f"{API}/stylist/feedback",
            json={"verdict": "meh", "item_ids": [account["items"][0]["id"]]},
            headers=account["headers"],
            timeout=15,
        )
        assert r.status_code == 400

    def test_empty_ids_400(self, account):
        r = requests.post(
            f"{API}/stylist/feedback",
            json={"verdict": "up", "item_ids": []},
            headers=account["headers"],
            timeout=15,
        )
        assert r.status_code == 400

    def test_taste_summary(self, account):
        # Mark one item as avoid too
        target = account["items"][3]["id"]
        requests.patch(f"{API}/items/{target}", json={"preference": "avoid"}, headers=account["headers"], timeout=15)
        r = requests.get(f"{API}/stylist/taste", headers=account["headers"], timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["liked"] >= 1
        assert data["disliked"] >= 1
        assert isinstance(data.get("avoided_items"), list)
        assert any(a["id"] == target for a in data["avoided_items"])
        # cleanup
        requests.patch(f"{API}/items/{target}", json={"preference": "neutral"}, headers=account["headers"], timeout=15)


# ---- Profile + photo + visualise ------------------------------------------
class TestProfilePhotoVisualize:
    def test_profile_update(self, account):
        r = requests.put(f"{API}/profile", json={"gender": "Female", "age": 28}, headers=account["headers"], timeout=15)
        assert r.status_code == 200
        got = requests.get(f"{API}/profile", headers=account["headers"], timeout=15).json()
        assert got["gender"] == "Female"
        assert got["age"] == 28

    def test_profile_bad_age(self, account):
        r = requests.put(f"{API}/profile", json={"age": 2}, headers=account["headers"], timeout=15)
        assert r.status_code == 400

    def test_visualize_before_photo_400(self, account):
        ids = [i["id"] for i in account["items"][:3]]
        r = requests.post(f"{API}/stylist/visualize", json={"item_ids": ids}, headers=account["headers"], timeout=30)
        assert r.status_code == 400

    def test_upload_photo(self, account):
        files = {"file": ("me.jpg", _jpeg(600, 900, (200, 160, 140)), "image/jpeg")}
        r = requests.post(f"{API}/profile/photo", headers=account["headers"], files=files, timeout=60)
        assert r.status_code == 200, r.text
        path = r.json()["photo_path"]
        account["photo_path"] = path

        prof = requests.get(f"{API}/profile", headers=account["headers"], timeout=15).json()
        assert prof.get("photo_path") == path

        # Serve file
        r2 = requests.get(f"{API}/files/{path}", headers=account["headers"], timeout=30)
        assert r2.status_code == 200
        assert "image" in r2.headers.get("content-type", "")

    @pytest.mark.slow
    def test_visualize_generates_and_caches(self, account):
        ids = [i["id"] for i in account["items"][:3]]
        r = requests.post(f"{API}/stylist/visualize", json={"item_ids": ids}, headers=account["headers"], timeout=180)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["cached"] is False
        assert data["storage_path"]
        # image accessible
        rf = requests.get(f"{API}/files/{data['storage_path']}", headers=account["headers"], timeout=30)
        assert rf.status_code == 200
        assert "image" in rf.headers.get("content-type", "")

        # reversed order -> same key -> cached
        r2 = requests.post(f"{API}/stylist/visualize", json={"item_ids": list(reversed(ids))}, headers=account["headers"], timeout=30)
        assert r2.status_code == 200
        assert r2.json()["cached"] is True

    def test_delete_photo(self, account):
        r = requests.delete(f"{API}/profile/photo", headers=account["headers"], timeout=15)
        assert r.status_code == 200
        prof = requests.get(f"{API}/profile", headers=account["headers"], timeout=15).json()
        assert not prof.get("photo_path")


# ---- Regression: bulk uses upload sequentially ----------------------------
class TestBulkUploadSequential:
    def test_two_uploads(self, account):
        ids = []
        for i in range(2):
            files = {"file": ("item.jpg", _jpeg(400, 600, (50 + i * 40, 100, 150)), "image/jpeg")}
            r = requests.post(f"{API}/items/upload", headers=account["headers"], files=files, timeout=120)
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
        items = requests.get(f"{API}/items", headers=account["headers"], timeout=15).json()
        got = [i["id"] for i in items]
        for iid in ids:
            assert iid in got
