import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

const MAX_EDGE = 1280;

/**
 * Downscale + re-encode a picked/captured photo before upload.
 * Camera photos are ~10 MB; this brings them to a few hundred KB so the upload
 * and AI analysis finish well within network timeouts. Falls back to the original on failure.
 */
export async function compressForUpload(uri: string, width?: number, height?: number): Promise<string> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    if (width && height && Math.max(width, height) > MAX_EDGE) {
      if (width >= height) ctx.resize({ width: MAX_EDGE });
      else ctx.resize({ height: MAX_EDGE });
    }
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    img.release();
    return out.uri;
  } catch {
    return uri;
  }
}
