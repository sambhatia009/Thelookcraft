import os
import io
import re
import json
import time
import uuid
import asyncio
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import httpx
import requests
from fastapi import FastAPI, APIRouter, HTTPException, Header, UploadFile, File, Query, Request
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from upload_jobs import UploadJobs, UploadJobResult, MAX_BYTES

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("stylevault")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------------------------------------------------------------------------
# LLM (Emergent universal key -> Gemini 3 Flash)
# ---------------------------------------------------------------------------
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
GEMINI_MODEL = "gemini-3-flash-preview"  # vision tagging (fast)
STYLIST_MODEL = "gemini-3.1-pro-preview"  # stylist reasoning (stronger)
IMAGE_MODEL = "gemini-3.1-flash-image-preview"  # Nano Banana: outfit visualisation on the user's photo

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # noqa: E402

# ---------------------------------------------------------------------------
# Object storage
# ---------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "stylevault"
_storage_key = None


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------------------------------------------------------------------
# Background removal (rembg)
# ---------------------------------------------------------------------------
_rembg_session = None


def remove_background(data: bytes) -> bytes:
    """Return a transparent PNG cutout. Falls back to original bytes on failure."""
    global _rembg_session
    try:
        from rembg import remove, new_session
        from PIL import Image

        if _rembg_session is None:
            _rembg_session = new_session("u2net")
        img = Image.open(io.BytesIO(data)).convert("RGBA")
        img.thumbnail((1200, 1200))
        out = remove(img, session=_rembg_session)
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()
    except Exception as e:  # pragma: no cover
        logger.warning(f"background removal failed: {e}")
        return data


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI()
api_router = APIRouter(prefix="/api")

CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterBody(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class SessionBody(BaseModel):
    session_id: str


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    color: Optional[str] = None
    formality: Optional[str] = None
    fabric: Optional[str] = None
    season: Optional[str] = None
    notes: Optional[str] = None
    preference: Optional[str] = None  # "avoid" → never suggest in looks; "neutral" → clear


class FeedbackBody(BaseModel):
    verdict: str  # "up" | "down"
    item_ids: List[str]
    outfit_name: Optional[str] = None
    prompt: Optional[str] = None


class OutfitBody(BaseModel):
    title: str
    item_ids: List[str]
    stylist_note: str = ""
    occasion: str = ""
    visualization_path: Optional[str] = None


class OutfitUpdate(BaseModel):
    occasion: Optional[str] = None
    title: Optional[str] = None
    visualization_path: Optional[str] = None


class SavedOutfit(BaseModel):
    id: str
    user_id: str
    title: str
    item_ids: List[str]
    stylist_note: str = ""
    occasion: str = ""
    visualization_path: Optional[str] = None
    items: List[dict] = Field(default_factory=list)
    created_at: datetime
    wear_count: int = 0
    last_worn_at: Optional[datetime] = None


class VisualizationResult(BaseModel):
    storage_path: str
    cached: bool


class StylistBody(BaseModel):
    prompt: str
    focus_item_id: Optional[str] = None
    weather_context: Optional[str] = None
    avoid_item_ids: Optional[List[str]] = None  # ids of a look the user already saw → ask for a different one
    prefer_unworn: Optional[bool] = False  # build the look around pieces the user hasn't worn yet


class ProfileBody(BaseModel):
    dress_code: Optional[str] = None
    body_fit: Optional[str] = None
    color_palette: Optional[List[str]] = None
    weather: Optional[str] = None
    gender: Optional[str] = None  # Female / Male / Non-binary / Prefer not to say
    age: Optional[int] = None


class VisualizeBody(BaseModel):
    item_ids: List[str]
    outfit_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_utc():
    return datetime.now(timezone.utc)


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


async def create_session(user_id: str) -> str:
    token = f"sv_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=7),
    })
    return token


async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1].strip()
    return await user_from_token(token)


