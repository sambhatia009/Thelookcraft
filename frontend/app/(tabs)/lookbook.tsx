import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { Export, Trash } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Item } from "@/src/api";
import { ItemThumb } from "@/src/components/item-thumb";
import { usesNativeTabs } from "@/src/navigation";
import { useToast } from "@/src/toast";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { EmptyState } from "@/src/ui";

type Outfit = { id: string; title: string; stylist_note: string; items: Item[]; created_at: string };

export default function Lookbook() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { show } = useToast();
  const shotRefs = useRef<Record<string, any>>({});

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<Outfit[]>({
    queryKey: ["outfits"],
    queryFn: () => api.outfits(),
  });

  const remove = async (id: string) => {
    try {
      await api.deleteOutfit(id);
      qc.invalidateQueries({ queryKey: ["outfits"] });
      show("Outfit removed", "success");
    } catch {
      show("Could not remove outfit", "error");
    }
  };

  const share = async (item: Outfit) => {
    const ref = shotRefs.current[item.id];
    if (!ref) return;
    try {
      const uri = await captureRef(ref, {
        format: "png",
        quality: 1,
        result: Platform.OS === "web" ? "data-uri" : "tmpfile",
      });
      if (Platform.OS === "web") {
        const a = document.createElement("a");
        a.href = uri;
        a.download = `${item.title.replace(/\s+/g, "_")}.png`;
        a.click();
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
        <Text style={styles.cardTitle}>{item.title.toUpperCase()}</Text>
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

      <View style={styles.cardActions}>
        <Pressable style={styles.actionBtn} onPress={() => share(item)} testID={`share-outfit-${item.id}`}>
          <Export color={colors.onSurface} size={18} weight="bold" />
          <Text style={styles.actionText}>SHARE</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => remove(item.id)} testID={`delete-outfit-${item.id}`}>
          <Trash color={colors.onSurface} size={18} weight="bold" />
          <Text style={styles.actionText}>DELETE</Text>
        </Pressable>
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
        <FlatList
          data={data}
          keyExtractor={(o) => o.id}
          renderItem={renderCard}
          onRefresh={refetch}
          refreshing={isRefetching}
          ItemSeparatorComponent={() => <View style={styles.hairlineStrong} />}
          contentContainerStyle={{ paddingBottom: bottomChrome + spacing.xl }}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  title: { fontSize: fontSize["3xl"], fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  sub: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 1, marginTop: 2 },
  hairlineStrong: { height: 1, backgroundColor: c.border },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { paddingBottom: spacing.lg },
  shot: { backgroundColor: c.surface, paddingVertical: spacing.xl, gap: spacing.md },
  cardTitle: { fontSize: fontSize.xl, fontWeight: "900", letterSpacing: 1, color: c.onSurface, paddingHorizontal: spacing.lg },
  row: { gap: 1, paddingHorizontal: spacing.lg },
  thumb: { width: 150, height: 190, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  note: { paddingHorizontal: spacing.lg, fontSize: fontSize.base, color: c.onSurfaceSecondary, lineHeight: 21 },
  itemList: { paddingHorizontal: spacing.lg, gap: 2 },
  itemLine: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 0.5 },
  watermark: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, fontSize: 11, letterSpacing: 4, color: c.muted, fontWeight: "800" },
  cardActions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  actionBtn: { flex: 1, height: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: c.borderStrong },
  actionText: { fontSize: fontSize.sm, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
}));
