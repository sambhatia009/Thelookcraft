import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image } from "react-native";

const MAX_EDGE = 1280;

/**
 * Downscale + re-encode a picked/captured photo before upload.
 * Camera photos are ~10 MB; this brings them to a few hundred KB so the upload
 * Avoid silently sending full-resolution photos when preparation fails.
 */
export async function compressForUpload(uri: string, width?: number, height?: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      preparePhoto(uri, width, height),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Photo preparation took too long. Tap Try Again or choose another photo.")), 20000);
      }),
    ]);
  } finally { clearTimeout(timer!); }
}

async function preparePhoto(uri: string, width?: number, height?: number): Promise<string> {
  try {
    if (!width || !height) {
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject);
      });
      width = size.width;
      height = size.height;
    }
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
    throw new Error("Could not prepare this photo. Your photo is kept here; tap Try Again or choose another.");
  }
}
