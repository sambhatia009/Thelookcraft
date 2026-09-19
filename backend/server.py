import os
import io
import re
import json
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import httpx
import requests
from fastapi import FastAPI, APIRouter, HTTPException, Header, UploadFile, File, Query
from fastapi.responses import Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr

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
GEMINI_MODEL = "gemini-3-flash-preview"

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


class OutfitBody(BaseModel):
    title: str
    item_ids: List[str]
    stylist_note: str = ""
    occasion: str = ""


class OutfitUpdate(BaseModel):
    occasion: Optional[str] = None
    title: Optional[str] = None


class StylistBody(BaseModel):
    prompt: str
    focus_item_id: Optional[str] = None
    weather_context: Optional[str] = None


class ProfileBody(BaseModel):
    dress_code: Optional[str] = None
    body_fit: Optional[str] = None
    color_palette: Optional[List[str]] = None
    weather: Optional[str] = None


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


@api_router.post("/items/upload")
async def upload_item(authorization: Optional[str] = Header(None), file: UploadFile = File(...)):
    user = await get_current_user(authorization)
    raw = await file.read()

    tags = await tag_image(raw)
    cutout = await run_in_threadpool(remove_background, raw)
    item_id = str(uuid.uuid4())
    path = f"{APP_NAME}/uploads/{user['user_id']}/{item_id}.png"
    await run_in_threadpool(put_object, path, cutout, "image/png")

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
@api_router.post("/stylist/generate")
async def stylist_generate(body: StylistBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    items = await db.items.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).to_list(1000)
    if not items:
        raise HTTPException(status_code=400, detail="Your closet is empty. Add items first.")

    profile = await db.profiles.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    wardrobe = [{
        "id": it["id"], "name": it["name"], "category": it["category"], "color": it.get("color"),
        "formality": it.get("formality"), "fabric": it.get("fabric"), "season": it.get("season"),
    } for it in items]

    focus = None
    if body.focus_item_id:
        focus = next((it for it in wardrobe if it["id"] == body.focus_item_id), None)

    system = (
        "You are StyleVault, an elite personal fashion stylist. You build outfits ONLY from the user's "
        "wardrobe provided as JSON. Consider color harmony, texture, formality and season. "
        f"User preferences: dress code {profile.get('dress_code')}, weather {profile.get('weather')}. "
        "Return ONLY a JSON object with keys: "
        "outfit_name (string), item_ids (array of ids from the wardrobe that form the outfit), "
        "stylist_note (2-3 sentences explaining why colors and textures work), "
        "missing_suggestion (one item type the user could add to complete/upgrade the look). "
        "Every id in item_ids MUST exist in the wardrobe. No markdown, JSON only."
    )
    user_text = f"WARDROBE:\n{json.dumps(wardrobe)}\n\nREQUEST: {body.prompt}"
    if body.weather_context:
        user_text += f"\n\nCURRENT LOCAL WEATHER: {body.weather_context}. Factor this temperature/conditions into fabric weight, layering and season suitability."
    if focus:
        user_text += f"\n\nMUST include and build around this item: {json.dumps(focus)}"

    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"stylist-{uuid.uuid4().hex[:8]}", system_message=system).with_model("gemini", GEMINI_MODEL)
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
@api_router.get("/outfits")
async def list_outfits(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    outfits = await db.outfits.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    ids = {i for o in outfits for i in o.get("item_ids", [])}
    items_by_id = {}
    if ids:
        docs = await db.items.find({"id": {"$in": list(ids)}}, {"_id": 0}).to_list(1000)
        items_by_id = {d["id"]: d for d in docs}
    for o in outfits:
        o["items"] = [items_by_id[i] for i in o.get("item_ids", []) if i in items_by_id]
    return outfits


@api_router.post("/outfits")
async def save_outfit(body: OutfitBody, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "title": body.title,
        "item_ids": body.item_ids,
        "stylist_note": body.stylist_note,
        "occasion": body.occasion,
        "deleted_at": None,
        "created_at": now_utc(),
    }
    await db.outfits.insert_one(doc)
    return clean_item(doc)


@api_router.patch("/outfits/{outfit_id}")
async def update_outfit(outfit_id: str, body: OutfitUpdate, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    updates = {k: v.strip() if isinstance(v, str) else v for k, v in body.dict().items() if v is not None}
    if updates:
        await db.outfits.update_one({"id": outfit_id, "user_id": user["user_id"]}, {"$set": updates})
    doc = await db.outfits.find_one({"id": outfit_id, "user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Outfit not found")
    return doc


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
    await db.profiles.update_one({"user_id": user["user_id"]}, {"$set": updates}, upsert=True)
    profile = await db.profiles.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return profile


@api_router.get("/")
async def root():
    return {"message": "StyleVault API"}


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
    client.close()
