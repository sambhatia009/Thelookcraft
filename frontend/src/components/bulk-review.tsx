import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { ArrowClockwise, CheckCircle, WarningCircle, X } from "phosphor-react-native";

import { Item, imageUri } from "@/src/api";
import { ItemEditor } from "@/src/components/item-editor";
import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";

export type BatchEntry = {
  key: string;
  localUri: string;
  status: "pending" | "uploading" | "done" | "error";
  item?: Item;
  error?: string;
  progress?: string;
  prepared?: boolean;
};

/**
 * Review list for a multi-photo upload. Each analysed photo becomes an editable row
 * (name / category / color); failed rows can be retried or dropped.
 */
export function BulkReview({
  entries,
  onEdit,
  onRetry,
  onRemove,
}: {
  entries: BatchEntry[];
  onEdit: (key: string, patch: Partial<Item>) => void;
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const done = entries.filter((e) => e.status === "done").length;
  const failed = entries.filter((e) => e.status === "error").length;
  const active = entries.find((e) => e.status === "uploading");
  const pending = entries.filter((e) => e.status === "pending").length;
  const processing = !!active || pending > 0;
  const progress = entries.length ? (done + failed) / entries.length : 0;

  return (
    <View style={{ gap: spacing.lg }} testID="bulk-review">
      <View style={styles.progressBox}>
        <View style={styles.progressHead}>
          <Text style={styles.progressTitle} testID="bulk-progress-label">
            {processing ? `${done + failed + 1} OF ${entries.length} · ANALYSING…` : `${done} OF ${entries.length} READY${failed ? ` · ${failed} FAILED` : ""}`}
          </Text>
          {processing && <ActivityIndicator color={colors.onSurface} size="small" />}
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <Text style={styles.progressHint}>
          {processing ? "You can start editing finished pieces while the rest are analysed." : "Review the tags below, then save everything to your closet."}
        </Text>
      </View>

      {entries.map((e, idx) => (
        <View key={e.key} style={styles.row} testID={`bulk-row-${idx}`}>
          <View style={styles.rowHead}>
            <View style={styles.thumb}>
              <Image source={{ uri: e.item ? imageUri(e.item) : e.localUri }} style={{ width: "100%", height: "100%" }} contentFit="contain" />
              {e.status === "uploading" && (
                <View style={styles.thumbOverlay}>
                  <ActivityIndicator color={colors.onSurfaceInverse} />
                </View>
              )}
            </View>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <Text style={styles.rowIndex}>PHOTO {idx + 1}</Text>
              {e.status === "done" && (
                <View style={styles.statusRow}>
                  <CheckCircle color={colors.success} size={16} weight="fill" />
                  <Text style={[styles.statusText, { color: colors.success }]} testID={`bulk-ready-${idx}`}>{e.item?.processing_warning ? "READY TO REVIEW" : "TAGGED"}</Text>
                </View>
              )}
              {e.status === "error" && (
                <View style={styles.statusRow}>
                  <WarningCircle color={colors.error} size={16} weight="fill" />
                  <Text style={[styles.statusText, { color: colors.error }]} testID={`bulk-error-${idx}`}>
                    {e.error || "FAILED"}
                  </Text>
                </View>
              )}
              {e.status === "pending" && <Text style={styles.statusText}>WAITING…</Text>}
              {e.status === "uploading" && <Text style={styles.statusText} testID={`bulk-stage-${idx}`}>{e.progress || "UPLOADING PHOTO…"}</Text>}
            </View>
            <View style={styles.rowActions}>
              {e.status === "error" && (
                <Pressable onPress={() => onRetry(e.key)} style={styles.iconBtn} testID={`bulk-retry-${idx}`} hitSlop={6}>
                  <ArrowClockwise color={colors.onSurface} size={18} weight="bold" />
                </Pressable>
              )}
              {e.status !== "uploading" && (
                <Pressable onPress={() => onRemove(e.key)} style={styles.iconBtn} testID={`bulk-remove-${idx}`} hitSlop={6}>
                  <X color={colors.onSurface} size={18} weight="bold" />
                </Pressable>
              )}
            </View>
          </View>

          {e.item && (
            <View style={styles.editor}>
              {!!e.item.processing_warning && <Text style={styles.progressHint} testID={`bulk-warning-${idx}`}>{e.item.processing_warning}</Text>}
              <ItemEditor compact value={e.item} onChange={(patch) => onEdit(e.key, patch)} testIDPrefix={`bulk-${idx}-`} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  progressBox: { borderWidth: 1, borderColor: c.borderStrong, padding: spacing.md, gap: spacing.sm, backgroundColor: c.surfaceTertiary },
  progressHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  progressTitle: { fontSize: fontSize.sm, fontWeight: "900", letterSpacing: 1.5, color: c.onSurface },
  track: { height: 6, backgroundColor: c.border },
  fill: { height: "100%", backgroundColor: c.brandPrimary },
  progressHint: { fontSize: fontSize.sm, color: c.muted, lineHeight: 18 },
  row: { borderWidth: 1, borderColor: c.border },
  rowHead: { flexDirection: "row", gap: spacing.md, padding: spacing.md, alignItems: "flex-start" },
  thumb: { width: 72, height: 88, backgroundColor: c.surfaceTertiary, borderWidth: 1, borderColor: c.border },
  thumbOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  rowIndex: { fontSize: 10, letterSpacing: 2, color: c.muted, fontWeight: "800" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  statusText: { fontSize: 10, letterSpacing: 1, color: c.muted, fontWeight: "700", flexShrink: 1 },
  rowActions: { flexDirection: "row", gap: spacing.xs },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: c.border },
  editor: { padding: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
}));
