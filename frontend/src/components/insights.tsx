import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { api } from "@/src/api";
import { ItemThumb } from "@/src/components/item-thumb";
import { isLightSwatch, swatchFor } from "@/src/garment-colors";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";

export function InsightsPanel() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError } = useQuery({ queryKey: ["insights"], queryFn: () => api.insights() });

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.onSurface} />
      </View>
    );
  }
  if (isError || !data) {
    return <Text style={styles.hint}>INSIGHTS UNAVAILABLE</Text>;
  }

  const fallbackSwatch = colors.muted;

  return (
    <View testID="insights-panel">
      {/* Headline numbers */}
      <View style={styles.kpiRow}>
        <Kpi label="Wears logged" value={data.total_wears} testID="kpi-wears" />
        <Kpi label="Saved looks" value={data.saved_outfits} testID="kpi-outfits" />
        <Kpi label="Never worn" value={data.never_worn_count} testID="kpi-never" last />
      </View>

      {/* Most worn */}
      <Text style={styles.subTitle}>MOST WORN</Text>
      {data.most_worn.length === 0 ? (
        <Text style={styles.hint} testID="most-worn-empty">
          Tap “Wore it today” on an item or “Wear this look” in your Lookbook to start tracking.
        </Text>
      ) : (
        <View style={styles.wornList}>
          {data.most_worn.map((it, idx) => (
            <Pressable key={it.id} style={styles.wornRow} onPress={() => router.push(`/item/${it.id}`)} testID={`most-worn-${idx}`}>
              <Text style={styles.rank}>{String(idx + 1).padStart(2, "0")}</Text>
              <View style={styles.wornThumb}>
                <ItemThumb item={it} />
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={styles.wornName}>
                  {it.name}
                </Text>
                <Text style={styles.wornMeta}>
                  {it.wear_count} {it.wear_count === 1 ? "WEAR" : "WEARS"} · IN {it.outfit_appearances} {it.outfit_appearances === 1 ? "LOOK" : "LOOKS"}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {/* Color balance */}
      <Text style={styles.subTitle}>COLOR BALANCE</Text>
      {data.color_balance.length > 0 && (
        <View style={styles.bar} testID="color-bar">
          {data.color_balance.map((c) => {
            const hex = swatchFor(c.color, fallbackSwatch);
            return (
              <View
                key={c.color}
                style={[
                  styles.barSeg,
                  { flex: c.count, backgroundColor: hex },
                  isLightSwatch(hex) && { borderWidth: 1, borderColor: colors.border },
                ]}
              />
            );
          })}
        </View>
      )}
      <View style={styles.legend}>
        {data.color_balance.map((c) => {
          const hex = swatchFor(c.color, fallbackSwatch);
          return (
            <View key={c.color} style={styles.legendItem} testID={`color-${c.color}`}>
              <View style={[styles.dot, { backgroundColor: hex }, isLightSwatch(hex) && { borderWidth: 1, borderColor: colors.border }]} />
              <Text style={styles.legendText}>
                {c.color.toUpperCase()} <Text style={styles.legendPct}>{c.pct}%</Text>
              </Text>
            </View>
          );
        })}
      </View>

      {/* Category balance */}
      <Text style={styles.subTitle}>CATEGORY BALANCE</Text>
      <View style={styles.catList}>
        {data.category_balance.map((c) => (
          <View key={c.category} style={styles.catRow} testID={`cat-${c.category}`}>
            <Text style={styles.catLabel}>{c.category.toUpperCase()}</Text>
            <View style={styles.catTrack}>
              <View style={[styles.catFill, { width: `${Math.max(c.pct, c.count ? 3 : 0)}%` }]} />
            </View>
            <Text style={styles.catCount}>{c.count}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Kpi({ label, value, testID, last }: { label: string; value: number; testID: string; last?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.kpi, last && { borderRightWidth: 0 }]} testID={testID}>
      <Text style={styles.kpiNum}>{value}</Text>
      <Text style={styles.kpiLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  loading: { paddingVertical: spacing.xl, alignItems: "center" },
  hint: { fontSize: fontSize.sm, color: c.muted, lineHeight: 19, letterSpacing: 0.3 },
  kpiRow: { flexDirection: "row", borderWidth: 1, borderColor: c.border, marginBottom: spacing.lg },
  kpi: { flex: 1, alignItems: "center", paddingVertical: spacing.md, borderRightWidth: 1, borderRightColor: c.border },
  kpiNum: { fontSize: fontSize.xl, fontWeight: "900", color: c.onSurface },
  kpiLabel: { fontSize: 9, letterSpacing: 1, color: c.muted, marginTop: 2 },
  subTitle: { fontSize: 10, letterSpacing: 2, color: c.muted, marginTop: spacing.md, marginBottom: spacing.sm, fontWeight: "700" },
  wornList: { gap: spacing.sm },
  wornRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, borderWidth: 1, borderColor: c.border, paddingRight: spacing.md },
  rank: { width: 32, textAlign: "center", fontSize: fontSize.sm, fontWeight: "900", color: c.muted, letterSpacing: 1 },
  wornThumb: { width: 56, height: 56, backgroundColor: c.surfaceTertiary },
  wornName: { fontSize: fontSize.base, fontWeight: "700", color: c.onSurface },
  wornMeta: { fontSize: 10, letterSpacing: 1, color: c.muted, marginTop: 2 },
  bar: { flexDirection: "row", height: 28, overflow: "hidden" },
  barSeg: { height: "100%" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  dot: { width: 10, height: 10 },
  legendText: { fontSize: 10, letterSpacing: 1, color: c.onSurface, fontWeight: "700" },
  legendPct: { color: c.muted, fontWeight: "600" },
  catList: { gap: spacing.sm },
  catRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  catLabel: { width: 92, fontSize: 10, letterSpacing: 1, color: c.onSurface, fontWeight: "700" },
  catTrack: { flex: 1, height: 10, backgroundColor: c.surfaceTertiary },
  catFill: { height: "100%", backgroundColor: c.brandPrimary },
  catCount: { width: 24, textAlign: "right", fontSize: fontSize.sm, fontWeight: "800", color: c.onSurface },
}));
