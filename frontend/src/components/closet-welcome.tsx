import { router } from "expo-router";
import { Camera, Check, Images } from "phosphor-react-native";
import { Pressable, Text, View } from "react-native";

import { Item } from "@/src/api";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Button } from "@/src/ui";

const STARTER = [
  { category: "Tops", label: "A TOP" },
  { category: "Bottoms", label: "BOTTOMS" },
  { category: "Shoes", label: "SHOES" },
  { category: "Outerwear", label: "A LAYER" },
  { category: "Accessories", label: "AN ACCESSORY" },
];
export const STARTER_GOAL = STARTER.length;

function covered(items: Item[]) {
  const cats = new Set(items.map((i) => i.category));
  return STARTER.map((s) => ({ ...s, done: cats.has(s.category) }));
}

/** First-run card for an empty closet: why 5 pieces matter + the two ways to add them. */
export function ClosetWelcome() {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} testID="closet-welcome">
      <View style={styles.card}>
        <Text style={styles.kicker}>WELCOME TO THELOOKCRAFT</Text>
        <Text style={styles.title}>Snap your first 5 pieces.</Text>
        <Text style={styles.body}>
          Photograph the clothes you actually wear — one at a time, on a plain background. Five pieces are enough for your
          stylist to start building real outfits from your own closet.
        </Text>
        <View style={styles.list}>
          {STARTER.map((s, i) => (
            <View key={s.category} style={styles.row}>
              <View style={styles.num}>
                <Text style={styles.numText}>{i + 1}</Text>
              </View>
              <Text style={styles.rowText}>{s.label}</Text>
            </View>
          ))}
        </View>
        <Button
          title="Snap With Camera"
          onPress={() => router.push("/add-item?source=camera")}
          testID="welcome-camera"
          icon={<Camera color={colors.onBrandPrimary} size={18} weight="bold" />}
        />
        <Button
          title="Pick From Gallery"
          variant="outline"
          onPress={() => router.push("/add-item?source=library")}
          testID="welcome-gallery"
          style={{ marginTop: spacing.sm }}
          icon={<Images color={colors.onSurface} size={18} weight="bold" />}
        />
      </View>
    </View>
  );
}

/** Compact progress strip shown above the grid until the starter five are in. */
export function StarterProgress({ items }: { items: Item[] }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const steps = covered(items);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <Pressable onPress={() => router.push("/add-item")} style={styles.strip} testID="starter-progress">
      <View style={{ flex: 1, gap: spacing.sm }}>
        <Text style={styles.stripTitle}>
          {done} OF {STARTER_GOAL} STARTER PIECES
        </Text>
        <View style={styles.squares}>
          {steps.map((s) => (
            <View key={s.category} style={[styles.square, s.done && styles.squareDone]} testID={`starter-${s.category}-${s.done ? "done" : "todo"}`}>
              {s.done ? <Check color={colors.onBrandPrimary} size={12} weight="bold" /> : null}
            </View>
          ))}
        </View>
        <Text style={styles.stripHint}>{next ? `NEXT: ADD ${next.label}` : "ALL SET — YOUR STYLIST IS READY"}</Text>
      </View>
      <Text style={styles.stripAction}>ADD</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flex: 1, padding: spacing.lg, justifyContent: "center" },
  card: { borderWidth: 1, borderColor: c.onSurface, padding: spacing.xl, backgroundColor: c.surface },
  kicker: { fontSize: fontSize.sm, letterSpacing: 2, color: c.muted, fontWeight: "600" },
  title: { fontSize: fontSize["2xl"], fontWeight: "900", color: c.onSurface, marginTop: spacing.sm, letterSpacing: 0.5 },
  body: { fontSize: fontSize.base, lineHeight: 21, color: c.onSurfaceSecondary, marginTop: spacing.md },
  list: { marginVertical: spacing.xl, gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  num: { width: 24, height: 24, borderWidth: 1, borderColor: c.onSurface, alignItems: "center", justifyContent: "center" },
  numText: { fontSize: fontSize.sm, fontWeight: "700", color: c.onSurface },
  rowText: { fontSize: fontSize.sm, letterSpacing: 1.5, fontWeight: "600", color: c.onSurface },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: c.onSurface,
    backgroundColor: c.surface,
    minHeight: 44,
  },
  stripTitle: { fontSize: fontSize.sm, letterSpacing: 2, fontWeight: "700", color: c.onSurface },
  squares: { flexDirection: "row", gap: spacing.sm },
  square: { width: 22, height: 22, borderWidth: 1, borderColor: c.onSurface, alignItems: "center", justifyContent: "center" },
  squareDone: { backgroundColor: c.brandPrimary },
  stripHint: { fontSize: fontSize.sm, letterSpacing: 1, color: c.muted },
  stripAction: { fontSize: fontSize.sm, letterSpacing: 2, fontWeight: "700", color: c.onSurface },
}));
