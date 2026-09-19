import { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { X } from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Button, Chip } from "@/src/ui";

export const OCCASIONS = ["Work", "Date", "Travel", "Casual", "Event"];

/**
 * Bottom sheet to tag a look with an occasion.
 * Fixed set of tags + a free-text custom tag. `extraTags` lets callers surface
 * the user's previously used custom tags for one-tap reuse.
 */
export function OccasionSheet({
  open,
  initial,
  extraTags = [],
  title = "TAG THIS LOOK",
  confirmLabel = "Done",
  onClose,
  onConfirm,
}: {
  open: boolean;
  initial?: string;
  extraTags?: string[];
  title?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (occasion: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState(initial || "");
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (open) {
      const isFixed = OCCASIONS.includes(initial || "") || extraTags.includes(initial || "");
      setSelected(isFixed ? initial || "" : "");
      setCustom(isFixed ? "" : initial || "");
    }
  }, [open, initial, extraTags]);

  const tags = [...OCCASIONS, ...extraTags.filter((t) => !OCCASIONS.includes(t))];
  const value = custom.trim() ? custom.trim() : selected;

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="occasion-backdrop" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} testID="occasion-close" hitSlop={8}>
            <X color={colors.onSurface} size={22} weight="bold" />
          </Pressable>
        </View>
        <View style={styles.chips}>
          {tags.map((t) => (
            <Chip
              key={t}
              label={t}
              active={!custom.trim() && selected === t}
              onPress={() => {
                setCustom("");
                setSelected((s) => (s === t ? "" : t));
              }}
              testID={`occasion-${t}`}
            />
          ))}
        </View>
        <Text style={styles.label}>OR CREATE YOUR OWN</Text>
        <TextInput
          testID="occasion-custom-input"
          style={styles.input}
          placeholder="e.g. Wedding, Gym, Brunch"
          placeholderTextColor={colors.muted}
          value={custom}
          onChangeText={setCustom}
          maxLength={24}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => value && onConfirm(value)}
        />
        <View style={styles.actions}>
          <Button title="Skip" variant="outline" onPress={() => onConfirm("")} testID="occasion-skip" style={{ flex: 1 }} />
          <Button title={confirmLabel} onPress={() => onConfirm(value)} disabled={!value} testID="occasion-confirm" style={{ flex: 2 }} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.borderStrong, paddingHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.lg },
  title: { fontSize: fontSize.lg, fontWeight: "900", letterSpacing: 1, color: c.onSurface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  label: { fontSize: fontSize.sm, letterSpacing: 2, color: c.muted, marginTop: spacing.xl, marginBottom: spacing.sm },
  input: { height: 48, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, color: c.onSurface, fontSize: fontSize.base },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
}));
