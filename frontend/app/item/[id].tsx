import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { CheckCircle, Sparkle, X } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Item } from "@/src/api";
import { ItemThumb } from "@/src/components/item-thumb";
import { useToast } from "@/src/toast";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Button } from "@/src/ui";

export default function ItemDetail() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { show } = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: items, isLoading } = useQuery({ queryKey: ["items", "All"], queryFn: () => api.items("All") });
  const item: Item | undefined = items?.find((i) => i.id === id);
  const [wearing, setWearing] = useState(false);

  const wore = async () => {
    if (!item || wearing) return;
    setWearing(true);
    try {
      const updated = await api.wearItem(item.id);
      qc.setQueryData<Item[]>(["items", "All"], (old) => old?.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["insights"] });
      show(`Logged · worn ${updated.wear_count ?? 1}×`, "success");
    } catch {
      show("Could not log wear", "error");
    } finally {
      setWearing(false);
    }
  };

  const del = async () => {
    if (!item) return;
    try {
      await api.deleteItem(item.id);
      qc.invalidateQueries({ queryKey: ["items"] });
      show("Item removed", "success");
      router.back();
    } catch {
      show("Could not remove item", "error");
    }
  };

  const styleAround = () => {
    router.back();
    setTimeout(() => router.push(`/(tabs)/stylist?focusId=${item?.id}`), 50);
  };

  const rows: [string, string][] = item
    ? [
        ["CATEGORY", item.category],
        ["SUBCATEGORY", item.subcategory || "—"],
        ["COLOR", item.color || "—"],
        ["FORMALITY", item.formality || "—"],
        ["FABRIC", item.fabric || "—"],
        ["SEASON", item.season || "—"],
        ["TIMES WORN", String(item.wear_count ?? 0)],
      ]
    : [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topbar}>
        <Text style={styles.topTitle}>ITEM</Text>
        <Pressable onPress={() => router.back()} testID="close-detail" hitSlop={8}>
          <X color={colors.onSurface} size={24} weight="bold" />
        </Pressable>
      </View>
      <View style={styles.hairline} />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.onSurface} />
        </View>
      ) : !item ? (
        <View style={styles.center}>
          <Text style={styles.notFound}>ITEM NOT FOUND</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
          <View style={styles.hero}>
            <ItemThumb item={item} />
          </View>
          <Text style={styles.name}>{item.name}</Text>
          <View style={styles.table}>
            {rows.map(([k, v]) => (
              <View key={k} style={styles.row}>
                <Text style={styles.rowKey}>{k}</Text>
                <Text style={styles.rowVal}>{v}</Text>
              </View>
            ))}
          </View>
          <View style={styles.actions}>
            <Pressable style={styles.styleBtn} onPress={styleAround} testID="style-around-btn">
              <Sparkle color={colors.onBrandPrimary} size={20} weight="fill" />
              <Text style={styles.styleBtnText}>STYLE AROUND THIS</Text>
            </Pressable>
            <Pressable style={[styles.woreBtn, wearing && { opacity: 0.5 }]} onPress={wore} disabled={wearing} testID="wore-today-btn">
              <CheckCircle color={colors.onSurface} size={20} weight="bold" />
              <Text style={styles.woreBtnText}>WORE IT TODAY</Text>
            </Pressable>
            <Button title="Delete Item" variant="outline" onPress={del} testID="delete-item-btn" />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  topTitle: { fontSize: fontSize.xl, fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  hairline: { height: 1, backgroundColor: c.borderStrong },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  notFound: { color: c.muted, letterSpacing: 2, fontWeight: "700" },
  hero: { aspectRatio: 1, backgroundColor: c.surfaceTertiary, borderBottomWidth: 1, borderBottomColor: c.border },
  name: { fontSize: fontSize["2xl"], fontWeight: "900", letterSpacing: 0.3, color: c.onSurface, padding: spacing.lg },
  table: { borderTopWidth: 1, borderTopColor: c.border },
  row: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
  rowKey: { fontSize: fontSize.sm, letterSpacing: 2, color: c.muted },
  rowVal: { fontSize: fontSize.base, fontWeight: "700", color: c.onSurface },
  actions: { padding: spacing.lg, gap: spacing.md },
  styleBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: c.brandPrimary },
  styleBtnText: { fontSize: fontSize.base, fontWeight: "800", letterSpacing: 1, color: c.onBrandPrimary },
  woreBtn: { height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surfaceTertiary },
  woreBtnText: { fontSize: fontSize.base, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
}));