async def user_from_token(token: str):
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = session["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


MOCK_ITEMS = [
    {"name": "Navy Oxford Shirt", "category": "Tops", "subcategory": "Shirt", "color": "Navy",
     "formality": "Smart Casual", "fabric": "Cotton", "season": "All Season",
     "image_url": "https://images.unsplash.com/photo-1581655353564-df123a1eb820?crop=entropy&cs=srgb&fm=jpg&w=800&q=80"},
    {"name": "Khaki Chinos", "category": "Bottoms", "subcategory": "Chinos", "color": "Khaki",
     "formality": "Smart Casual", "fabric": "Cotton Twill", "season": "All Season",
     "image_url": "https://images.pexels.com/photos/1082529/pexels-photo-1082529.jpeg?auto=compress&cs=tinysrgb&w=800"},
    {"name": "White Leather Sneakers", "category": "Shoes", "subcategory": "Sneakers", "color": "White",
     "formality": "Casual", "fabric": "Leather", "season": "Spring/Summer",
     "image_url": "https://images.pexels.com/photos/2529148/pexels-photo-2529148.jpeg?auto=compress&cs=tinysrgb&w=800"},
    {"name": "Charcoal Blazer", "category": "Outerwear", "subcategory": "Blazer", "color": "Charcoal",
     "formality": "Formal", "fabric": "Wool Blend", "season": "Autumn/Winter",
     "image_url": "https://images.pexels.com/photos/1300550/pexels-photo-1300550.jpeg?auto=compress&cs=tinysrgb&w=800"},
    {"name": "Brown Leather Belt", "category": "Accessories", "subcategory": "Belt", "color": "Brown",
     "formality": "Smart Casual", "fabric": "Leather", "season": "All Season",
     "image_url": "https://images.pexels.com/photos/1240892/pexels-photo-1240892.jpeg?auto=compress&cs=tinysrgb&w=800"},
]


async def seed_wardrobe(user_id: str):
    docs = []
    for m in MOCK_ITEMS:
        docs.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "storage_path": None,
            "is_mock": True,
            "deleted_at": None,
            "created_at": now_utc(),
            **m,
        })
    if docs:
        await db.items.insert_many(docs)


def clean_item(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(body: RegisterBody):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": user_id,
        "email": body.email.lower(),
        "name": body.name,
        "password": hash_pw(body.password),
        "picture": None,
        "auth_provider": "password",
        "created_at": now_utc(),
    }
    await db.users.insert_one(user)
    await db.profiles.insert_one({
        "user_id": user_id, "dress_code": "Smart Casual", "body_fit": "Regular",
        "color_palette": ["Navy", "White", "Charcoal"], "weather": "Temperate",
    })
    await seed_wardrobe(user_id)
    token = await create_session(user_id)
    return {"session_token": token, "user": {"user_id": user_id, "email": user["email"], "name": user["name"], "picture": None}}


@api_router.post("/auth/login")
async def login(body: LoginBody):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not user.get("password") or not verify_pw(body.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = await create_session(user["user_id"])
    return {"session_token": token, "user": {"user_id": user["user_id"], "email": user["email"], "name": user["name"], "picture": user.get("picture")}}


@api_router.post("/auth/session")
async def google_session(body: SessionBody):
    async with httpx.AsyncClient(timeout=30) as hc:
        resp = await hc.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": body.session_id},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    data = resp.json()
    email = data.get("email", "").lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id, "email": email, "name": data.get("name"),
            "picture": data.get("picture"), "auth_provider": "google", "created_at": now_utc(),
        })
        await db.profiles.insert_one({
            "user_id": user_id, "dress_code": "Smart Casual", "body_fit": "Regular",
            "color_palette": ["Navy", "White", "Charcoal"], "weather": "Temperate",
        })
        await seed_wardrobe(user_id)
    token = await create_session(user_id)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password": 0})
    return {"session_token": token, "user": user}


@api_router.get("/auth/me")
async def me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return user


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------
async def tag_image(image_bytes: bytes) -> dict:
    import base64
    b64 = base64.b64encode(image_bytes).decode()
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"tag-{uuid.uuid4().hex[:8]}",
        system_message=(
            "You are a fashion cataloguing assistant. Analyse the clothing/footwear/accessory "
            "in the image and return ONLY a compact JSON object with keys: name (short product name), "
            f"category (one of {CATEGORIES}), subcategory, color, formality (Casual/Smart Casual/Formal), "
            "fabric, season (All Season/Spring/Summer/Autumn/Winter). No markdown, JSON only."
        ),
    ).with_model("gemini", GEMINI_MODEL)
    msg = UserMessage(text="Tag this item.", file_contents=[ImageContent(image_base64=b64)])
    try:
        raw = await chat.send_message(msg)
        return parse_json(raw)
    except Exception as e:
        logger.warning(f"tagging failed: {e}")
        return {}


def parse_json(raw: str) -> dict:
    if not raw:
        return {}
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


