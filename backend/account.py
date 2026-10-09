"""Account lifecycle: disable (reversible) or permanently delete a user and every trace of their data.
Also serves the public, login-free deletion-request pages and the privacy policy required by the stores."""
import logging
import secrets
from datetime import timedelta
from html import escape
from typing import Optional

from fastapi import APIRouter, Form, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, EmailStr
from starlette.concurrency import run_in_threadpool

from emailer import send_email

logger = logging.getLogger("stylevault.account")

APP = "TheLookCraft"
SUPPORT_EMAIL = "support@thelookcraft.com"
CODE_MINUTES = 15


class AccountDeleteBody(BaseModel):
    mode: str  # "disable" | "delete"


def build_router(db, now_utc, hash_pw, verify_pw, get_current_user, put_object):
    router = APIRouter(prefix="/account")

    # ----------------------------------------------------------------- core operations
    async def storage_paths(user_id: str) -> list[str]:
        paths = set()
        async for it in db.items.find({"user_id": user_id}, {"_id": 0, "storage_path": 1, "original_storage_path": 1}):
            paths.update(p for p in (it.get("storage_path"), it.get("original_storage_path")) if p)
        async for doc in db.visualizations.find({"user_id": user_id}, {"_id": 0, "storage_path": 1}):
            if doc.get("storage_path"):
                paths.add(doc["storage_path"])
        async for doc in db.outfits.find({"user_id": user_id}, {"_id": 0, "visualization_path": 1}):
            if doc.get("visualization_path"):
                paths.add(doc["visualization_path"])
        async for doc in db.upload_jobs.find({"user_id": user_id}, {"_id": 0, "original_path": 1, "storage_path": 1}):
            paths.update(p for p in (doc.get("original_path"), doc.get("storage_path")) if p)
        profile = await db.profiles.find_one({"user_id": user_id}, {"_id": 0, "photo_path": 1})
        if profile and profile.get("photo_path"):
            paths.add(profile["photo_path"])
        return sorted(paths)

    async def scrub_storage(paths: list[str]) -> int:
        """The object store has no delete API; overwrite each photo with an empty object instead."""
        scrubbed = 0
        for path in paths:
            try:
                await run_in_threadpool(put_object, path, b"", "text/plain")
                scrubbed += 1
            except Exception as exc:
                logger.warning("could not scrub object path=%s type=%s", path, type(exc).__name__)
        return scrubbed

    async def delete_user(user_id: str) -> dict:
        paths = await storage_paths(user_id)
        scrubbed = await scrub_storage(paths)
        counts = {}
        for name in ("items", "outfits", "feedback", "wear_log", "visualizations", "upload_jobs",
                     "profiles", "user_sessions", "client_logs"):
            res = await db[name].delete_many({"user_id": user_id})
            counts[name] = res.deleted_count
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "email": 1})
        if user:
            await db.password_resets.delete_many({"email": user["email"]})
            await db.account_codes.delete_many({"email": user["email"]})
        res = await db.users.delete_one({"user_id": user_id})
        counts["users"] = res.deleted_count
        logger.info("account deleted user=%s photos_scrubbed=%s/%s records=%s", user_id, scrubbed, len(paths), counts)
        return {"deleted": True, "photos_scrubbed": scrubbed, "records": counts}

    async def disable_user(user_id: str) -> dict:
        await db.users.update_one({"user_id": user_id}, {"$set": {"disabled_at": now_utc()}})
        await db.user_sessions.delete_many({"user_id": user_id})
        logger.info("account disabled user=%s", user_id)
        return {"disabled": True}

    async def apply(mode: str, user_id: str) -> dict:
        if mode == "delete":
            return await delete_user(user_id)
        if mode == "disable":
            return await disable_user(user_id)
        raise HTTPException(status_code=400, detail="mode must be 'disable' or 'delete'")

    # ----------------------------------------------------------------- in-app (authenticated)
    @router.post("/close")
    async def close_account(body: AccountDeleteBody, authorization: Optional[str] = Header(None)):
        user = await get_current_user(authorization)
        return await apply(body.mode, user["user_id"])

    # ----------------------------------------------------------------- public, login-free flow
    async def send_code(email: str) -> None:
        window = now_utc() - timedelta(minutes=CODE_MINUTES)
        if await db.account_codes.count_documents({"email": email, "created_at": {"$gte": window}}) >= 3:
            raise HTTPException(status_code=429, detail="Too many requests. Please wait a few minutes and try again.")
        user = await db.users.find_one({"email": email}, {"_id": 0, "name": 1})
        if not user:
            return  # same response either way: never reveal whether an account exists
        code = f"{secrets.randbelow(10 ** 6):06d}"
        await db.account_codes.insert_one({
            "email": email, "code_hash": hash_pw(code), "attempts": 0, "used": False,
            "created_at": now_utc(), "expires_at": now_utc() + timedelta(minutes=CODE_MINUTES),
        })
        greeting = f"Hi {escape(user['name'])}," if user.get("name") else "Hi,"
        html = (
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            '<td style="padding:32px 24px;font-family:Helvetica,Arial,sans-serif;color:#111">'
            f'<p style="font-size:12px;letter-spacing:2px;color:#888;margin:0 0 24px">{APP}</p>'
            f'<p style="font-size:16px;margin:0 0 16px">{greeting}</p>'
            f'<p style="font-size:16px;margin:0 0 16px">Someone asked to disable or delete the {APP} account for this email. '
            "Enter this code on the account page to confirm:</p>"
            f'<p style="font-size:36px;font-weight:700;letter-spacing:8px;margin:0 0 16px">{code}</p>'
            f'<p style="font-size:14px;color:#555;margin:0 0 24px">It expires in {CODE_MINUTES} minutes. '
            "If this wasn&#39;t you, ignore this email — nothing changes without the code.</p>"
            f'<p style="font-size:12px;color:#888;margin:0">Sent by {APP}. We never ask for your password by email.</p>'
            "</td></tr></table>"
        )
        await send_email(to=email, subject=f"Your {APP} account confirmation code", html=html)

    async def verify_code(email: str, code: str) -> dict:
        doc = await db.account_codes.find_one(
            {"email": email, "used": False, "expires_at": {"$gt": now_utc()}}, sort=[("created_at", -1)])
        if not doc or doc.get("attempts", 0) >= 5:
            raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")
        if not verify_pw(code.strip(), doc["code_hash"]):
            await db.account_codes.update_one({"_id": doc["_id"]}, {"$inc": {"attempts": 1}})
            raise HTTPException(status_code=400, detail="That code isn't right. Check the email and try again.")
        await db.account_codes.update_one({"_id": doc["_id"]}, {"$set": {"used": True}})
        user = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1})
        if not user:
            raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")
        return user

    @router.get("/delete-request", response_class=HTMLResponse)
    async def delete_request_page():
        return page("Delete or disable your account", f"""
          <p class="lead">Enter the email you use with {APP}. We'll send a 6-digit code to confirm it's you.
          You can then choose to <b>disable</b> your account (reactivate any time by signing in) or
          <b>delete it permanently</b> together with all your photos and data.</p>
          <form method="post" action="delete-request">
            <label for="email">EMAIL</label>
            <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com">
            <button type="submit">SEND CODE</button>
          </form>
          <p class="fine">No account for that email? Nothing will be sent. Questions: <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a></p>
        """)

    @router.post("/delete-request", response_class=HTMLResponse)
    async def delete_request_send(email: EmailStr = Form(...)):
        email = email.lower().strip()
        try:
            await send_code(email)
        except HTTPException as exc:
            return page("Please wait", f'<p class="lead">{escape(exc.detail)}</p><p><a href="delete-request">Back</a></p>', status=exc.status_code)
        return page("Check your email", f"""
          <p class="lead">If an account exists for <b>{escape(email)}</b>, a 6-digit code is on its way. It expires in {CODE_MINUTES} minutes.</p>
          <form method="post" action="delete-confirm">
            <input type="hidden" name="email" value="{escape(email)}">
            <label for="code">6-DIGIT CODE</label>
            <input id="code" name="code" inputmode="numeric" pattern="[0-9]{{6}}" maxlength="6" required autocomplete="one-time-code" placeholder="123456">
            <label>WHAT WOULD YOU LIKE TO DO?</label>
            <label class="opt"><input type="radio" name="mode" value="disable" checked>
              <span><b>Disable my account</b><br><small>Hidden and signed out everywhere. Sign in again any time to reactivate — nothing is lost.</small></span></label>
            <label class="opt"><input type="radio" name="mode" value="delete">
              <span><b>Delete my account permanently</b><br><small>Removes your profile, closet photos, looks, feedback and sessions. This cannot be undone.</small></span></label>
            <button type="submit">CONFIRM</button>
          </form>
          <p class="fine">Didn't get it? <a href="delete-request">Request a new code</a>.</p>
        """)

    @router.post("/delete-confirm", response_class=HTMLResponse)
    async def delete_confirm(email: EmailStr = Form(...), code: str = Form(...), mode: str = Form(...)):
        email = email.lower().strip()
        try:
            user = await verify_code(email, code)
            result = await apply(mode, user["user_id"])
        except HTTPException as exc:
            return page("That didn't work", f'<p class="lead">{escape(exc.detail)}</p><p><a href="delete-request">Start again</a></p>', status=exc.status_code)
        if result.get("deleted"):
            return page("Account deleted", f"""<p class="lead">Your {APP} account and all associated data have been permanently deleted.
              {result['photos_scrubbed']} photo(s) were wiped from storage. We're sorry to see you go.</p>""")
        return page("Account disabled", f"""<p class="lead">Your {APP} account is now disabled and you've been signed out on every device.
          Whenever you like, simply sign in again to reactivate it — your closet and looks will be exactly as you left them.</p>""")

    @router.get("/privacy", response_class=HTMLResponse)
    async def privacy_policy():
        return page("Privacy Policy", PRIVACY_HTML)

    return router, apply


