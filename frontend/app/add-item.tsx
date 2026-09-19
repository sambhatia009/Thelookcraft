import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Camera, Images, X } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Item, uploadItemImage, api, imageUri } from "@/src/api";
import { BatchEntry, BulkReview } from "@/src/components/bulk-review";
import { ItemEditor } from "@/src/components/item-editor";
import { compressForUpload } from "@/src/compress-image";
import { useToast } from "@/src/toast";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Button } from "@/src/ui";

const MAX_BATCH = 10;

const editable = (it: Item) => ({
  name: it.name,
  category: it.category,
  subcategory: it.subcategory,
  color: it.color,
  formality: it.formality,
  fabric: it.fabric,
  season: it.season,
  notes: it.notes || "",
});

export default function AddItem() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { show } = useToast();

  const [localUri, setLocalUri] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [item, setItem] = useState<Item | null>(null);
  // Errors are shown inline: this screen is a native modal on iOS, so root-level toasts render beneath it.
  const [error, setError] = useState<string | null>(null);
  // Bulk mode: several photos analysed one after another, then reviewed as a list.
  const [batch, setBatch] = useState<BatchEntry[] | null>(null);
  const batchRef = useRef<BatchEntry[]>([]);
  const running = useRef(false);

  const close = () => router.back();

  const upload = async (uri: string) => {
    setError(null);
    setAnalyzing(true);
    try {
      const created = await uploadItemImage(uri);
      setItem(created);
      qc.invalidateQueries({ queryKey: ["items"] });
    } catch (e: any) {
      const msg = e?.message && e.message !== "Network request failed" ? e.message : "Upload failed — check your connection and try again";
      setError(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = () => {
    setLocalUri(null);
    setItem(null);
    setError(null);
  };

  const pick = async (source: "camera" | "library") => {
    try {
      setError(null);
      let perm;
      if (source === "camera") perm = await ImagePicker.requestCameraPermissionsAsync();
      else perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        if (!perm.canAskAgain) {
          setError(`${source === "camera" ? "Camera" : "Photos"} access is off for StyleVault. Enable it in Settings.`);
          Linking.openSettings();
        } else {
          setError(`${source === "camera" ? "Camera" : "Photos"} permission is needed to add this item.`);
        }
        return;
      }

      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8, exif: false })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 0.8,
              exif: false,
              allowsMultipleSelection: true,
              selectionLimit: MAX_BATCH,
              orderedSelection: true,
            });

      if (result.canceled || !result.assets?.length) return;

      if (result.assets.length > 1) {
        startBatch(result.assets.slice(0, MAX_BATCH));
        return;
      }

      const asset = result.assets[0];
      setLocalUri(asset.uri);
      setAnalyzing(true);
      const uri = Platform.OS === "web" ? asset.uri : await compressForUpload(asset.uri, asset.width, asset.height);
      setLocalUri(uri);
      await upload(uri);
    } catch {
      setAnalyzing(false);
      setError("Could not open the camera or gallery. Please try again.");
    }
  };

  // ---- Bulk upload -----------------------------------------------------------
  const commitBatch = (next: BatchEntry[]) => {
    batchRef.current = next;
    setBatch([...next]);
  };
  const patchEntry = (key: string, patch: Partial<BatchEntry>) =>
    commitBatch(batchRef.current.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  const startBatch = (assets: ImagePicker.ImagePickerAsset[]) => {
    const entries: BatchEntry[] = assets.map((a, i) => ({ key: `${Date.now()}-${i}`, localUri: a.uri, status: "pending" }));
    commitBatch(entries);
    runBatch(assets);
  };

  /** Sequential worker: analyses pending entries one at a time so the phone and the AI aren't flooded. */
  const runBatch = async (assets?: ImagePicker.ImagePickerAsset[]) => {
    if (running.current) return;
    running.current = true;
    try {
      while (true) {
        const next = batchRef.current.find((e) => e.status === "pending");
        if (!next) break;
        patchEntry(next.key, { status: "uploading", error: undefined });
        try {
          const asset = assets?.find((a) => a.uri === next.localUri);
          const uri =
            Platform.OS === "web" || !asset ? next.localUri : await compressForUpload(asset.uri, asset.width, asset.height);
          const created = await uploadItemImage(uri);
          patchEntry(next.key, { status: "done", item: created, localUri: uri });
        } catch (e: any) {
          const msg = e?.message && e.message !== "Network request failed" ? e.message : "Upload failed — tap retry";
          patchEntry(next.key, { status: "error", error: msg });
        }
      }
    } finally {
      running.current = false;
      qc.invalidateQueries({ queryKey: ["items"] });
    }
  };

  const retryEntry = (key: string) => {
    patchEntry(key, { status: "pending", error: undefined });
    runBatch();
  };

  const removeEntry = async (key: string) => {
    const entry = batchRef.current.find((e) => e.key === key);
    commitBatch(batchRef.current.filter((e) => e.key !== key));
    // The piece was already created on upload — drop it from the closet too.
    if (entry?.item) {
      try {
        await api.deleteItem(entry.item.id);
        qc.invalidateQueries({ queryKey: ["items"] });
      } catch {}
    }
    if (batchRef.current.length === 0) setBatch(null);
  };

  const editEntry = (key: string, patch: Partial<Item>) =>
    commitBatch(batchRef.current.map((e) => (e.key === key && e.item ? { ...e, item: { ...e.item, ...patch } } : e)));

  const saveBatch = async () => {
    const done = batchRef.current.filter((e) => e.status === "done" && e.item);
    if (!done.length) return;
    setSaving(true);
    try {
      await Promise.all(done.map((e) => api.updateItem(e.item!.id, editable(e.item!))));
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      show(`${done.length} ${done.length === 1 ? "item" : "items"} added to closet`, "success");
      close();
    } catch {
      setError("Could not save some items. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await api.updateItem(item.id, editable(item));
      qc.invalidateQueries({ queryKey: ["items"] });
      show("Item added to closet", "success");
      close();
    } catch {
      setError("Could not save item. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const batchBusy = !!batch && batch.some((e) => e.status === "pending" || e.status === "uploading");
  const batchReady = batch ? batch.filter((e) => e.status === "done").length : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topbar}>
        <Text style={styles.topTitle}>ADD ITEM</Text>
        <Pressable onPress={close} testID="close-add-item" hitSlop={8}>
          <X color={colors.onSurface} size={24} weight="bold" />
        </Pressable>
      </View>
      <View style={styles.hairline} />

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["3xl"], gap: spacing.lg }}
        bottomOffset={20}
        keyboardShouldPersistTaps="handled"
      >
        {!!error && (
          <View style={styles.errorBox} testID="add-item-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {batch ? (
          <>
            <BulkReview entries={batch} onEdit={editEntry} onRetry={retryEntry} onRemove={removeEntry} />
            <Button
              title={batchBusy ? "Analysing…" : `Save ${batchReady} to Closet`}
              onPress={saveBatch}
              loading={saving}
              disabled={batchBusy || batchReady === 0}
              testID="save-batch-btn"
            />
          </>
        ) : !localUri ? (
          <View style={styles.pickWrap}>
            <Pressable style={styles.pickBtn} onPress={() => pick("camera")} testID="take-photo-btn">
              <Camera color={colors.onSurface} size={32} />
              <Text style={styles.pickText}>TAKE PHOTO</Text>
            </Pressable>
            <Pressable style={styles.pickBtn} onPress={() => pick("library")} testID="choose-photo-btn">
              <Images color={colors.onSurface} size={32} />
              <Text style={styles.pickText}>CHOOSE FROM GALLERY</Text>
              <Text style={styles.pickHint}>SELECT UP TO {MAX_BATCH} PHOTOS AT ONCE</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.previewBox}>
              <Image source={{ uri: item ? imageUri(item) : localUri }} style={styles.preview} contentFit="contain" />
              {analyzing && (
                <View style={styles.analyzeOverlay} testID="analyzing-overlay">
                  <Text style={styles.analyzeText}>ANALYSING & REMOVING BACKGROUND...</Text>
                </View>
              )}
            </View>

            {!item && !analyzing && (
              <View style={styles.retryRow} testID="upload-retry-row">
                <Button title="Try Again" onPress={() => upload(localUri)} testID="retry-upload-btn" style={{ flex: 1 }} />
                <Button title="Choose Another" variant="outline" onPress={reset} testID="reset-photo-btn" style={{ flex: 1 }} />
              </View>
            )}

            {item && (
              <View style={{ gap: spacing.lg }} testID="tag-editor">
                <ItemEditor value={item} onChange={(patch) => setItem((it) => (it ? { ...it, ...patch } : it))} />
                <Button title="Save to Closet" onPress={save} loading={saving} testID="save-item-btn" />
              </View>
            )}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  topTitle: { fontSize: fontSize.xl, fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  hairline: { height: 1, backgroundColor: c.borderStrong },
  pickWrap: { gap: spacing.md, marginTop: spacing.xl },
  pickBtn: { borderWidth: 1, borderColor: c.borderStrong, paddingVertical: spacing["2xl"], alignItems: "center", gap: spacing.md, backgroundColor: c.surfaceTertiary },
  pickText: { fontSize: fontSize.base, fontWeight: "800", letterSpacing: 2, color: c.onSurface },
  pickHint: { fontSize: 10, letterSpacing: 1.5, color: c.muted, fontWeight: "700", marginTop: -spacing.xs },
  previewBox: { aspectRatio: 1, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  preview: { width: "100%", height: "100%" },
  analyzeOverlay: { ...({ position: "absolute" } as any), left: 0, right: 0, bottom: 0, padding: spacing.md, backgroundColor: c.surfaceInverse },
  analyzeText: { color: c.onSurfaceInverse, fontSize: fontSize.sm, letterSpacing: 1, textAlign: "center", fontWeight: "700" },
  errorBox: { borderWidth: 1, borderColor: c.error, padding: spacing.md, backgroundColor: c.surfaceTertiary },
  errorText: { color: c.error, fontSize: fontSize.sm, fontWeight: "700", letterSpacing: 0.3, lineHeight: 19 },
  retryRow: { flexDirection: "row", gap: spacing.sm },
}));
