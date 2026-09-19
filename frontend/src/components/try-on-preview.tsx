import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, ImageLoadEventData, NativeSyntheticEvent, Pressable, Text, View } from "react-native";

import { imageUri } from "@/src/api";
import { makeStyles, spacing, useTheme } from "@/src/theme";

/** A capture-safe, uncropped render. Mount with key={path} when changing images. */
export function TryOnPreview({ path, testID, onReady }: { path: string; testID: string; onReady?: (ready: boolean) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [ratio, setRatio] = useState(2 / 3);
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const uri = imageUri({ storage_path: path });
  const source = useMemo(() => ({ uri }), [uri]);
  // RN Web re-runs image loading effects when event callback identities change.
  const handleStart = useCallback(() => readyCallback.current?.(false), []);
  const handleLoad = useCallback(({ nativeEvent }: NativeSyntheticEvent<ImageLoadEventData>) => {
    const target = (nativeEvent as unknown as { target?: { naturalWidth?: number; naturalHeight?: number } }).target;
    const width = nativeEvent.source?.width ?? target?.naturalWidth ?? 0;
    const height = nativeEvent.source?.height ?? target?.naturalHeight ?? 0;
    if (width > 0 && height > 0) setRatio(width / height);
    setStatus("ready");
    readyCallback.current?.(true);
  }, []);
  const handleError = useCallback(() => { setStatus("error"); readyCallback.current?.(false); }, []);
  return (
    <View testID={testID} style={styles.box}>
      <View style={[styles.frame, { aspectRatio: ratio }]}>
        <Image key={attempt} source={source} style={styles.image} resizeMode="contain" fadeDuration={0}
          testID={`${testID}-image`} accessibilityLabel="AI try-on of your outfit"
          onLoadStart={handleStart} onLoad={handleLoad} onError={handleError} />
        {status !== "ready" && (
          <View style={styles.overlay} testID={`${testID}-${status}`}>
            {status === "loading" ? <ActivityIndicator color={colors.onSurface} /> : (
              <Pressable testID={`${testID}-retry`} style={styles.retry} onPress={() => { setStatus("loading"); onReady?.(false); setAttempt((n) => n + 1); }}>
                <Text style={styles.error}>Image could not load. Tap to retry.</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
      <Text style={styles.caption} testID={`${testID}-caption`}>VISUALISED ON YOU · AI RENDER</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  box: { marginHorizontal: spacing.lg, borderWidth: 1, borderColor: c.border },
  frame: { width: "100%", backgroundColor: c.surfaceTertiary },
  image: { width: "100%", height: "100%" },
  overlay: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, justifyContent: "center", alignItems: "center", backgroundColor: c.surfaceTertiary },
  retry: { minHeight: 44, padding: spacing.lg, justifyContent: "center" },
  error: { color: c.error, fontSize: 12, textAlign: "center" },
  caption: { padding: spacing.md, color: c.muted, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", textAlign: "center" },
}));