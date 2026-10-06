import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Plus } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, imageUri, Item } from "@/src/api";
import { ItemThumb } from "@/src/components/item-thumb";
import { usesNativeTabs } from "@/src/navigation";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { ClosetWelcome, STARTER_GOAL, StarterProgress } from "@/src/components/closet-welcome";
import { Chip, ChipRow, EmptyState } from "@/src/ui";

const CATEGORIES = ["All", "Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"];

export default function Closet() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const [category, setCategory] = useState("All");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["items", category],
    queryFn: () => api.items(category),
  });

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const renderItem = ({ item }: { item: Item }) => (
    <Pressable
      testID={`item-${item.id}`}
      style={styles.cell}
      onPress={() => router.push(`/item/${item.id}`)}
    >
      <View style={styles.thumbBox}>
        <ItemThumb item={item} />
      </View>
      <View style={styles.cellMeta}>
        <Text numberOfLines={1} style={styles.cellName}>
          {item.name}
        </Text>
        <Text numberOfLines={1} style={styles.cellSub}>
          {item.color} · {item.category}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.headerWrap}>
        <View style={styles.header}>
          <Text style={styles.title}>CLOSET</Text>
          <Text style={styles.count}>{data ? `${data.length} ITEMS` : ""}</Text>
        </View>
        <ChipRow>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} testID={`filter-${c}`} />
          ))}
        </ChipRow>
        <View style={styles.hairline} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.onSurface} />
          <Text style={styles.loadingText}>SYNCING CLOSET...</Text>
        </View>
      ) : isError ? (
        <EmptyState title="CONNECTION ERROR" actionLabel="Retry" onAction={() => refetch()} testID="closet-error" />
      ) : data && data.length === 0 ? (
        category === "All" ? (
          <ClosetWelcome />
        ) : (
          <EmptyState title="NOTHING HERE YET" actionLabel="Upload Item" onAction={() => router.push("/add-item")} testID="closet-empty" />
        )
      ) : (
        <FlatList
          data={data}
          keyExtractor={(i) => i.id}
          numColumns={2}
          renderItem={renderItem}
          ListHeaderComponent={category === "All" && data && data.length < STARTER_GOAL ? <StarterProgress items={data} /> : null}
          onRefresh={refetch}
          refreshing={isRefetching}
          contentContainerStyle={{ paddingBottom: bottomChrome + 120 }}
          columnWrapperStyle={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
        />
      )}

      <Pressable
        testID="add-item-fab"
        onPress={() => router.push("/add-item")}
        style={({ pressed }) => [
          styles.fab,
          { bottom: bottomChrome + 16, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Plus color={colors.onBrandPrimary} size={26} weight="bold" />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { flex: 1, backgroundColor: c.surface },
  headerWrap: { backgroundColor: c.surface },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: { fontSize: fontSize["3xl"], fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  count: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 1, marginBottom: 4 },
  hairline: { height: 1, backgroundColor: c.borderStrong },
  cell: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: c.border,
  },
  thumbBox: { aspectRatio: 1, backgroundColor: c.surfaceTertiary },
  cellMeta: { padding: spacing.md, gap: 2 },
  cellName: { fontSize: fontSize.base, fontWeight: "700", color: c.onSurface, letterSpacing: 0.3 },
  cellSub: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 0.5, textTransform: "uppercase" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loadingText: { fontSize: fontSize.sm, color: c.muted, letterSpacing: 2 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 60,
    height: 60,
    backgroundColor: c.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
}));
