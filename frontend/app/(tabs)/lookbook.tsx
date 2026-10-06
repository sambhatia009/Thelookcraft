import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { CheckCircle, DownloadSimple, Export, Tag, Trash } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { api, Outfit } from "@/src/api";
import { ItemThumb } from "@/src/components/item-thumb";
import { OccasionSheet, OCCASIONS } from "@/src/components/occasion-sheet";
import { TryOnPreview } from "@/src/components/try-on-preview";
import { usesNativeTabs } from "@/src/navigation";
import { openPhotoSettings, saveToPhotos } from "@/src/save-to-photos";
import { useToast } from "@/src/toast";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Chip, ChipRow, EmptyState } from "@/src/ui";

export default function Lookbook() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { show } = useToast();
  const shotRefs = useRef<Record<string, any>>({});
  const [filter, setFilter] = useState("All");
  const [tagging, setTagging] = useState<Outfit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [visualizing, setVisualizing] = useState<Record<string, boolean>>({});
  const [visualizeErrors, setVisualizeErrors] = useState<Record<string, string>>({});
  const [readyImages, setReadyImages] = useState<Record<string, string | null>>({});

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<Outfit[]>({
    queryKey: ["outfits"],
    queryFn: () => api.outfits(),
  });

  const tags = useMemo(() => {
    const used = new Set((data || []).map((o) => o.occasion || "").filter(Boolean));
    const fixed = OCCASIONS.filter((t) => used.has(t));
    const custom = Array.from(used).filter((t) => !OCCASIONS.includes(t)).sort();
    const hasUntagged = (data || []).some((o) => !o.occasion);
    return [...fixed, ...custom, ...(hasUntagged && used.size > 0 ? ["Untagged"] : [])];
  }, [data]);

  const customTags = tags.filter((t) => !OCCASIONS.includes(t) && t !== "Untagged");

  const visualize = async (outfit: Outfit) => {
    if (visualizing[outfit.id]) return;
    setVisualizing((prev) => ({ ...prev, [outfit.id]: true }));
    setVisualizeErrors((prev) => ({ ...prev, [outfit.id]: "" }));
    try {
      const updated = await api.visualizeOutfit(outfit.id);
      qc.setQueryData<Outfit[]>(["outfits"], (prev) => prev?.map((o) => o.id === outfit.id ? updated : o));
      qc.invalidateQueries({ queryKey: ["outfits"] });
      show("Try-on saved with your look", "success");
    } catch (e: any) {
      const message = e?.message || "Could not create try-on. Please try again.";
      setVisualizeErrors((prev) => ({ ...prev, [outfit.id]: message }));
      show(message, "error", /photo.*Profile/i.test(message)
        ? { label: "Add photo", onPress: () => router.push("/(tabs)/profile") } : undefined);
    } finally {
      setVisualizing((prev) => ({ ...prev, [outfit.id]: false }));
    }
  };

  const visible = useMemo(() => {
    if (!data) return data;
    if (filter === "All") return data;
    if (filter === "Untagged") return data.filter((o) => !o.occasion);
    return data.filter((o) => o.occasion === filter);
  }, [data, filter]);

  const remove = async (id: string) => {
    try {
      await api.deleteOutfit(id);
      qc.invalidateQueries({ queryKey: ["outfits"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      show("Outfit removed", "success");
    } catch {
      show("Could not remove outfit", "error");
    }
  };

  const setOccasion = async (outfit: Outfit, occasion: string) => {
    try {
      await api.updateOutfit(outfit.id, { occasion });
      qc.invalidateQueries({ queryKey: ["outfits"] });
      if (filter !== "All" && filter !== occasion && !(filter === "Untagged" && !occasion)) setFilter("All");
      show(occasion ? `Tagged · ${occasion.toUpperCase()}` : "Tag removed", "success");
    } catch {
      show("Could not update tag", "error");
    }
  };

  const wear = async (outfit: Outfit) => {
    if (busy) return;
    setBusy(outfit.id);
    try {
      await api.wearOutfit(outfit.id);
      qc.invalidateQueries({ queryKey: ["outfits"] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      show(`Logged · ${outfit.items.length} pieces worn today`, "success");
    } catch {
      show("Could not log wear", "error");
    } finally {
      setBusy(null);
    }
  };

  const capture = async (item: Outfit) => {
    if (visualizing[item.id] || (item.visualization_path && readyImages[item.id] !== item.visualization_path)) {
      throw new Error("Wait for your try-on image to load before sharing.");
    }
    const ref = shotRefs.current[item.id];
    if (!ref) throw new Error("no ref");
    // Let the loaded image's aspect ratio/layout commit before native capture.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return captureRef(ref, {
      format: "png",
      quality: 1,
      result: Platform.OS === "web" ? "data-uri" : "tmpfile",
    });
  };

  const share = async (item: Outfit) => {
    if (busy) return;
    setBusy(item.id);
    try {
      const uri = await capture(item);
      if (Platform.OS === "web") {
        await saveToPhotos(uri, `${item.title.replace(/\s+/g, "_")}.png`);
        show("Image downloaded", "success");
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: item.title });
      } else {
        show("Sharing not available", "error");
      }
    } catch {
      show("Could not create share image. Please try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  const save = async (item: Outfit) => {
    if (busy) return;
    setBusy(item.id);
    try {
      const uri = await capture(item);
      const result = await saveToPhotos(uri, `${item.title.replace(/\s+/g, "_")}.png`);
      if (result === "saved") show(Platform.OS === "web" ? "Image downloaded" : "Saved to Photos", "success");
      else if (result === "blocked") show("Photos access is off for TheLookCraft", "error", { label: "Open Settings", onPress: openPhotoSettings });
      else if (result === "denied") show("Allow Photos access to save your look", "error");
      else show("Could not save image", "error");
    } catch {
      show("Could not create image", "error");
    } finally {
      setBusy(null);
    }
  };

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const renderCard = ({ item }: { item: Outfit }) => (
    <View style={styles.card} testID={`outfit-${item.id}`}>
      <View
        ref={(r) => {
          shotRefs.current[item.id] = r;
        }}
        collapsable={false}
        style={styles.shot}
        testID={`share-card-${item.id}`}
      >
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { flex: 1 }]} testID={`outfit-title-${item.id}`}>{item.title.toUpperCase()}</Text>
          {!!item.occasion && (
            <Text style={styles.occasionBadge} testID={`occasion-badge-${item.id}`}>
              {item.occasion.toUpperCase()}
            </Text>
          )}
        </View>
        {!!item.visualization_path && (
          <TryOnPreview key={item.visualization_path} path={item.visualization_path} testID={`lookbook-try-on-${item.id}`}
            onReady={(ready) => setReadyImages((prev) => {
              const next = ready ? item.visualization_path! : null;
              return prev[item.id] === next ? prev : { ...prev, [item.id]: next };
            })} />
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {item.items.map((it) => (
            <View key={it.id} style={[styles.thumb, !!item.visualization_path && styles.smallThumb]}>
              <ItemThumb item={it} />
            </View>
          ))}
        </ScrollView>
        {!!item.stylist_note && <Text style={styles.note} testID={`outfit-note-${item.id}`}>{item.stylist_note}</Text>}
        <View style={styles.itemList}>
          {item.items.map((it) => (
            <Text key={it.id} style={styles.itemLine} testID={`outfit-piece-${item.id}-${it.id}`}>
              · {it.name}
            </Text>
          ))}
        </View>
        <Text style={styles.watermark} testID={`outfit-watermark-${item.id}`}>THELOOKCRAFT</Text>
      </View>

      {!item.visualization_path ? (
        <View style={styles.tryOnSection}>
          <Pressable testID={`visualize-outfit-${item.id}`} accessibilityRole="button"
            disabled={visualizing[item.id] || !!busy} onPress={() => visualize(item)}
            style={({ pressed }) => [styles.tryOnButton, (pressed || visualizing[item.id]) && styles.dimmed]}>
            {visualizing[item.id] ? <ActivityIndicator color={colors.onSurface} testID={`visualizing-outfit-${item.id}`} />
              : <Ionicons name="person-outline" color={colors.onSurface} size={20} />}
            <Text style={styles.tryOnLabel} testID={`visualize-label-${item.id}`}>
              {visualizing[item.id] ? "CREATING YOUR TRY-ON…" : visualizeErrors[item.id] ? "TRY VISUALISING AGAIN" : "VISUALISE ON ME"}
            </Text>
          </Pressable>
          <Text style={styles.tryOnHint} testID={`visualize-hint-${item.id}`}>
            {visualizing[item.id] ? "This may take a moment. Your image will save here automatically." : "Uses your Profile photo · saves with this look"}
          </Text>
          {!!visualizeErrors[item.id] && <Text style={styles.tryOnError} testID={`visualize-error-${item.id}`}>{visualizeErrors[item.id]}</Text>}
          {/photo.*Profile/i.test(visualizeErrors[item.id] || "") && (
            <Pressable style={styles.profileButton} testID={`add-try-on-photo-${item.id}`} onPress={() => router.push("/(tabs)/profile")}>
              <Text style={styles.tryOnLabel}>ADD YOUR PHOTO IN PROFILE</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <Text style={styles.savedHint} testID={`try-on-saved-${item.id}`}>TRY-ON SAVED · INCLUDED IN SHARE & SAVE</Text>
      )}

      <View style={styles.metaRow}>
        <Pressable style={styles.tagBtn} onPress={() => setTagging(item)} testID={`tag-outfit-${item.id}`} hitSlop={6}>
          <Tag color={colors.onSurface} size={14} weight="bold" />
          <Text style={styles.tagBtnText}>{item.occasion ? "EDIT TAG" : "ADD TAG"}</Text>
        </Pressable>
        {!!item.wear_count && (
          <Text style={styles.wornCount} testID={`worn-count-${item.id}`}>
            WORN {item.wear_count}×
          </Text>
        )}
      </View>

      <View style={styles.cardActions}>
        <Action icon={<Export color={colors.onSurface} size={18} weight="bold" />} label="SHARE" onPress={() => share(item)} testID={`share-outfit-${item.id}`} disabled={!!busy || visualizing[item.id] || (!!item.visualization_path && readyImages[item.id] !== item.visualization_path)} />
        <Action icon={<DownloadSimple color={colors.onSurface} size={18} weight="bold" />} label="SAVE" onPress={() => save(item)} testID={`save-photos-${item.id}`} disabled={!!busy || visualizing[item.id] || (!!item.visualization_path && readyImages[item.id] !== item.visualization_path)} />
        <Action icon={<CheckCircle color={colors.onSurface} size={18} weight="bold" />} label="WEAR" onPress={() => wear(item)} testID={`wear-outfit-${item.id}`} disabled={!!busy || visualizing[item.id]} />
        <Action icon={<Trash color={colors.onSurface} size={18} weight="bold" />} label="DELETE" onPress={() => remove(item.id)} testID={`delete-outfit-${item.id}`} disabled={!!busy || visualizing[item.id]} />
      </View>
      {busy === item.id && <ActivityIndicator style={styles.actionProgress} color={colors.onSurface} testID={`outfit-action-loading-${item.id}`} />}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>LOOKBOOK</Text>
        <Text style={styles.sub}>SAVED OUTFITS</Text>
      </View>
      <View style={styles.hairlineStrong} />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.onSurface} />
        </View>
      ) : isError ? (
        <EmptyState title="COULD NOT LOAD LOOKBOOK" actionLabel="Retry" onAction={() => refetch()} testID="lookbook-error" />
      ) : data && data.length === 0 ? (
        <EmptyState title="NO SAVED OUTFITS" actionLabel="Open Stylist" onAction={() => router.push("/(tabs)/stylist")} testID="lookbook-empty" />
      ) : (
        <>
          {tags.length > 0 && (
            <View style={styles.filterWrap} testID="lookbook-filters">
              <ChipRow>
                <Chip label="All" active={filter === "All"} onPress={() => setFilter("All")} testID="filter-All" />
                {tags.map((t) => (
                  <Chip key={t} label={t} active={filter === t} onPress={() => setFilter(t)} testID={`filter-${t}`} />
                ))}
              </ChipRow>
              <View style={styles.hairline} />
            </View>
          )}
          {visible && visible.length === 0 ? (
            <EmptyState title={`NO ${filter.toUpperCase()} LOOKS`} actionLabel="Show All" onAction={() => setFilter("All")} testID="lookbook-filter-empty" />
          ) : (
            <FlatList
              data={visible}
              keyExtractor={(o) => o.id}
              renderItem={renderCard}
              removeClippedSubviews={false}
              onRefresh={refetch}
              refreshing={isRefetching}
              ItemSeparatorComponent={() => <View style={styles.hairlineStrong} />}
              contentContainerStyle={{ paddingBottom: bottomChrome + spacing.xl }}
            />
          )}
        </>
      )}

      <OccasionSheet
        open={!!tagging}
        initial={tagging?.occasion}
        extraTags={customTags}
        onClose={() => setTagging(null)}
        onConfirm={(occasion) => {
          const o = tagging;
          setTagging(null);
          if (o) setOccasion(o, occasion);
        }}
      />
    </View>
  );
}

function Action({ icon, label, onPress, testID, disabled }: { icon: React.ReactNode; label: string; onPress: () => void; testID: string; disabled?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable style={({ pressed }) => [styles.actionBtn, (disabled || pressed) && styles.dimmed]} onPress={onPress} testID={testID} disabled={disabled} accessibilityRole="button">
      {icon}
      <Text style={styles.actionText} testID={`${testID}-label`}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: fontSize["3xl"], fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  sub: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 1, marginTop: 2 },
  hairlineStrong: { height: 1, backgroundColor: c.border },
  hairline: { height: 1, backgroundColor: c.border },
  filterWrap: { backgroundColor: c.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { paddingBottom: spacing.lg },
  shot: { backgroundColor: c.surface, paddingVertical: spacing.xl, gap: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingHorizontal: spacing.lg },
  cardTitle: { fontSize: fontSize.xl, fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  occasionBadge: { fontSize: 10, fontWeight: "900", letterSpacing: 2, color: c.onBrandPrimary, backgroundColor: c.brandPrimary, paddingHorizontal: spacing.sm, paddingVertical: 4, marginTop: 4 },
  row: { gap: 1, paddingHorizontal: spacing.lg },
  thumb: { width: 150, height: 190, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  smallThumb: { width: 74, height: 94 },
  tryOnSection: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  tryOnButton: { minHeight: 52, padding: spacing.md, flexDirection: "row", gap: spacing.sm, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surfaceTertiary },
  tryOnLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: c.onSurface, flexShrink: 1 },
  tryOnHint: { fontSize: 12, lineHeight: 18, color: c.muted },
  tryOnError: { fontSize: 12, lineHeight: 18, color: c.error },
  profileButton: { minHeight: 44, justifyContent: "center" },
  savedHint: { fontSize: 10, letterSpacing: 1, color: c.muted, marginHorizontal: spacing.lg, marginBottom: spacing.md },
  dimmed: { opacity: 0.5 },
  actionProgress: { marginTop: spacing.md },
  note: { paddingHorizontal: spacing.lg, fontSize: fontSize.base, color: c.onSurfaceSecondary, lineHeight: 21 },
  itemList: { paddingHorizontal: spacing.lg, gap: 2 },
  itemLine: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 0.5 },
  watermark: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, fontSize: 11, letterSpacing: 4, color: c.muted, fontWeight: "800" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginTop: spacing.xs, marginBottom: spacing.sm, minHeight: 32 },
  tagBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, height: 44, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceTertiary },
  tagBtnText: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  wornCount: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: c.muted },
  cardActions: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg },
  actionBtn: { flex: 1, height: 48, alignItems: "center", justifyContent: "center", gap: 2, borderWidth: 1, borderColor: c.borderStrong },
  actionText: { fontSize: 9, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
}));
