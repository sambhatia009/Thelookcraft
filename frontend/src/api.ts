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
};

export type Outfit = {
  id: string;
  title: string;
  stylist_note: string;
  occasion?: string;
  items: Item[];
  item_ids: string[];
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
  googleSession: (session_id: string) =>
    req("/auth/session", { method: "POST", json: { session_id } }),
  me: () => req("/auth/me"),
  logout: () => req("/auth/logout", { method: "POST" }),

  items: (category?: string): Promise<Item[]> =>
    req(`/items${category && category !== "All" ? `?category=${encodeURIComponent(category)}` : ""}`),
  updateItem: (id: string, patch: Partial<Item>) =>
    req(`/items/${id}`, { method: "PATCH", json: patch }),
  deleteItem: (id: string) => req(`/items/${id}`, { method: "DELETE" }),

  stylist: (prompt: string, focus_item_id?: string | null, weather_context?: string | null): Promise<OutfitResult> =>
    req("/stylist/generate", {
      method: "POST",
      json: { prompt, focus_item_id: focus_item_id || null, weather_context: weather_context || null },
    }),

  outfits: (): Promise<Outfit[]> => req("/outfits"),
  saveOutfit: (payload: { title: string; item_ids: string[]; stylist_note?: string; occasion?: string }) =>
    req("/outfits", { method: "POST", json: payload }),
  updateOutfit: (id: string, patch: { occasion?: string; title?: string }): Promise<Outfit> =>
    req(`/outfits/${id}`, { method: "PATCH", json: patch }),
  deleteOutfit: (id: string) => req(`/outfits/${id}`, { method: "DELETE" }),
  wearOutfit: (id: string) => req(`/outfits/${id}/wear`, { method: "POST" }),
  wearItem: (id: string): Promise<Item> => req(`/items/${id}/wear`, { method: "POST" }),
  insights: (): Promise<Insights> => req("/insights"),

  profile: () => req("/profile"),
  updateProfile: (patch: any) => req("/profile", { method: "PUT", json: patch }),
};

export async function uploadItemImage(uri: string) {
  const form = new FormData();
  const name = `item_${Date.now()}.jpg`;
  const { Platform } = require("react-native");
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri, name, type: "image/jpeg" } as any);
  }
  const headers: Record<string, string> = {};
  if (inMemoryToken) headers["Authorization"] = `Bearer ${inMemoryToken}`;
  const res = await fetch(`${BACKEND}/api/items/upload`, { method: "POST", headers, body: form });
  if (!res.ok) {
    let detail = "Upload failed";
    try {
      detail = (await res.json()).detail || detail;
    } catch {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<Item>;
}