def downscale_for_vision(data: bytes, max_edge: int = 1024) -> bytes:
    """Shrink large photos before base64-encoding them for the vision model (faster, cheaper)."""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(data))
        if max(img.size) <= max_edge:
            return data
        img = img.convert("RGB")
        img.thumbnail((max_edge, max_edge))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()
    except Exception as e:  # pragma: no cover
        logger.warning(f"downscale failed: {e}")
        return data


@api_router.post("/items/upload")
async def upload_item(authorization: Optional[str] = Header(None), file: UploadFile = File(...)):
    user = await get_current_user(authorization)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image")
    t0 = time.monotonic()

    small = await run_in_threadpool(downscale_for_vision, raw)
    tags, cutout = await asyncio.gather(tag_image(small), run_in_threadpool(remove_background, raw))
    item_id = str(uuid.uuid4())
    path = f"{APP_NAME}/uploads/{user['user_id']}/{item_id}.png"
    await run_in_threadpool(put_object, path, cutout, "image/png")
    logger.info(f"upload {len(raw)/1e6:.2f}MB processed in {time.monotonic() - t0:.1f}s")

    category = tags.get("category")
    if category not in CATEGORIES:
        category = "Tops"
    doc = {
        "id": item_id,
        "user_id": user["user_id"],
        "name": tags.get("name") or "New Item",
        "category": category,
        "subcategory": tags.get("subcategory") or "",
        "color": tags.get("color") or "",
        "formality": tags.get("formality") or "Casual",
        "fabric": tags.get("fabric") or "",
        "season": tags.get("season") or "All Season",
        "storage_path": path,
        "image_url": None,
        "is_mock": False,
        "deleted_at": None,
        "created_at": now_utc(),
    }
    await db.items.insert_one(doc)
    return clean_item(doc)


@api_router.post("/items/upload-jobs/{job_id}", response_model=UploadJobResult, status_code=202)
async def create_upload_job(job_id: str, request: Request, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    upload_jobs.identity(user["user_id"], job_id)
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, "Photo is too large. Choose a photo smaller than 16 MB.")
    return await upload_jobs.accept(user["user_id"], job_id, bytes(raw))


