import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { CheckCircle, DownloadSimple, Export, Tag, Trash } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Outfit } from "@/src/api";
import { ItemThumb } from "@/src/components/item-thumb";
import { OccasionSheet, OCCASIONS } from "@/src/components/occasion-sheet";
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
    const ref = shotRefs.current[item.id];
    if (!ref) throw new Error("no ref");
    return captureRef(ref, {
      format: "png",
      quality: 1,
      result: Platform.OS === "web" ? "data-uri" : "tmpfile",
    });
  };

  const share = async (item: Outfit) => {
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
      show("Could not create share image", "error");
    }
  };

  const save = async (item: Outfit) => {
    if (busy) return;
    setBusy(item.id);
    try {
      const uri = await capture(item);
      const result = await saveToPhotos(uri, `${item.title.replace(/\s+/g, "_")}.png`);
      if (result === "saved") show(Platform.OS === "web" ? "Image downloaded" : "Saved to Photos", "success");
      else if (result === "blocked") show("Photos access is off for StyleVault", "error", { label: "Open Settings", onPress: openPhotoSettings });
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
      >
        <View style={styles.cardHead}>
          <Text style={[styles.cardTitle, { flex: 1 }]}>{item.title.toUpperCase()}</Text>
          {!!item.occasion && (
            <Text style={styles.occasionBadge} testID={`occasion-badge-${item.id}`}>
              {item.occasion.toUpperCase()}
            </Text>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {item.items.map((it) => (
            <View key={it.id} style={styles.thumb}>
              <ItemThumb item={it} />
            </View>
          ))}
        </ScrollView>
        {!!item.stylist_note && <Text style={styles.note}>{item.stylist_note}</Text>}
        <View style={styles.itemList}>
          {item.items.map((it) => (
            <Text key={it.id} style={styles.itemLine}>
              · {it.name}
            </Text>
          ))}
        </View>
        <Text style={styles.watermark}>STYLEVAULT</Text>
      </View>

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
        <Action icon={<Export color={colors.onSurface} size={18} weight="bold" />} label="SHARE" onPress={() => share(item)} testID={`share-outfit-${item.id}`} />
        <Action icon={<DownloadSimple color={colors.onSurface} size={18} weight="bold" />} label="SAVE" onPress={() => save(item)} testID={`save-photos-${item.id}`} disabled={busy === item.id} />
        <Action icon={<CheckCircle color={colors.onSurface} size={18} weight="bold" />} label="WEAR" onPress={() => wear(item)} testID={`wear-outfit-${item.id}`} disabled={busy === item.id} />
        <Action icon={<Trash color={colors.onSurface} size={18} weight="bold" />} label="DELETE" onPress={() => remove(item.id)} testID={`delete-outfit-${item.id}`} />
      </View>
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
    <Pressable style={[styles.actionBtn, disabled && { opacity: 0.5 }]} onPress={onPress} testID={testID} disabled={disabled}>
      {icon}
      <Text style={styles.actionText}>{label}</Text>
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
  note: { paddingHorizontal: spacing.lg, fontSize: fontSize.base, color: c.onSurfaceSecondary, lineHeight: 21 },
  itemList: { paddingHorizontal: spacing.lg, gap: 2 },
  itemLine: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 0.5 },
  watermark: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, fontSize: 11, letterSpacing: 4, color: c.muted, fontWeight: "800" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginTop: spacing.xs, marginBottom: spacing.sm, minHeight: 32 },
  tagBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, height: 32, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceTertiary },
  tagBtnText: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  wornCount: { fontSize: 10, fontWeight: "800", letterSpacing: 1, color: c.muted },
  cardActions: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.lg },
  actionBtn: { flex: 1, height: 48, alignItems: "center", justifyContent: "center", gap: 2, borderWidth: 1, borderColor: c.borderStrong },
  actionText: { fontSize: 9, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
}));
