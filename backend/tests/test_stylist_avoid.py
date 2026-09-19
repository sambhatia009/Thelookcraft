"""Focused tests for POST /api/stylist/generate `avoid_item_ids` support (iteration 5)."""
import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://stylevault-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def account():
    email = f"test.avoid+{uuid.uuid4().hex[:10]}@example.com"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/register", json={"name": "Avoid User", "email": email, "password": "pass1234"})
    assert r.status_code == 200, r.text
    tok = r.json()["session_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return {"session": s, "token": tok, "email": email}


class TestStylistAvoid:
    def test_avoid_optional_schema(self, account):
        """avoid_item_ids is optional; absence must still return 200."""
        r = account["session"].post(f"{API}/stylist/generate", json={"prompt": "Casual weekend look"})
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert isinstance(d.get("item_ids"), list) and len(d["item_ids"]) >= 1
        assert d.get("outfit_name")

    def test_avoid_bogus_ids_ignored(self, account):
        """Unknown avoid ids must be silently ignored (still 200)."""
        r = account["session"].post(
            f"{API}/stylist/generate",
            json={"prompt": "Smart casual dinner", "avoid_item_ids": ["does-not-exist-1", "bogus-2"]},
        )
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert len(d["item_ids"]) >= 1

    def test_avoid_returns_different_look(self, account):
        """Same prompt + avoid_item_ids of the first result should return a noticeably different look:
        different outfit_name OR different item_id set. Report overlap count for context."""
        prompt = "Style a smart casual office look"
        r1 = account["session"].post(f"{API}/stylist/generate", json={"prompt": prompt})
        assert r1.status_code == 200, r1.text[:400]
        first = r1.json()
        first_ids = set(first["item_ids"])
        first_name = (first.get("outfit_name") or "").strip().lower()
        assert first_ids, "first result had no item_ids"

        r2 = account["session"].post(
            f"{API}/stylist/generate",
            json={"prompt": prompt, "avoid_item_ids": list(first_ids)},
        )
        assert r2.status_code == 200, r2.text[:400]
        second = r2.json()
        second_ids = set(second["item_ids"])
        second_name = (second.get("outfit_name") or "").strip().lower()

        overlap = first_ids & second_ids
        print(
            f"\n[avoid] first={sorted(first_ids)} name={first_name!r}\n"
            f"[avoid] second={sorted(second_ids)} name={second_name!r}\n"
            f"[avoid] overlap={len(overlap)}/{len(first_ids)} pieces"
        )
        different_set = first_ids != second_ids
        different_name = first_name != second_name and bool(second_name)
        assert different_set or different_name, (
            f"Second look identical to first (name+ids). overlap={len(overlap)} — "
            f"expected NOT identical set OR different name"
        )
