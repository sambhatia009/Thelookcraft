import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { CheckCircle, PencilSimple, Sparkle, X } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Item } from "@/src/api";
import { ItemThumb } from "@/src/components/item-thumb";
import { EditableItem, ItemEditor } from "@/src/components/item-editor";
import { requestStylistFocus } from "@/src/stylist-focus";
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditableItem | null>(null);
  const [saving, setSaving] = useState(false);
  const avoided = item?.preference === "avoid";

  const applyUpdate = (updated: Item) => {
    qc.setQueryData<Item[]>(["items", "All"], (old) => old?.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));
    qc.invalidateQueries({ queryKey: ["items"] });
  };

  const startEdit = () => {
    if (!item) return;
    setDraft({
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      color: item.color,
      formality: item.formality,
      fabric: item.fabric,
      season: item.season,
      notes: item.notes || "",
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!item || !draft) return;
    setSaving(true);
    try {
      const updated = await api.updateItem(item.id, draft);
      applyUpdate(updated);
      setEditing(false);
      show("Item updated", "success");
    } catch {
      show("Could not update item", "error");
    } finally {
      setSaving(false);
    }
  };

  const togglePreference = async () => {
    if (!item) return;
    try {
      const updated = await api.updateItem(item.id, { preference: avoided ? "neutral" : "avoid" });
      applyUpdate(updated);
      show(avoided ? "Back in the stylist's rotation" : "Stylist won't suggest this piece", "success");
    } catch {
      show("Could not update preference", "error");
    }
  };

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
    if (!item) return;
    requestStylistFocus(item.id);
    // Pops this modal and switches to the Stylist tab in one navigation action.
    router.dismissTo("/(tabs)/stylist");
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
        <KeyboardAwareScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }} bottomOffset={20} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <ItemThumb item={item} />
            {avoided && (
              <View style={styles.avoidBadge} testID="avoid-badge">
                <Text style={styles.avoidBadgeText}>NOT SUGGESTED</Text>
              </View>
            )}
          </View>

          {editing && draft ? (
            <View style={styles.editWrap} testID="item-edit-form">
              <ItemEditor value={draft} onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))} testIDPrefix="edit-" />
              <View style={styles.editActions}>
                <Button title="Cancel" variant="outline" onPress={() => setEditing(false)} testID="cancel-edit-btn" style={{ flex: 1 }} />
                <Button title="Save Changes" onPress={saveEdit} loading={saving} testID="save-edit-btn" style={{ flex: 2 }} />
              </View>
            </View>
          ) : (
            <>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { flex: 1 }]}>{item.name}</Text>
                <Pressable style={styles.editBtn} onPress={startEdit} testID="edit-item-btn" hitSlop={6}>
                  <PencilSimple color={colors.onSurface} size={16} weight="bold" />
                  <Text style={styles.editBtnText}>EDIT</Text>
                </Pressable>
              </View>
              {!!item.notes && (
                <Text style={styles.notes} testID="item-notes">
                  {item.notes}
                </Text>
              )}
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
                <Pressable style={styles.prefRow} onPress={togglePreference} testID="toggle-avoid-btn">
                  <View style={{ flex: 1 }}>
                    <Text style={styles.prefTitle}>DON&apos;T SUGGEST IN LOOKS</Text>
                    <Text style={styles.prefSub}>{avoided ? "The stylist is skipping this piece." : "Hide this piece from stylist suggestions."}</Text>
                  </View>
                  <Switch
                    value={avoided}
                    onValueChange={togglePreference}
                    trackColor={{ true: colors.brandPrimary, false: colors.border }}
                    thumbColor={colors.surface}
                    testID="avoid-switch"
                  />
                </Pressable>
                <Button title="Delete Item" variant="outline" onPress={del} testID="delete-item-btn" />
              </View>
            </>
          )}
        </KeyboardAwareScrollView>
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
  avoidBadge: { position: "absolute", top: spacing.md, left: spacing.md, backgroundColor: c.brandPrimary, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  avoidBadgeText: { fontSize: 9, letterSpacing: 2, fontWeight: "900", color: c.onBrandPrimary },
  nameRow: { flexDirection: "row", alignItems: "center", paddingRight: spacing.lg, gap: spacing.sm },
  name: { fontSize: fontSize["2xl"], fontWeight: "900", letterSpacing: 0.3, color: c.onSurface, padding: spacing.lg },
  editBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, height: 36, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: c.borderStrong },
  editBtnText: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  notes: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, fontSize: fontSize.base, color: c.onSurfaceSecondary, lineHeight: 21 },
  editWrap: { padding: spacing.lg, gap: spacing.lg },
  editActions: { flexDirection: "row", gap: spacing.sm },
  prefRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, backgroundColor: c.surfaceTertiary },
  prefTitle: { fontSize: fontSize.sm, fontWeight: "800", letterSpacing: 1, color: c.onSurface },
  prefSub: { fontSize: fontSize.sm, color: c.muted, marginTop: 2 },
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