def page(title: str, body: str, status: int = 200) -> HTMLResponse:
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)} · {APP}</title>
<style>
  body{{margin:0;background:#000;color:#fff;font-family:Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}}
  main{{max-width:560px;margin:0 auto;padding:40px 24px 64px}}
  .brand{{font-size:12px;letter-spacing:3px;color:#888;margin-bottom:32px}}
  h1{{font-size:28px;font-weight:900;letter-spacing:.5px;margin:0 0 16px}}
  h2{{font-size:14px;letter-spacing:2px;margin:32px 0 8px}}
  p,li{{font-size:16px;line-height:1.5;color:#ddd}} .lead{{color:#fff}} .fine{{font-size:13px;color:#888}}
  a{{color:#fff}} label{{display:block;font-size:12px;letter-spacing:2px;margin:20px 0 8px}}
  input[type=email],input[type=text],input:not([type]){{width:100%;box-sizing:border-box;background:#000;color:#fff;border:1px solid #fff;padding:14px;font-size:16px}}
  input#code{{width:100%;box-sizing:border-box;background:#000;color:#fff;border:1px solid #fff;padding:14px;font-size:22px;letter-spacing:8px}}
  .opt{{display:flex;gap:12px;align-items:flex-start;border:1px solid #333;padding:14px;margin:8px 0;letter-spacing:0;font-size:15px;cursor:pointer}}
  .opt small{{color:#aaa}} .opt input{{margin-top:4px}}
  button{{width:100%;margin-top:24px;background:#fff;color:#000;border:0;padding:16px;font-size:14px;font-weight:700;letter-spacing:2px;cursor:pointer}}
</style></head><body><main><div class="brand">{APP}</div><h1>{escape(title)}</h1>{body}</main></body></html>"""
    return HTMLResponse(html, status_code=status)


PRIVACY_HTML = f"""
<p class="fine">Effective: 1 June 2026</p>
<p class="lead">{APP} ("we", "us") is a personal wardrobe and AI styling app. This policy explains what we collect, why, and the control you have over it.</p>
<h2>WHAT WE COLLECT</h2>
<ul>
  <li><b>Account:</b> name, email address and a hashed password, or your Google account identity if you sign in with Google.</li>
  <li><b>Wardrobe photos:</b> pictures of clothing you upload, plus AI-generated tags (category, colour, style) and optional notes.</li>
  <li><b>Profile &amp; styling preferences:</b> dress code, fit, colour palette, climate, optional gender, age range and an optional personal photo used only to visualise outfits on you.</li>
  <li><b>Usage inside the app:</b> saved looks, wear history, thumbs-up/down feedback on suggestions and upload diagnostics (device platform, OS version, error messages) used to keep uploads reliable.</li>
  <li><b>Location (optional):</b> approximate location, only while you use weather-aware styling. It is sent to a weather service and is not stored.</li>
</ul>
<h2>HOW WE USE IT</h2>
<ul>
  <li>To store your closet and build outfit suggestions and visualisations from it.</li>
  <li>To process photos with AI services (clothing recognition, styling and image generation). Photos are sent to these processors solely to deliver the feature you requested; they are not used to train our models.</li>
  <li>To send transactional emails you request (password reset, account confirmation codes). We do not send marketing email.</li>
</ul>
<h2>SHARING</h2>
<p>We do not sell your data. Data is shared only with the service providers that run the app (cloud hosting, database, object storage, AI image/text processing, email delivery and weather data), each bound to process it on our behalf. Looks you choose to share are shared by you, through your device's share sheet.</p>
<h2>RETENTION &amp; YOUR CHOICES</h2>
<ul>
  <li>Your data is kept while your account is active.</li>
  <li><b>Disable</b> your account to hide it and sign out everywhere; sign in again to reactivate.</li>
  <li><b>Delete</b> your account at any time from Profile → Privacy &amp; Data in the app, or without the app at <a href="delete-request">this page</a>. Deletion permanently removes your profile, photos, looks, feedback and sessions.</li>
  <li>You can delete individual photos, looks and your personal photo inside the app at any time.</li>
</ul>
<h2>SECURITY</h2>
<p>Data is encrypted in transit. Passwords are stored only as salted hashes. Photos are stored in private object storage and are served only to the signed-in owner.</p>
<h2>CHILDREN</h2>
<p>{APP} is not directed at children under 13 and we do not knowingly collect their data.</p>
<h2>CONTACT</h2>
<p>Questions or requests: <a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>. We may update this policy; material changes will be announced in the app.</p>
"""
