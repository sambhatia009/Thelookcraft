import Constants from "expo-constants";
import { Platform } from "react-native";

import { BACKEND, getToken } from "@/src/api";

/**
 * Fire-and-forget device diagnostics. Phones report where an upload stalled (and the real
 * underlying error) so failures that never reach the upload endpoint are still visible server-side.
 */
export function reportClientEvent(event: string, message?: string, details?: Record<string, unknown>, uploadId?: string) {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch(`${BACKEND}/api/client-logs`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        event,
        message: message ? String(message).slice(0, 2000) : null,
        upload_id: uploadId || null,
        platform: Platform.OS,
        os_version: String(Platform.Version ?? ""),
        runtime: `${Constants.executionEnvironment}/${Constants.expoConfig?.sdkVersion || "?"}/${Constants.expoRuntimeVersion || Constants.expoVersion || "?"}`,
        details: details || null,
      }),
    })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  } catch {}
}

export function describeError(error: unknown): string {
  if (!error) return "unknown";
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
