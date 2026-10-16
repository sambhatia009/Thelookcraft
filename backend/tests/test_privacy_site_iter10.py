"""Iteration 10: TheLookCraft public privacy / account-deletion site + static mirror + account flow.

Tests the backend-rendered site under /api/site, the static mirror under /api/site-static,
and the public (unauthenticated) delete-account HTML flow under /api/account.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://stylevault-app.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    return s


# ---------------------------------------------------------------- /api/site (dynamic)
SITE_HTML_PATHS = ["/api/site/", "/api/site/privacy", "/api/site/terms", "/api/site/support", "/api/site/delete-account"]


@pytest.mark.parametrize("path", SITE_HTML_PATHS)
def test_site_html_200(session, path):
    r = session.get(BASE_URL + path, allow_redirects=False, timeout=30)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    ct = r.headers.get("content-type", "")
    assert "text/html" in ct, f"{path} content-type={ct}"
    assert "TheLookCraft" in r.text or "THELOOKCRAFT" in r.text


def test_site_icon_png(session):
    r = session.get(BASE_URL + "/api/site/icon.png", timeout=30)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("image/png")
    assert len(r.content) > 100


def test_site_robots_txt(session):
    r = session.get(BASE_URL + "/api/site/robots.txt", timeout=30)
    assert r.status_code == 200
    assert "User-agent" in r.text


def test_account_privacy_redirect(session):
    r = session.get(BASE_URL + "/api/account/privacy", allow_redirects=False, timeout=30)
    assert r.status_code == 308
    assert r.headers.get("location", "").endswith("/api/site/privacy")


def test_account_delete_request_redirect(session):
    r = session.get(BASE_URL + "/api/account/delete-request", allow_redirects=False, timeout=30)
    assert r.status_code == 308
    assert r.headers.get("location", "").endswith("/api/site/delete-account")


# ---------------------------------------------------------------- /api/site-static (StaticFiles html=True)
STATIC_INDEX_PATHS = [
    "/api/site-static/",
    "/api/site-static/privacy/",
    "/api/site-static/terms/",
    "/api/site-static/support/",
    "/api/site-static/delete-account/",
]


@pytest.mark.parametrize("path", STATIC_INDEX_PATHS)
def test_static_index_200(session, path):
    r = session.get(BASE_URL + path, timeout=30)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    assert "text/html" in r.headers.get("content-type", "")
    assert "TheLookCraft" in r.text or "THELOOKCRAFT" in r.text


STATIC_ASSETS = [
    ("/api/site-static/privacy.html", "text/html"),
    ("/api/site-static/config.js", "javascript"),
    ("/api/site-static/icon.png", "image/png"),
    ("/api/site-static/sitemap.xml", "xml"),
    ("/api/site-static/robots.txt", "text/plain"),
]


@pytest.mark.parametrize("path,expected_ct", STATIC_ASSETS)
def test_static_assets(session, path, expected_ct):
    r = session.get(BASE_URL + path, timeout=30)
    assert r.status_code == 200, f"{path} -> {r.status_code}"
    assert expected_ct in r.headers.get("content-type", ""), (
        f"{path} content-type={r.headers.get('content-type')}"
    )


def test_static_delete_account_relative_links(session):
    """From /api/site-static/delete-account/, relative links ../icon.png, ../config.js, ../privacy.html must resolve."""
    for rel in ("icon.png", "config.js", "privacy.html"):
        url = f"{BASE_URL}/api/site-static/{rel}"
        r = session.get(url, timeout=30)
        assert r.status_code == 200, f"{url} -> {r.status_code}"


def test_static_config_js_backend_url_empty(session):
    r = session.get(BASE_URL + "/api/site-static/config.js", timeout=30)
    assert r.status_code == 200
    assert 'BACKEND_URL: ""' in r.text, "config.js should have empty BACKEND_URL so Option 2 shows fallback"


# ---------------------------------------------------------------- public deletion POST flow
def test_delete_request_valid_email_returns_html_200(session):
    """Resend's magic address 'delivered@resend.dev' is accepted (deliverable). Response is generic HTML."""
    r = session.post(
        BASE_URL + "/api/account/delete-request",
        data={"email": "nobody-xyz@resend.dev"},
        timeout=60,
    )
    assert r.status_code == 200, f"status={r.status_code} body={r.text[:300]}"
    assert "text/html" in r.headers.get("content-type", "")
    # Generic 'Check your email' page (no enumeration)
    assert "Check your email" in r.text or "code" in r.text.lower()


def test_delete_request_undeliverable_returns_400_html(session):
    """example.com is rejected by the email proxy -> friendly 400 HTML, NOT a 5xx."""
    r = session.post(
        BASE_URL + "/api/account/delete-request",
        data={"email": "privacy.qa@example.com"},
        timeout=60,
    )
    assert r.status_code < 500, f"MUST NOT be 5xx: {r.status_code} body={r.text[:300]}"
    assert r.status_code == 400, f"expected 400, got {r.status_code} body={r.text[:300]}"
    assert "text/html" in r.headers.get("content-type", "")
    body_lc = r.text.lower()
    assert "mail" in body_lc or "couldn" in body_lc or "receive" in body_lc


def test_delete_confirm_bad_code_returns_400_html(session):
    r = session.post(
        BASE_URL + "/api/account/delete-confirm",
        data={"email": "delivered@resend.dev", "code": "000000", "mode": "delete"},
        timeout=30,
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code} body={r.text[:300]}"
    assert "text/html" in r.headers.get("content-type", "")
    body_lc = r.text.lower()
    assert "expired" in body_lc or "right" in body_lc or "didn" in body_lc


def test_delete_account_page_posts_to_delete_request(session):
    """The GET /api/site/delete-account page's form must POST to /api/account/delete-request."""
    r = session.get(BASE_URL + "/api/site/delete-account", timeout=30)
    assert r.status_code == 200
    assert 'action="/api/account/delete-request"' in r.text


# ---------------------------------------------------------------- regression smoke
def test_api_root_health(session):
    r = session.get(BASE_URL + "/api/", timeout=30)
    assert r.status_code == 200
    assert "TheLookCraft" in r.text or "message" in r.text.lower()
