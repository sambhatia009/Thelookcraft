import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Camera, Images, X } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Item, uploadItemImage, api, imageUri } from "@/src/api";
import { useToast } from "@/src/toast";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Button, Chip } from "@/src/ui";

const CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"];
const FORMALITY = ["Casual", "Smart Casual", "Formal"];
const SEASONS = ["All Season", "Spring", "Summer", "Autumn", "Winter"];

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

  const close = () => router.back();

  const pick = async (source: "camera" | "library") => {
    try {
      let perm;
      if (source === "camera") perm = await ImagePicker.requestCameraPermissionsAsync();
      else perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        if (!perm.canAskAgain) {
          show("Permission denied. Enable it in Settings.", "error");
          Linking.openSettings();
        } else {
          show(`${source === "camera" ? "Camera" : "Photos"} permission needed`, "error");
        }
        return;
      }

      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });

      if (result.canceled || !result.assets?.length) return;
      const uri = result.assets[0].uri;
      setLocalUri(uri);
      setAnalyzing(true);
      try {
        const created = await uploadItemImage(uri);
        setItem(created);
        qc.invalidateQueries({ queryKey: ["items"] });
      } catch (e: any) {
        show(e?.message || "Upload failed", "error");
        setLocalUri(null);
      } finally {
        setAnalyzing(false);
      }
    } catch {
      show("Could not open camera/gallery", "error");
    }
  };

  const save = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await api.updateItem(item.id, {
        name: item.name,
        category: item.category,
        subcategory: item.subcategory,
        color: item.color,
        formality: item.formality,
        fabric: item.fabric,
        season: item.season,
      });
      qc.invalidateQueries({ queryKey: ["items"] });
      show("Item added to closet", "success");
      close();
    } catch {
      show("Could not save item", "error");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: keyof Item, v: string) => setItem((it) => (it ? { ...it, [k]: v } : it));

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
        {!localUri ? (
          <View style={styles.pickWrap}>
            <Pressable style={styles.pickBtn} onPress={() => pick("camera")} testID="take-photo-btn">
              <Camera color={colors.onSurface} size={32} />
              <Text style={styles.pickText}>TAKE PHOTO</Text>
            </Pressable>
            <Pressable style={styles.pickBtn} onPress={() => pick("library")} testID="choose-photo-btn">
              <Images color={colors.onSurface} size={32} />
              <Text style={styles.pickText}>CHOOSE FROM GALLERY</Text>
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

            {item && (
              <View style={{ gap: spacing.lg }} testID="tag-editor">
                <Field label="NAME" value={item.name} onChangeText={(t) => set("name", t)} testID="name-field" />

                <View>
                  <Text style={styles.label}>CATEGORY</Text>
                  <View style={styles.chipWrap}>
                    {CATEGORIES.map((cat) => (
                      <Chip key={cat} label={cat} active={item.category === cat} onPress={() => set("category", cat)} testID={`cat-${cat}`} />
                    ))}
                  </View>
                </View>

                <Field label="SUBCATEGORY" value={item.subcategory} onChangeText={(t) => set("subcategory", t)} testID="subcat-field" />
                <Field label="COLOR" value={item.color} onChangeText={(t) => set("color", t)} testID="color-field" />
                <Field label="FABRIC" value={item.fabric} onChangeText={(t) => set("fabric", t)} testID="fabric-field" />

                <View>
                  <Text style={styles.label}>FORMALITY</Text>
                  <View style={styles.chipWrap}>
                    {FORMALITY.map((f) => (
                      <Chip key={f} label={f} active={item.formality === f} onPress={() => set("formality", f)} testID={`form-${f}`} />
                    ))}
                  </View>
                </View>

                <View>
                  <Text style={styles.label}>SEASON</Text>
                  <View style={styles.chipWrap}>
                    {SEASONS.map((s) => (
                      <Chip key={s} label={s} active={item.season === s} onPress={() => set("season", s)} testID={`season-${s}`} />
                    ))}
                  </View>
                </View>

                <Button title="Save to Closet" onPress={save} loading={saving} testID="save-item-btn" />
              </View>
            )}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput testID={testID} style={styles.input} value={value} onChangeText={onChangeText} placeholderTextColor={colors.muted} />
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
  previewBox: { aspectRatio: 1, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  preview: { width: "100%", height: "100%" },
  analyzeOverlay: { ...({ position: "absolute" } as any), left: 0, right: 0, bottom: 0, padding: spacing.md, backgroundColor: c.surfaceInverse },
  analyzeText: { color: c.onSurfaceInverse, fontSize: fontSize.sm, letterSpacing: 1, textAlign: "center", fontWeight: "700" },
  label: { fontSize: fontSize.sm, letterSpacing: 2, color: c.muted, marginBottom: spacing.sm },
  input: { height: 50, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, color: c.onSurface, fontSize: fontSize.base, backgroundColor: c.surfaceTertiary },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
}));
