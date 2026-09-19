import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";

import { ApiError, BACKEND, getToken, Item } from "@/src/api";

export type UploadOptions = { uploadId: string; onProgress?: (message: string) => void; signal?: AbortSignal };
type Job = { id: string; status: string; stage: string; error?: string; item?: Item };
export const newUploadId = () => `photo_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;

function stopped() { return new Error("Upload paused. Tap Try Again to resume the same photo."); }

/** Bound both headers AND body reads: native fetch can otherwise hang after losing a connection. */
async function jobRequest(path: string, body: Blob | undefined, options: UploadOptions, timeout: number): Promise<Job> {
  const controller = new AbortController();
  if (options.signal?.aborted) throw stopped();
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(stopped()); };
    options.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new Error("The connection took too long. Tap Try Again to resume.")); }, timeout);
  });
  const operation = async () => {
    const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
    if (body) headers["Content-Type"] = "image/jpeg";
    const response = await expoFetch(`${BACKEND}/api/items/upload-jobs/${path}`, {
      method: body ? "POST" : "GET", headers, body, signal: controller.signal,
    });
    if (!response.ok) {
      let message = "Photo upload is temporarily unavailable. Tap Try Again to resume.";
      try { const data = await response.json(); if (typeof data.detail === "string") message = data.detail; } catch {}
      throw new ApiError(response.status, message);
    }
    return response.json() as Promise<Job>;
  };
  try { return await Promise.race([operation(), deadline]); }
  finally { clearTimeout(timer!); options.signal?.removeEventListener("abort", abort); }
}

async function photoBody(uri: string): Promise<Blob> {
  if (Platform.OS === "web") return (await fetch(uri)).blob();
  const { File } = await import("expo-file-system");
  const file = new File(uri);
  if (!file.exists) throw new Error("The photo is no longer on this device. Please choose it again.");
  if (file.size > 16 * 1024 * 1024) throw new Error("Photo is too large. Please choose a smaller image.");
  // SDK57 supports File as a raw fetch body. No legacy multipart URI objects.
  return file as unknown as Blob;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function uploadWithProgress(uri: string, options: UploadOptions): Promise<Item> {
  let job: Job | undefined;
  options.onProgress?.("CHECKING YOUR UPLOAD…");
  try { job = await jobRequest(options.uploadId, undefined, options, 12000); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiError && error.status !== 404 && error.status < 500) throw error;
  }
  if (!job || ["failed", "upload_failed", "receiving"].includes(job.status)) {
    const body = await photoBody(uri);
    for (let attempt = 0; attempt < 2; attempt++) {
      options.onProgress?.(attempt ? "RECONNECTING TO YOUR UPLOAD…" : "UPLOADING PHOTO…");
      try { job = await jobRequest(options.uploadId, body, options, 40000); break; }
      catch (error) {
        if (options.signal?.aborted || (error instanceof ApiError && error.status < 500)) throw error;
        // The response may have been lost AFTER the server received the photo.
        try { job = await jobRequest(options.uploadId, undefined, options, 12000); }
        catch { job = undefined; }
        if (job && ["queued", "processing", "complete"].includes(job.status)) break;
        if (attempt === 1) throw new Error("The connection was interrupted. Your photo is kept here. Tap Try Again to resume without retaking it.");
      }
    }
  }
  const until = Date.now() + 150000;
  let failures = 0;
  while (Date.now() < until) {
    if (options.signal?.aborted) throw stopped();
    if (job?.status === "complete" && job.item) return job.item;
    if (job && ["failed", "upload_failed"].includes(job.status)) throw new Error(job.error || "Processing was interrupted. Tap Try Again.");
    options.onProgress?.(job?.stage === "queued" ? "PHOTO RECEIVED · WAITING TO PROCESS…"
      : job?.stage === "saving" ? "SAVING YOUR PROCESSED PHOTO…"
      : job?.stage === "uploading" ? "RECEIVING YOUR PHOTO…"
      : "PHOTO RECEIVED · ANALYSING & REMOVING BACKGROUND…");
    await pause(1500);
    try { job = await jobRequest(options.uploadId, undefined, options, 12000); failures = 0; }
    catch (error) {
      if (options.signal?.aborted || (error instanceof ApiError && error.status < 500)) throw error;
      options.onProgress?.("CONNECTION INTERRUPTED · RECONNECTING…");
      if (++failures >= 3) throw new Error("Connection interrupted. Your photo is safe on the server. Tap Try Again to check its progress.");
    }
  }
  throw new Error("Your photo is still processing safely. Tap Try Again to resume checking, or find it in Closet when ready.");
}