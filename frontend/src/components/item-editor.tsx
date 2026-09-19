import { Text, TextInput, View } from "react-native";

import { Item } from "@/src/api";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";
import { Chip } from "@/src/ui";

export const CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"];
export const FORMALITY = ["Casual", "Smart Casual", "Formal"];
export const SEASONS = ["All Season", "Spring", "Summer", "Autumn", "Winter"];

export type EditableItem = Pick<Item, "name" | "category" | "subcategory" | "color" | "formality" | "fabric" | "season"> & { notes?: string };

/**
 * Metadata form for a wardrobe piece. `compact` shows only name / category / color
 * (used in the bulk-upload review list); the full form adds fabric, formality, season and notes.
 */
export function ItemEditor({
  value,
  onChange,
  compact = false,
  testIDPrefix = "",
}: {
  value: EditableItem;
  onChange: (patch: Partial<EditableItem>) => void;
  compact?: boolean;
  testIDPrefix?: string;
}) {
  const styles = useStyles();
  const t = (id: string) => `${testIDPrefix}${id}`;

  return (
    <View style={{ gap: compact ? spacing.md : spacing.lg }}>
      <Field label="NAME" value={value.name} onChangeText={(v) => onChange({ name: v })} testID={t("name-field")} />

      <View>
        <Text style={styles.label}>CATEGORY</Text>
        <View style={styles.chipWrap}>
          {CATEGORIES.map((cat) => (
            <Chip key={cat} label={cat} active={value.category === cat} onPress={() => onChange({ category: cat })} testID={t(`cat-${cat}`)} />
          ))}
        </View>
      </View>

      {!compact && <Field label="SUBCATEGORY" value={value.subcategory} onChangeText={(v) => onChange({ subcategory: v })} testID={t("subcat-field")} />}
      <Field label="COLOR" value={value.color} onChangeText={(v) => onChange({ color: v })} testID={t("color-field")} />

      {!compact && (
        <>
          <Field label="FABRIC" value={value.fabric} onChangeText={(v) => onChange({ fabric: v })} testID={t("fabric-field")} />

          <View>
            <Text style={styles.label}>FORMALITY</Text>
            <View style={styles.chipWrap}>
              {FORMALITY.map((f) => (
                <Chip key={f} label={f} active={value.formality === f} onPress={() => onChange({ formality: f })} testID={t(`form-${f}`)} />
              ))}
            </View>
          </View>

          <View>
            <Text style={styles.label}>SEASON</Text>
            <View style={styles.chipWrap}>
              {SEASONS.map((s) => (
                <Chip key={s} label={s} active={value.season === s} onPress={() => onChange({ season: s })} testID={t(`season-${s}`)} />
              ))}
            </View>
          </View>

          <Field
            label="NOTES / DESCRIPTION"
            value={value.notes || ""}
            onChangeText={(v) => onChange({ notes: v })}
            placeholder="Fit, styling ideas, where you bought it…"
            multiline
            testID={t("notes-field")}
          />
        </>
      )}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  testID,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  testID?: string;
  placeholder?: string;
  multiline?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
      />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  label: { fontSize: fontSize.sm, letterSpacing: 2, color: c.muted, marginBottom: spacing.xs },
  input: { height: 48, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, color: c.onSurface, fontSize: fontSize.base },
  inputMultiline: { height: 96, paddingTop: spacing.md, textAlignVertical: "top" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
}));
