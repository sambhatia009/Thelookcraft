import { Linking, Platform } from "react-native";

export type SaveResult = "saved" | "denied" | "blocked" | "error";

/**
 * Save a local image file to the device's photo library.
 * Permission flow: check → request once (add-only on iOS) → if permanently blocked, caller
 * should offer an "Open Settings" action (use `openPhotoSettings`).
 * expo-media-library has no web implementation, so it is required lazily on native only.
 */
export async function saveToPhotos(uri: string, fileName: string): Promise<SaveResult> {
  if (Platform.OS === "web") {
    const a = document.createElement("a");
    a.href = uri;
    a.download = fileName;
    a.click();
    return "saved";
  }
  try {
    const MediaLibrary = require("expo-media-library") as typeof import("expo-media-library");
    let perm = await MediaLibrary.getPermissionsAsync(true);
    if (!perm.granted) {
      if (!perm.canAskAgain) return "blocked";
      perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) return perm.canAskAgain ? "denied" : "blocked";
    }
    await MediaLibrary.saveToLibraryAsync(uri);
    return "saved";
  } catch {
    return "error";
  }
}

export function openPhotoSettings() {
  Linking.openSettings().catch(() => {});
}
