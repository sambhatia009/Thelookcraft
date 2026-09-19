import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";

import { ApiError, BACKEND, getToken, Item } from "@/src/api";
import { describeError, reportClientEvent } from "@/src/client-log";

export type UploadOptions = { uploadId: string; onProgress?: (message: string) => void; signal?: AbortSignal };
type Job = { id: string; status: string; stage: string; error?: string; item?: Item };
export const newUploadId = () => `photo_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;

const isAbort = (error: unknown) => error instanceof Error && (error.name === "AbortError" || /aborted|paused/i.test(error.message));
function stopped() { return new Error("Upload paused. Tap Try Again to resume the same photo."); }
const jobUrl = (path: string) => `${BACKEND}/api/items/upload-jobs/${path}`;

function parseJob(status: number, text: string): Job {
  let data: any = null;
  try { data = JSON.parse(text); } catch {}
  if (status < 200 || status >= 300) {
    const message = typeof data?.detail === "string" ? data.detail : "Photo upload is temporarily unavailable. Tap Try Again to resume.";
    throw new ApiError(status, message);
  }
  return data as Job;
}

/** Bound the whole request (headers AND body) and honour the user's pause signal. */
async function bounded<T>(operation: (controller: AbortController) => Promise<T>, options: UploadOptions, timeout: number): Promise<T> {
  const controller = new AbortController();
  if (options.signal?.aborted) throw stopped();
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    abort = () => { controller.abort(); reject(stopped()); };
    options.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { controller.abort(); reject(new Error("The connection took too long. Tap Try Again to resume.")); }, timeout);
  });
  try { return await Promise.race([operation(controller), deadline]); }
  finally { clearTimeout(timer!); options.signal?.removeEventListener("abort", abort); }
}

async function fetchJob(path: string, body: Blob | Uint8Array | undefined, options: UploadOptions, timeout: number): Promise<Job> {
  return bounded(async (controller) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
    if (body) headers["Content-Type"] = "image/jpeg";
    const response = await expoFetch(jobUrl(path), { method: body ? "POST" : "GET", headers, body: body as any, signal: controller.signal });
    return parseJob(response.status, await response.text());
  }, options, timeout);
}

/** Native transport: the OS uploads the file itself (URLSession/OkHttp) — nothing is buffered through JS. */
async function nativeUpload(uri: string, options: UploadOptions, timeout: number): Promise<Job> {
  const { File, UploadType } = await import("expo-file-system");
  const file = new File(uri);
  if (!file.exists) throw new Error("The photo is no longer on this device. Please choose it again.");
  if ((file.size ?? 0) > 16 * 1024 * 1024) throw new Error("Photo is too large. Please choose a smaller image.");
  const size = file.size ?? 0;
  try {
    return await bounded(async (controller) => {
      const result = await file.upload(jobUrl(options.uploadId), {
        httpMethod: "POST",
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: "image/jpeg",
        headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "image/jpeg" },
        signal: controller.signal,
      });
      return parseJob(result.status, result.body);
    }, options, timeout);
  } catch (error) {
    if (isAbort(error) || options.signal?.aborted || error instanceof ApiError) throw error;
    // Native task unavailable or failed before the server answered: fall back to reading the bytes in JS.
    reportClientEvent("native_upload_fallback", describeError(error), { size }, options.uploadId);
    const bytes = await file.bytes();
    return fetchJob(options.uploadId, bytes, options, timeout);
  }
}

async function sendPhoto(uri: string, options: UploadOptions, timeout: number): Promise<Job> {
  if (Platform.OS === "web") return fetchJob(options.uploadId, await (await fetch(uri)).blob(), options, timeout);
  return nativeUpload(uri, options, timeout);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function uploadWithProgress(uri: string, options: UploadOptions): Promise<Item> {
  const started = Date.now();
  const report = (event: string, error?: unknown, extra?: Record<string, unknown>) =>
    reportClientEvent(event, error ? describeError(error) : undefined, { ms: Date.now() - started, ...extra }, options.uploadId);
  try {
    return await run(uri, options, report);
  } catch (error) {
    if (!isAbort(error)) report("upload_failed", error);
    throw error;
  }
}

async function run(uri: string, options: UploadOptions, report: (event: string, error?: unknown, extra?: Record<string, unknown>) => void): Promise<Item> {
  let job: Job | undefined;
  options.onProgress?.("CHECKING YOUR UPLOAD…");
  try { job = await fetchJob(options.uploadId, undefined, options, 12000); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiError && error.status !== 404 && error.status < 500) throw error;
    if (!(error instanceof ApiError)) report("status_check_failed", error);
  }
  if (!job || ["failed", "upload_failed", "receiving"].includes(job.status)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      options.onProgress?.(attempt ? "RECONNECTING TO YOUR UPLOAD…" : "UPLOADING PHOTO…");
      try { job = await sendPhoto(uri, options, 60000); report("upload_accepted", undefined, { attempt }); break; }
      catch (error) {
        if (options.signal?.aborted || (error instanceof ApiError && error.status < 500)) throw error;
        report("send_failed", error, { attempt });
        // The response may have been lost AFTER the server received the photo.
        try { job = await fetchJob(options.uploadId, undefined, options, 12000); }
        catch { job = undefined; }
        if (job && ["queued", "processing", "complete"].includes(job.status)) break;
        if (attempt === 1) throw new Error(`The connection was interrupted (${describeError(error)}). Your photo is kept here. Tap Try Again to resume without retaking it.`);
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
    try { job = await fetchJob(options.uploadId, undefined, options, 12000); failures = 0; }
    catch (error) {
      if (options.signal?.aborted || (error instanceof ApiError && error.status < 500)) throw error;
      options.onProgress?.("CONNECTION INTERRUPTED · RECONNECTING…");
      if (++failures >= 3) throw new Error("Connection interrupted. Your photo is safe on the server. Tap Try Again to check its progress.");
    }
  }
  throw new Error("Your photo is still processing safely. Tap Try Again to resume checking, or find it in Closet when ready.");
}
