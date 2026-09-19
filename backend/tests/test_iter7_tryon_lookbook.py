"""Iteration 7 backend tests: saved-look try-on persistence, validation, and outfit lifecycle."""

import io
import os
import uuid

import pytest
import requests
from PIL import Image, ImageDraw


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    pytest.skip("EXPO_PUBLIC_BACKEND_URL is required", allow_module_level=True)
API = f"{BASE_URL}/api"


def _make_feature_photo_bytes(width: int = 720, height: int = 1080) -> bytes:
    """Generate a non-uniform JPEG with visible edges/features for upload testing."""
    img = Image.new("RGB", (width, height), (210, 215, 220))
    draw = ImageDraw.Draw(img)
    for y in range(0, height, 20):
        color = (80 + (y % 120), 120 + (y % 80), 140 + (y % 100))
        draw.line([(0, y), (width, y)], fill=color, width=2)
    draw.rectangle((80, 120, width - 80, height - 180), outline=(20, 20, 20), width=6)
    draw.ellipse((width // 3, 220, width // 3 + 150, 380), fill=(170, 130, 120), outline=(30, 30, 30), width=3)
    draw.polygon([(120, height - 260), (width // 2, height - 420), (width - 120, height - 260)], fill=(60, 70, 90))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _register_user(name_prefix: str) -> dict:
    email = f"{name_prefix}.{uuid.uuid4().hex[:10]}@example.com"
    res = requests.post(
        f"{API}/auth/register",
        json={"name": name_prefix, "email": email, "password": "pass1234"},
        timeout=40,
    )
    assert res.status_code == 200, res.text
    token = res.json()["session_token"]
    headers = {"Authorization": f"Bearer {token}"}
    return {"email": email, "token": token, "headers": headers}


def _get_items(headers: dict) -> list[dict]:
    res = requests.get(f"{API}/items", headers=headers, timeout=30)
    assert res.status_code == 200, res.text
    items = res.json()
    assert len(items) >= 3
    return items


def _upload_profile_photo(headers: dict) -> str:
    files = {"file": ("profile.jpg", _make_feature_photo_bytes(), "image/jpeg")}
    res = requests.post(f"{API}/profile/photo", headers=headers, files=files, timeout=90)
    assert res.status_code == 200, res.text
    path = res.json().get("photo_path")
    assert path and "profile/" in path
    return path


# Feature group: auth and saved outfit creation basics
class TestOutfitSaveBasics:
    def test_unauthenticated_visualize_denied(self):
        res = requests.post(f"{API}/outfits/does-not-matter/visualize", timeout=20)
        assert res.status_code == 401

    def test_normal_save_without_image_supported(self):
        user = _register_user("iter7_basic")
        items = _get_items(user["headers"])
        payload = {
            "title": "TEST_basic_no_image",
            "item_ids": [items[0]["id"], items[1]["id"], items[2]["id"]],
            "stylist_note": "basic save",
            "occasion": "Casual",
        }
        save = requests.post(f"{API}/outfits", headers=user["headers"], json=payload, timeout=30)
        assert save.status_code == 200, save.text
        data = save.json()
        assert data["title"] == payload["title"]
        assert data.get("visualization_path") is None
        assert len(data.get("items", [])) == 3


# Feature group: visualize saved look and verify persistence/caching/deletion constraints
class TestSavedLookVisualize:
    @pytest.fixture(scope="class")
    def owner(self):
        user = _register_user("iter7_owner")
        items = _get_items(user["headers"])
        payload = {
            "title": "TEST_visualize_saved",
            "item_ids": [items[0]["id"], items[1]["id"], items[2]["id"]],
            "stylist_note": "visualize this",
        }
        save = requests.post(f"{API}/outfits", headers=user["headers"], json=payload, timeout=30)
        assert save.status_code == 200, save.text
        user["items"] = items
        user["outfit"] = save.json()
        return user

    def test_missing_profile_photo_returns_400(self, owner):
        res = requests.post(f"{API}/outfits/{owner['outfit']['id']}/visualize", headers=owner["headers"], timeout=120)
        assert res.status_code == 400
        assert "photo" in res.json().get("detail", "").lower()

    def test_visualize_generates_and_persists_and_repeat_no_regen(self, owner):
        _upload_profile_photo(owner["headers"])
        first = requests.post(f"{API}/outfits/{owner['outfit']['id']}/visualize", headers=owner["headers"], timeout=240)
        assert first.status_code == 200, first.text
        first_data = first.json()
        path = first_data.get("visualization_path")
        assert path and "/looks/" in path
        assert isinstance(first_data.get("items"), list) and len(first_data["items"]) == 3

        listing = requests.get(f"{API}/outfits", headers=owner["headers"], timeout=30)
        assert listing.status_code == 200
        listed = next((o for o in listing.json() if o["id"] == owner["outfit"]["id"]), None)
        assert listed is not None
        assert listed.get("visualization_path") == path
        assert len(listed.get("items", [])) == 3

        second = requests.post(f"{API}/outfits/{owner['outfit']['id']}/visualize", headers=owner["headers"], timeout=120)
        assert second.status_code == 200
        assert second.json().get("visualization_path") == path

    def test_unknown_deleted_foreign_ids_denied(self, owner):
        missing = requests.post(f"{API}/outfits/not-a-real-id/visualize", headers=owner["headers"], timeout=20)
        assert missing.status_code == 404

        foreign = _register_user("iter7_foreign")
        foreign_try = requests.post(f"{API}/outfits/{owner['outfit']['id']}/visualize", headers=foreign["headers"], timeout=20)
        assert foreign_try.status_code == 404

        own_delete = requests.delete(f"{API}/outfits/{owner['outfit']['id']}", headers=owner["headers"], timeout=20)
        assert own_delete.status_code == 200
        deleted_try = requests.post(f"{API}/outfits/{owner['outfit']['id']}/visualize", headers=owner["headers"], timeout=20)
        assert deleted_try.status_code == 404

    def test_unavailable_items_denied(self):
        user = _register_user("iter7_unavailable")
        items = _get_items(user["headers"])
        save = requests.post(
            f"{API}/outfits",
            headers=user["headers"],
            json={"title": "TEST_unavailable", "item_ids": [items[0]["id"], items[1]["id"], items[2]["id"]]},
            timeout=30,
        )
        assert save.status_code == 200, save.text
        _upload_profile_photo(user["headers"])
        delete_item = requests.delete(f"{API}/items/{items[2]['id']}", headers=user["headers"], timeout=20)
        assert delete_item.status_code == 200
        viz = requests.post(f"{API}/outfits/{save.json()['id']}/visualize", headers=user["headers"], timeout=60)
        assert viz.status_code == 400
        assert "available" in viz.json().get("detail", "").lower()


# Feature group: save/patch visualization_path validation and lifecycle actions
class TestVisualizationPathValidationAndLifecycle:
    @pytest.fixture(scope="class")
    def primary(self):
        user = _register_user("iter7_path_main")
        items = _get_items(user["headers"])
        profile_path = _upload_profile_photo(user["headers"])
        ids_a = [items[0]["id"], items[1]["id"], items[2]["id"]]
        ids_b = [items[1]["id"], items[2]["id"], items[3]["id"]]
        viz_a = requests.post(f"{API}/stylist/visualize", headers=user["headers"], json={"item_ids": ids_a, "outfit_name": "A"}, timeout=240)
        assert viz_a.status_code == 200, viz_a.text
        viz_b = requests.post(f"{API}/stylist/visualize", headers=user["headers"], json={"item_ids": ids_b, "outfit_name": "B"}, timeout=240)
        assert viz_b.status_code == 200, viz_b.text
        user.update({"items": items, "ids_a": ids_a, "ids_b": ids_b, "viz_a": viz_a.json()["storage_path"], "viz_b": viz_b.json()["storage_path"], "profile_path": profile_path})
        return user

    def test_post_with_existing_real_visualization_path_saves(self, primary):
        save = requests.post(
            f"{API}/outfits",
            headers=primary["headers"],
            json={
                "title": "TEST_post_with_viz",
                "item_ids": primary["ids_a"],
                "stylist_note": "with render",
                "visualization_path": primary["viz_a"],
            },
            timeout=30,
        )
        assert save.status_code == 200, save.text
        assert save.json().get("visualization_path") == primary["viz_a"]

    def test_patch_attach_path_no_duplicate_and_preserve_on_tag_title_wear_delete(self, primary):
        base = requests.post(
            f"{API}/outfits",
            headers=primary["headers"],
            json={"title": "TEST_patch_attach", "item_ids": primary["ids_a"], "stylist_note": "attach later"},
            timeout=30,
        )
        assert base.status_code == 200, base.text
        outfit_id = base.json()["id"]

        before_count = requests.get(f"{API}/outfits", headers=primary["headers"], timeout=30).json()
        before_len = len(before_count)

        attach = requests.patch(
            f"{API}/outfits/{outfit_id}",
            headers=primary["headers"],
            json={"visualization_path": primary["viz_a"]},
            timeout=30,
        )
        assert attach.status_code == 200, attach.text
        assert attach.json().get("visualization_path") == primary["viz_a"]

        after = requests.get(f"{API}/outfits", headers=primary["headers"], timeout=30).json()
        assert len(after) == before_len
        assert len([o for o in after if o["id"] == outfit_id]) == 1

        edit = requests.patch(
            f"{API}/outfits/{outfit_id}",
            headers=primary["headers"],
            json={"title": "TEST_patch_attach_edited", "occasion": "Work"},
            timeout=30,
        )
        assert edit.status_code == 200
        assert edit.json().get("visualization_path") == primary["viz_a"]

        wear = requests.post(f"{API}/outfits/{outfit_id}/wear", headers=primary["headers"], timeout=30)
        assert wear.status_code == 200
        assert wear.json().get("ok") is True

        listing_after_wear = requests.get(f"{API}/outfits", headers=primary["headers"], timeout=30).json()
        worn = next((o for o in listing_after_wear if o["id"] == outfit_id), None)
        assert worn is not None and int(worn.get("wear_count") or 0) >= 1

        delete = requests.delete(f"{API}/outfits/{outfit_id}", headers=primary["headers"], timeout=20)
        assert delete.status_code == 200
        listing_after_delete = requests.get(f"{API}/outfits", headers=primary["headers"], timeout=30).json()
        assert next((o for o in listing_after_delete if o["id"] == outfit_id), None) is None

    def test_reject_arbitrary_foreign_profile_and_wrong_itemset_paths(self, primary):
        arbitrary = requests.post(
            f"{API}/outfits",
            headers=primary["headers"],
            json={"title": "TEST_bad_path", "item_ids": primary["ids_a"], "visualization_path": "stylevault/uploads/user_x/looks/fake.jpg"},
            timeout=30,
        )
        assert arbitrary.status_code == 400

        profile_path_reject = requests.post(
            f"{API}/outfits",
            headers=primary["headers"],
            json={"title": "TEST_profile_path_reject", "item_ids": primary["ids_a"], "visualization_path": primary["profile_path"]},
            timeout=30,
        )
        assert profile_path_reject.status_code == 400

        wrong_item_set = requests.post(
            f"{API}/outfits",
            headers=primary["headers"],
            json={"title": "TEST_wrong_set", "item_ids": primary["ids_a"], "visualization_path": primary["viz_b"]},
            timeout=30,
        )
        assert wrong_item_set.status_code == 400

        patch_target = requests.post(
            f"{API}/outfits",
            headers=primary["headers"],
            json={"title": "TEST_patch_wrong_set", "item_ids": primary["ids_a"]},
            timeout=30,
        )
        assert patch_target.status_code == 200
        patch_wrong = requests.patch(
            f"{API}/outfits/{patch_target.json()['id']}",
            headers=primary["headers"],
            json={"visualization_path": primary["viz_b"]},
            timeout=30,
        )
        assert patch_wrong.status_code == 400

        other = _register_user("iter7_path_other")
        other_items = _get_items(other["headers"])
        _upload_profile_photo(other["headers"])
        other_viz = requests.post(
            f"{API}/stylist/visualize",
            headers=other["headers"],
            json={"item_ids": [other_items[0]["id"], other_items[1]["id"], other_items[2]["id"]], "outfit_name": "other"},
            timeout=240,
        )
        assert other_viz.status_code == 200, other_viz.text
        foreign_path = other_viz.json()["storage_path"]

        foreign_reject = requests.post(
            f"{API}/outfits",
            headers=primary["headers"],
            json={"title": "TEST_foreign_path", "item_ids": primary["ids_a"], "visualization_path": foreign_path},
            timeout=30,
        )
        assert foreign_reject.status_code == 400
