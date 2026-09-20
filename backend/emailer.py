"""Transactional email through Emergent's managed email proxy (see RESEND_EMAIL_PLAYBOOK).
Bodies come from fixed server-side templates only; recipients from server-side records."""
import ipaddress
import logging
import os
import re
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

logger = logging.getLogger("stylevault.email")

# Emergent managed email proxy. Constant on purpose (survives deployment).
EMAIL_BASE_URL = "https://integrations.emergentagent.com"


def _config():
    key = os.environ.get("EMERGENT_EMAIL_KEY")
    from_name = os.environ.get("EMAIL_FROM_NAME")
    if not key or not from_name:
        raise HTTPException(status_code=503, detail="Email is not configured")
    return key, from_name, os.environ.get("EMAIL_REPLY_TO")


# --- Guardrail gate (structural G2/G3 checks; copied from the playbook) -------------------------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    key, from_name, reply_to = _config()
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": from_name}
    if reply_to:
        payload["contact_email"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": key}, json=payload)
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error("email send failed status=%s body=%s", e.response.status_code, e.response.text[:300])
        raise HTTPException(status_code=502, detail="Could not send the email right now. Please try again.")
    except Exception as e:
        logger.error("email send error type=%s", type(e).__name__)
        raise HTTPException(status_code=502, detail="Could not send the email right now. Please try again.")


async def send_password_reset_code(*, to: str, name: str | None, code: str, minutes: int) -> str | None:
    _, from_name, _ = _config()
    brand = escape(from_name)
    greeting = f"Hi {escape(name)}," if name else "Hi,"
    html = (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        '<tr><td style="padding:32px 24px;font-family:Helvetica,Arial,sans-serif;color:#111">'
        f'<p style="font-size:12px;letter-spacing:2px;color:#888;margin:0 0 24px">{brand}</p>'
        f'<p style="font-size:16px;margin:0 0 16px">{greeting}</p>'
        f'<p style="font-size:16px;margin:0 0 16px">Use this code in the {brand} app to choose a new password:</p>'
        f'<p style="font-size:36px;font-weight:700;letter-spacing:8px;margin:0 0 16px">{escape(code)}</p>'
        f'<p style="font-size:14px;color:#555;margin:0 0 24px">It expires in {int(minutes)} minutes. '
        "If you didn&#39;t request this, you can safely ignore this email — your password stays unchanged.</p>"
        f'<p style="font-size:12px;color:#888;margin:0">Sent by {brand}. We never ask for your password by email.</p>'
        "</td></tr></table>"
    )
    return await send_email(to=to, subject=f"Your {from_name} password reset code", html=html)
