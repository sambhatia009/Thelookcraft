import { File, UploadType } from "expo-file-system";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

export const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const TOKEN_KEY = "sv_session_token";

let inMemoryToken: string | null = null;

export function getToken() {
  return inMemoryToken;
}
export async function loadToken() {
  const t = await storage.secureGet<string>(TOKEN_KEY, "");
  inMemoryToken = t ? (t as string) : null;
  return inMemoryToken;
}
export async function saveToken(t: string) {
  inMemoryToken = t;
  await storage.secureSet(TOKEN_KEY, t);
}
export async function clearToken() {
  inMemoryToken = null;
  await storage.secureRemove(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type ReqOptions = Omit<RequestInit, "body"> & { json?: any; body?: any };

async function req(path: string, options: ReqOptions = {}): Promise<any> {
  const headers: Record<string, string> = { ...(options.headers as any) };
  if (inMemoryToken) headers["Authorization"] = `Bearer ${inMemoryToken}`;
  let body = options.body;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  const res = await fetch(`${BACKEND}/api${path}`, { ...options, headers, body });
  if (!res.ok) {
    let detail = "Something went wrong";
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch {}
    throw new ApiError(res.status, detail);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}

export function imageUri(item: { image_url?: string | null; storage_path?: string | null }) {
  if (item.image_url) return item.image_url;
  if (item.storage_path) return `${BACKEND}/api/files/${item.storage_path}?token=${inMemoryToken}`;
  return undefined;
}

export type Item = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  color: string;
  formality: string;
  fabric: string;
  season: string;
  image_url?: string | null;
  storage_path?: string | null;
  wear_count?: number;
  last_worn_at?: string | null;
  notes?: string;
  preference?: "avoid" | "neutral" | null;
  processing_warning?: string | null;
  background_removed?: boolean;
};

export type Profile = {
  user_id?: string;
  name?: string;
  email?: string;
  picture?: string | null;
  dress_code?: string;
  body_fit?: string;
  color_palette?: string[];
  weather?: string;
  gender?: string;
  age?: number;
  photo_path?: string | null;
  counts?: Record<string, number>;
  total_items?: number;
};

export type Outfit = {
  id: string;
  title: string;
  stylist_note: string;
  occasion?: string;
  items: Item[];
  item_ids: string[];
  visualization_path?: string | null;
  wear_count?: number;
  created_at: string;
};

export type Insights = {
  total_items: number;
  total_wears: number;
  saved_outfits: number;
  most_worn: (Item & { outfit_appearances: number; score: number })[];
  never_worn_count: number;
  never_worn: Item[];
  color_balance: { color: string; count: number; pct: number }[];
  category_balance: { category: string; count: number; pct: number }[];
};

export type OutfitResult = {
  outfit_name: string;
  stylist_note: string;
  missing_suggestion: string;
  items: Item[];
  item_ids: string[];
};

export const api = {
  register: (name: string, email: string, password: string) =>
    req("/auth/register", { method: "POST", json: { name, email, password } }),
  login: (email: string, password: string) =>
    req("/auth/login", { method: "POST", json: { email, password } }),
  forgotPassword: (email: string) => req("/auth/forgot-password", { method: "POST", json: { email } }),
  resetPassword: (email: string, code: string, new_password: string) =>
    req("/auth/reset-password", { method: "POST", json: { email, code, new_password } }),
  googleSession: (session_id: string) =>
    req("/auth/session", { method: "POST", json: { session_id } }),
  me: () => req("/auth/me"),
  logout: () => req("/auth/logout", { method: "POST" }),

  items: (category?: string): Promise<Item[]> =>
    req(`/items${category && category !== "All" ? `?category=${encodeURIComponent(category)}` : ""}`),
  updateItem: (id: string, patch: Partial<Item>) =>
    req(`/items/${id}`, { method: "PATCH", json: patch }),
  deleteItem: (id: string) => req(`/items/${id}`, { method: "DELETE" }),

  stylist: (payload: {
    prompt: string;
    focus_item_id?: string | null;
    weather_context?: string | null;
    avoid_item_ids?: string[] | null;
    prefer_unworn?: boolean;
  }): Promise<OutfitResult> =>
    req("/stylist/generate", {
      method: "POST",
      json: {
        prompt: payload.prompt,
        focus_item_id: payload.focus_item_id || null,
        weather_context: payload.weather_context || null,
        avoid_item_ids: payload.avoid_item_ids && payload.avoid_item_ids.length ? payload.avoid_item_ids : null,
        prefer_unworn: !!payload.prefer_unworn,
      },
    }),
  feedback: (payload: { verdict: "up" | "down"; item_ids: string[]; outfit_name?: string; prompt?: string }) =>
    req("/stylist/feedback", { method: "POST", json: payload }),
  taste: (): Promise<{ liked: number; disliked: number; avoided_items: Item[] }> => req("/stylist/taste"),

  outfits: (): Promise<Outfit[]> => req("/outfits"),
  saveOutfit: (payload: { title: string; item_ids: string[]; stylist_note?: string; occasion?: string; visualization_path?: string | null }): Promise<Outfit> =>
    req("/outfits", { method: "POST", json: payload }),
  updateOutfit: (id: string, patch: { occasion?: string; title?: string; visualization_path?: string }): Promise<Outfit> =>
    req(`/outfits/${id}`, { method: "PATCH", json: patch }),
  visualizeOutfit: (id: string): Promise<Outfit> => req(`/outfits/${id}/visualize`, { method: "POST" }),
  deleteOutfit: (id: string) => req(`/outfits/${id}`, { method: "DELETE" }),
  wearOutfit: (id: string) => req(`/outfits/${id}/wear`, { method: "POST" }),
  wearItem: (id: string): Promise<Item> => req(`/items/${id}/wear`, { method: "POST" }),
  insights: (): Promise<Insights> => req("/insights"),

  profile: (): Promise<Profile> => req("/profile"),
  updateProfile: (patch: Partial<Profile>): Promise<Profile> => req("/profile", { method: "PUT", json: patch }),
  deleteProfilePhoto: () => req("/profile/photo", { method: "DELETE" }),
  visualize: (item_ids: string[], outfit_name?: string): Promise<{ storage_path: string; cached: boolean }> =>
    req("/stylist/visualize", { method: "POST", json: { item_ids, outfit_name } }),
};

export async function uploadProfilePhoto(uri: string): Promise<{ photo_path: string }> {
  const url = `${BACKEND}/api/profile/photo`;
  const auth: Record<string, string> = inMemoryToken ? { Authorization: `Bearer ${inMemoryToken}` } : {};
  const fail = async (status: number, text: string) => {
    let detail = "Upload failed";
    try { detail = JSON.parse(text).detail || detail; } catch {}
    throw new ApiError(status, detail);
  };
  if (Platform.OS === "web") {
    const form = new FormData();
    form.append("file", await (await fetch(uri)).blob(), `photo_${Date.now()}.jpg`);
    const res = await fetch(url, { method: "POST", headers: auth, body: form });
    if (!res.ok) await fail(res.status, await res.text());
    return res.json();
  }
  // Native: let the OS upload the file itself (multipart, field "file") — no JS buffering.
  const file = new File(uri);
  if (!file.exists) throw new Error("The photo is no longer on this device. Please choose it again.");
  const result = await file.upload(url, {
    httpMethod: "POST",
    uploadType: UploadType.MULTIPART,
    fieldName: "file",
    mimeType: "image/jpeg",
    headers: auth,
  });
  if (result.status < 200 || result.status >= 300) await fail(result.status, result.body);
  return JSON.parse(result.body);
}