@api_router.get("/items/upload-jobs/{job_id}", response_model=UploadJobResult)
async def get_upload_job(job_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return await upload_jobs.result(user["user_id"], job_id)


@api_router.get("/items")
async def list_items(authorization: Optional[str] = Header(None), category: Optional[str] = None):
    user = await get_current_user(authorization)
    q = {"user_id": user["user_id"], "deleted_at": None}
    if category and category != "All":
        q["category"] = category
    items = await db.items.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return items


@api_router.patch("/items/{item_id}")
async def update_item(item_id: str, body: ItemUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if "preference" in updates and updates["preference"] not in ("avoid", "neutral"):
        raise HTTPException(status_code=400, detail="preference must be 'avoid' or 'neutral'")
    if updates:
        await db.items.update_one({"id": item_id, "user_id": user["user_id"]}, {"$set": updates})
    doc = await db.items.find_one({"id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Item not found")
    return doc


@api_router.delete("/items/{item_id}")
async def delete_item(item_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.items.update_one({"id": item_id, "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}})
    return {"ok": True}


@api_router.get("/files/{path:path}")
async def serve_file(path: str, token: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    tok = token
    if not tok and authorization and authorization.startswith("Bearer "):
        tok = authorization.split(" ", 1)[1].strip()
    if not tok:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await user_from_token(tok)
    # Ownership: a user may only read their own uploads.
    if not path.startswith(f"{APP_NAME}/uploads/{user['user_id']}/"):
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        content, ctype = await run_in_threadpool(get_object, path)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")
    return Response(content=content, media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})


# ---------------------------------------------------------------------------
# Stylist
# ---------------------------------------------------------------------------
async def taste_summary(user_id: str, names_by_id: dict) -> str:
    """Compress thumbs up/down history into a few lines the stylist can act on."""
    fb = await db.feedback.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    avoided_ids = await _avoided_ids(user_id)
    avoided = [v for k, v in names_by_id.items() if k in avoided_ids]
    if not fb and not avoided:
        return ""
    liked_items: dict = {}
    disliked_items: dict = {}
    liked_looks: List[str] = []
    disliked_looks: List[str] = []
    for f in fb:
        names = [names_by_id[i] for i in f.get("item_ids", []) if i in names_by_id]
        if not names:
            continue
        bucket = liked_items if f["verdict"] == "up" else disliked_items
        for n in names:
            bucket[n] = bucket.get(n, 0) + 1
        looks = liked_looks if f["verdict"] == "up" else disliked_looks
        if len(looks) < 5:
            looks.append(" + ".join(names))
    lines = []
    if liked_looks:
        lines.append("LIKED looks: " + " | ".join(liked_looks))
    if disliked_looks:
        lines.append("DISLIKED looks (do not repeat these combinations): " + " | ".join(disliked_looks))
    # Pieces that are disliked clearly more than liked → steer away from them.
    steer_away = [n for n, c in disliked_items.items() if c >= 2 and c > liked_items.get(n, 0)]
    if steer_away:
        lines.append("Pieces the user keeps rejecting (use sparingly, only if the request demands): " + ", ".join(steer_away))
    favorites = [n for n, c in liked_items.items() if c >= 2 and c > disliked_items.get(n, 0)]
    if favorites:
        lines.append("Pieces the user keeps approving: " + ", ".join(favorites))
    if avoided:
        lines.append("Pieces the user explicitly banned from suggestions (already removed from wardrobe list): " + ", ".join(avoided))
    return "\n".join(lines)


async def _avoided_ids(user_id: str) -> set:
    docs = await db.items.find({"user_id": user_id, "deleted_at": None, "preference": "avoid"}, {"_id": 0, "id": 1}).to_list(1000)
    return {d["id"] for d in docs}


@api_router.post("/stylist/feedback")
async def stylist_feedback(body: FeedbackBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    if body.verdict not in ("up", "down"):
        raise HTTPException(status_code=400, detail="verdict must be 'up' or 'down'")
    if not body.item_ids:
        raise HTTPException(status_code=400, detail="item_ids required")
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "verdict": body.verdict,
        "item_ids": body.item_ids,
        "outfit_name": body.outfit_name,
        "prompt": body.prompt,
        "created_at": now_utc(),
    }
    await db.feedback.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/stylist/taste")
async def stylist_taste(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    fb = await db.feedback.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
    items = await db.items.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).to_list(1000)
    avoided = [clean_item(it) for it in items if it.get("preference") == "avoid"]
    return {
        "liked": sum(1 for f in fb if f["verdict"] == "up"),
        "disliked": sum(1 for f in fb if f["verdict"] == "down"),
        "avoided_items": avoided,
    }


@api_router.post("/stylist/generate")
async def stylist_generate(body: StylistBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    all_items = await db.items.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).to_list(1000)
    if not all_items:
        raise HTTPException(status_code=400, detail="Your closet is empty. Add items first.")

    # Pieces the user marked "don't suggest" are hidden from the stylist (unless explicitly focused on).
    items = [it for it in all_items if it.get("preference") != "avoid" or it["id"] == body.focus_item_id]
    if not items:
        raise HTTPException(status_code=400, detail="Every piece is marked 'don't suggest'. Allow some items first.")

    profile = await db.profiles.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}

    # Never-worn = never logged as worn AND not part of any saved look.
    outfit_docs = await db.outfits.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0, "item_ids": 1}).to_list(1000)
    in_looks = {i for o in outfit_docs for i in o.get("item_ids", [])}
    unworn_ids = {it["id"] for it in items if not it.get("wear_count") and it["id"] not in in_looks}

    wardrobe = [{
        "id": it["id"], "name": it["name"], "category": it["category"], "color": it.get("color"),
        "formality": it.get("formality"), "fabric": it.get("fabric"), "season": it.get("season"),
        "notes": it.get("notes") or None, "times_worn": int(it.get("wear_count") or 0),
        "never_worn": it["id"] in unworn_ids,
    } for it in items]

    focus = None
    if body.focus_item_id:
        focus = next((it for it in wardrobe if it["id"] == body.focus_item_id), None)

    taste = await taste_summary(user["user_id"], {it["id"]: it["name"] for it in all_items})

    system = (
        "You are StyleVault, an elite personal fashion stylist. You build outfits ONLY from the user's "
        "wardrobe provided as JSON. Consider color harmony, texture, formality and season. "
        f"User preferences: dress code {profile.get('dress_code')}, weather {profile.get('weather')}. "
        "Pieces flagged never_worn are ones the user has not reached for yet: when they suit the request, prefer them "
        "over heavily worn pieces so the wardrobe gets used evenly. Respect the user's taste feedback strictly. "
        "Return ONLY a JSON object with keys: "
        "outfit_name (string), item_ids (array of ids from the wardrobe that form the outfit), "
        "stylist_note (2-3 sentences explaining why colors and textures work), "
        "missing_suggestion (one item type the user could add to complete/upgrade the look). "
        "Every id in item_ids MUST exist in the wardrobe. No markdown, JSON only."
    )
    user_text = f"WARDROBE:\n{json.dumps(wardrobe)}\n\nREQUEST: {body.prompt}"
    if taste:
        user_text += f"\n\nUSER TASTE FEEDBACK (from thumbs up/down on past looks):\n{taste}"
    if body.prefer_unworn and unworn_ids:
        names = [w["name"] for w in wardrobe if w["never_worn"]]
        user_text += (
            f"\n\nThe user wants to finally wear pieces they've never worn: {json.dumps(names)}. "
            "Build the look around at least one (ideally two) of these never_worn pieces and mention in the note which ones are getting their debut."
        )
    if body.weather_context:
        user_text += f"\n\nCURRENT LOCAL WEATHER: {body.weather_context}. Factor this temperature/conditions into fabric weight, layering and season suitability."
    if focus:
        user_text += f"\n\nMUST include and build around this item: {json.dumps(focus)}"
    avoid = [i for i in (body.avoid_item_ids or []) if i in {w["id"] for w in wardrobe}]
    if avoid:
        seen = [w["name"] for w in wardrobe if w["id"] in avoid]
        user_text += (
            f"\n\nThe user ALREADY SAW a look made of: {json.dumps(seen)} (ids {json.dumps(avoid)}). "
            "Propose a NOTICEABLY DIFFERENT outfit: swap at least two of those pieces for other wardrobe items where possible, "
            "take a different styling angle (e.g. change the layer, shoe, or accessory) and give it a new outfit_name. "
            "If the wardrobe is too small to avoid overlap, keep the focus item (if any) but still change what you can and say so in the note."
        )

    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"stylist-{uuid.uuid4().hex[:8]}", system_message=system).with_model("gemini", STYLIST_MODEL)
    try:
        raw = await chat.send_message(UserMessage(text=user_text))
    except Exception as e:
        logger.error(f"stylist failed: {e}")
        raise HTTPException(status_code=502, detail="Stylist is unavailable right now.")

    result = parse_json(raw)
    valid_ids = {it["id"] for it in wardrobe}
    chosen = [i for i in result.get("item_ids", []) if i in valid_ids]
    if not chosen:
        chosen = [it["id"] for it in wardrobe[:3]]
    items_by_id = {it["id"]: it for it in items}
    outfit_items = [clean_item(dict(items_by_id[i])) for i in chosen if i in items_by_id]
    return {
        "outfit_name": result.get("outfit_name") or "Curated Look",
        "stylist_note": result.get("stylist_note") or "",
        "missing_suggestion": result.get("missing_suggestion") or "",
        "items": outfit_items,
        "item_ids": chosen,
    }


# ---------------------------------------------------------------------------
# Saved outfits
# ---------------------------------------------------------------------------
async def outfit_items(user_id: str, item_ids: List[str], require_all: bool = False):
    docs = await db.items.find(
        {"id": {"$in": item_ids}, "user_id": user_id, "deleted_at": None}, {"_id": 0}
    ).to_list(1000)
    by_id = {d["id"]: d for d in docs}
    if require_all and (not item_ids or len(item_ids) > 50 or set(item_ids) != set(by_id)):
        raise HTTPException(status_code=400, detail="Choose 1–50 available pieces from your own closet.")
    return [by_id[i] for i in dict.fromkeys(item_ids) if i in by_id]


async def validate_visualization(user_id: str, path: str, item_ids: List[str]):
    # Never accept arbitrary URLs, another user's image, or a render of different pieces.
    doc = await db.visualizations.find_one({"user_id": user_id, "storage_path": path}, {"_id": 0})
    if not doc:
        doc = await db.outfits.find_one(
            {"user_id": user_id, "visualization_path": path, "deleted_at": None}, {"_id": 0}
        )
    if not doc or set(doc.get("item_ids", [])) != set(item_ids):
        raise HTTPException(status_code=400, detail="This try-on does not match your look. Visualise it again.")


@api_router.get("/outfits", response_model=List[SavedOutfit])
async def list_outfits(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    outfits = await db.outfits.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    ids = {i for o in outfits for i in o.get("item_ids", [])}
    items_by_id = {}
    if ids:
        docs = await db.items.find({"id": {"$in": list(ids)}, "user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
        items_by_id = {d["id"]: d for d in docs}
    for o in outfits:
        o["items"] = [items_by_id[i] for i in o.get("item_ids", []) if i in items_by_id]
    return outfits


@api_router.post("/outfits", response_model=SavedOutfit)
async def save_outfit(body: OutfitBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await outfit_items(user["user_id"], body.item_ids, require_all=True)
    if body.visualization_path:
        await validate_visualization(user["user_id"], body.visualization_path, body.item_ids)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "title": body.title,
        "item_ids": body.item_ids,
        "stylist_note": body.stylist_note,
        "occasion": body.occasion,
        "visualization_path": body.visualization_path or None,
        "deleted_at": None,
        "created_at": now_utc(),
    }
    await db.outfits.insert_one(doc)
    doc.pop("_id", None)
    return {**doc, "items": items}


@api_router.patch("/outfits/{outfit_id}", response_model=SavedOutfit)
async def update_outfit(outfit_id: str, body: OutfitUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    query = {"id": outfit_id, "user_id": user["user_id"], "deleted_at": None}
    doc = await db.outfits.find_one(query, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Outfit not found")
    updates = {k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump().items() if v is not None}
    if "visualization_path" in updates:
        await validate_visualization(user["user_id"], updates["visualization_path"], doc["item_ids"])
    if updates:
        result = await db.outfits.update_one(query, {"$set": updates})
        if not result.matched_count:
            raise HTTPException(status_code=404, detail="Outfit not found")
    return {**doc, **updates, "items": await outfit_items(user["user_id"], doc["item_ids"])}


@api_router.post("/outfits/{outfit_id}/visualize", response_model=SavedOutfit)
async def visualize_saved_outfit(outfit_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    query = {"id": outfit_id, "user_id": user["user_id"], "deleted_at": None}
    doc = await db.outfits.find_one(query, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Outfit not found")
    items = await outfit_items(user["user_id"], doc["item_ids"], require_all=True)
    if not doc.get("visualization_path"):
        result = await generate_visualization(VisualizeBody(item_ids=doc["item_ids"], outfit_name=doc["title"]), user)
        updated = await db.outfits.update_one(query, {"$set": {"visualization_path": result["storage_path"]}})
        if not updated.matched_count:
            raise HTTPException(status_code=404, detail="Outfit was removed while creating the try-on.")
        doc = await db.outfits.find_one(query, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Outfit not found")
    return {**doc, "items": items}


@api_router.delete("/outfits/{outfit_id}")
async def delete_outfit(outfit_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.outfits.update_one({"id": outfit_id, "user_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Wear tracking + insights
# ---------------------------------------------------------------------------
async def log_wear(user_id: str, item_ids: List[str], outfit_id: Optional[str] = None) -> int:
    ids = [i async for i in db.items.find({"id": {"$in": item_ids}, "user_id": user_id, "deleted_at": None}, {"_id": 0, "id": 1})]
    ids = [d["id"] for d in ids]
    if not ids:
        return 0
    ts = now_utc()
    await db.items.update_many({"id": {"$in": ids}}, {"$inc": {"wear_count": 1}, "$set": {"last_worn_at": ts}})
    await db.wear_log.insert_many([{"id": str(uuid.uuid4()), "user_id": user_id, "item_id": i, "outfit_id": outfit_id, "worn_at": ts} for i in ids])
    return len(ids)


@api_router.post("/items/{item_id}/wear")
async def wear_item(item_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    n = await log_wear(user["user_id"], [item_id])
    if not n:
        raise HTTPException(status_code=404, detail="Item not found")
    doc = await db.items.find_one({"id": item_id, "user_id": user["user_id"]}, {"_id": 0})
    return doc


@api_router.post("/outfits/{outfit_id}/wear")
async def wear_outfit(outfit_id: str, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    outfit = await db.outfits.find_one({"id": outfit_id, "user_id": user["user_id"], "deleted_at": None}, {"_id": 0})
    if not outfit:
        raise HTTPException(status_code=404, detail="Outfit not found")
    n = await log_wear(user["user_id"], outfit.get("item_ids", []), outfit_id)
    await db.outfits.update_one({"id": outfit_id}, {"$inc": {"wear_count": 1}, "$set": {"last_worn_at": now_utc()}})
    return {"ok": True, "items_logged": n}


@api_router.get("/insights")
async def insights(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.items.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).to_list(1000)
    outfits = await db.outfits.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0, "item_ids": 1}).to_list(1000)

    appearances: dict = {}
    for o in outfits:
        for i in o.get("item_ids", []):
            appearances[i] = appearances.get(i, 0) + 1

    scored = []
    for it in items:
        wears = int(it.get("wear_count") or 0)
        apps = appearances.get(it["id"], 0)
        scored.append({**it, "wear_count": wears, "outfit_appearances": apps, "score": wears * 2 + apps})
    scored.sort(key=lambda x: (-x["score"], x["name"]))
    most_worn = [s for s in scored if s["score"] > 0][:5]
    never_worn = [s for s in scored if s["score"] == 0]

    total = len(items)
    colors: dict = {}
    for it in items:
        c = (it.get("color") or "Unknown").strip().title()
        colors[c] = colors.get(c, 0) + 1
    color_balance = sorted(
        [{"color": k, "count": v, "pct": round(v * 100 / total) if total else 0} for k, v in colors.items()],
        key=lambda x: -x["count"],
    )
    category_balance = [
        {"category": c, "count": sum(1 for it in items if it.get("category") == c), "pct": round(sum(1 for it in items if it.get("category") == c) * 100 / total) if total else 0}
        for c in CATEGORIES
    ]
    return {
        "total_items": total,
        "total_wears": sum(int(it.get("wear_count") or 0) for it in items),
        "saved_outfits": len(outfits),
        "most_worn": most_worn,
        "never_worn_count": len(never_worn),
        "never_worn": never_worn[:5],
        "color_balance": color_balance,
        "category_balance": category_balance,
    }


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------
@api_router.get("/profile")
async def get_profile(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    profile = await db.profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not profile:
        profile = {"user_id": user["user_id"], "dress_code": "Smart Casual", "body_fit": "Regular",
                   "color_palette": ["Navy", "White", "Charcoal"], "weather": "Temperate"}
        await db.profiles.insert_one(dict(profile))
        profile.pop("_id", None)
    counts = {}
    for c in CATEGORIES:
        counts[c] = await db.items.count_documents({"user_id": user["user_id"], "category": c, "deleted_at": None})
    profile["counts"] = counts
    profile["total_items"] = sum(counts.values())
    profile["name"] = user.get("name")
    profile["email"] = user.get("email")
    profile["picture"] = user.get("picture")
    return profile


@api_router.put("/profile")
async def update_profile(body: ProfileBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if "age" in updates and not (5 <= updates["age"] <= 120):
        raise HTTPException(status_code=400, detail="Age must be between 5 and 120")
    await db.profiles.update_one({"user_id": user["user_id"]}, {"$set": updates}, upsert=True)
    profile = await db.profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return profile


@api_router.post("/profile/photo")
async def upload_profile_photo(authorization: Optional[str] = Header(None), file: UploadFile = File(...)):
    """Full-body photo used by 'Visualise on me'. Downscaled and stored privately; no background removal."""
    user = await get_current_user(authorization)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image")
    small = await run_in_threadpool(downscale_for_vision, raw, 1280)
    path = f"{APP_NAME}/uploads/{user['user_id']}/profile/{uuid.uuid4()}.jpg"
    await run_in_threadpool(put_object, path, small, "image/jpeg")
    await db.profiles.update_one({"user_id": user["user_id"]}, {"$set": {"photo_path": path}}, upsert=True)
    # A new photo invalidates previously generated try-on images.
    await db.visualizations.delete_many({"user_id": user["user_id"]})
    return {"photo_path": path}


@api_router.delete("/profile/photo")
async def delete_profile_photo(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    await db.profiles.update_one({"user_id": user["user_id"]}, {"$unset": {"photo_path": ""}})
    await db.visualizations.delete_many({"user_id": user["user_id"]})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Outfit visualisation (Nano Banana virtual try-on)
# ---------------------------------------------------------------------------
async def load_item_image(item: dict) -> Optional[bytes]:
    try:
        if item.get("storage_path"):
            content, _ = await run_in_threadpool(get_object, item["storage_path"])
            return content
        if item.get("image_url"):
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                r = await client.get(item["image_url"])
                r.raise_for_status()
                return r.content
    except Exception as e:
        logger.warning(f"item image load failed for {item.get('id')}: {e}")
    return None


@api_router.post("/stylist/visualize", response_model=VisualizationResult)
async def visualize_outfit(body: VisualizeBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return await generate_visualization(body, user)


async def generate_visualization(body: VisualizeBody, user: dict):
    import base64

    profile = await db.profiles.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    if not profile.get("photo_path"):
        raise HTTPException(status_code=400, detail="Add your photo in Profile first so the stylist can dress you.")
    if not body.item_ids:
        raise HTTPException(status_code=400, detail="item_ids required")

    items = await outfit_items(user["user_id"], body.item_ids, require_all=True)
    key = ",".join(sorted(set(body.item_ids)))
    cached = await db.visualizations.find_one(
        {"user_id": user["user_id"], "key": key, "photo_path": profile["photo_path"]}, {"_id": 0}
    )
    if cached:
        return {"storage_path": cached["storage_path"], "cached": True}

    try:
        person, _ = await run_in_threadpool(get_object, profile["photo_path"])
    except Exception:
        raise HTTPException(status_code=400, detail="Your profile photo could not be loaded. Please upload it again.")

    garment_images = await asyncio.gather(*[load_item_image(it) for it in items])
    files = [ImageContent(image_base64=base64.b64encode(person).decode())]
    described = []
    for it, img in zip(items, garment_images):
        if img:
            files.append(ImageContent(image_base64=base64.b64encode(img).decode()))
            described.append(f"{it['name']} ({it.get('color') or ''} {it['category'].lower()}, {it.get('fabric') or ''})".replace("  ", " "))
        else:
            described.append(f"{it['name']} ({it.get('color') or ''} {it['category'].lower()}) — no reference photo, render from description")

    who = []
    if profile.get("gender") and profile["gender"] != "Prefer not to say":
        who.append(profile["gender"].lower())
    if profile.get("age"):
        who.append(f"around {profile['age']} years old")
    who_txt = ", ".join(who) if who else "the person shown"

    prompt = (
        f"Image 1 is a photo of the user ({who_txt}). The following images are individual clothing pieces from their wardrobe: "
        + "; ".join(described)
        + ". Create ONE realistic full-body editorial fashion photograph of THIS SAME PERSON wearing ALL of these pieces together as one outfit. "
        "Preserve their face, identity, skin tone, hair, body shape and proportions exactly. Use the garments' true colors, textures and cuts from the reference images. "
        "Natural relaxed standing pose, soft studio lighting, plain light-grey seamless backdrop, no text, no logos, no extra people."
    )

    chat = (
        LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"viz-{uuid.uuid4().hex[:8]}", system_message="You are a fashion photo compositing assistant.")
        .with_model("gemini", IMAGE_MODEL)
        .with_params(modalities=["image", "text"])
    )
    try:
        text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt, file_contents=files))
    except Exception as e:
        logger.error(f"visualize failed: {e}")
        raise HTTPException(status_code=502, detail="Could not generate the try-on image right now.")
    if not images:
        logger.warning(f"visualize returned no image: {str(text)[:120]}")
        raise HTTPException(status_code=502, detail="The image model returned no picture. Try again.")

    img_bytes = base64.b64decode(images[0]["data"])
    ext = "png" if "png" in (images[0].get("mime_type") or "") else "jpg"
    path = f"{APP_NAME}/uploads/{user['user_id']}/looks/{uuid.uuid4()}.{ext}"
    await run_in_threadpool(put_object, path, img_bytes, images[0].get("mime_type") or "image/png")
    await db.visualizations.insert_one({
        "id": str(uuid.uuid4()), "user_id": user["user_id"], "key": key, "item_ids": body.item_ids,
        "outfit_name": body.outfit_name, "storage_path": path, "created_at": now_utc(),
        "photo_path": profile["photo_path"],
    })
    return {"storage_path": path, "cached": False}


@api_router.get("/")
async def root():
    return {"message": "StyleVault API"}


upload_jobs = UploadJobs(db, tag_image, put_object, get_object, APP_NAME)
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await upload_jobs.start()
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.items.create_index("user_id")
        await db.outfits.create_index("user_id")
    except Exception as e:
        logger.warning(f"index creation: {e}")
    try:
        await run_in_threadpool(init_storage)
    except Exception as e:
        logger.warning(f"storage init: {e}")


@app.on_event("shutdown")
async def shutdown():
    await upload_jobs.stop()
    client.close()
