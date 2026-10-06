import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

import { fontSize, makeStyles, spacing, useTheme } from "@/src/theme";

function tapHaptic() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  testID,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
  icon?: React.ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const bg =
    variant === "primary" ? colors.brandPrimary : variant === "secondary" ? colors.surfaceTertiary : "transparent";
  const fg =
    variant === "primary" ? colors.onBrandPrimary : colors.onSurface;
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        variant === "outline" && { borderWidth: 1, borderColor: colors.borderStrong },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon}
          <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.brandPrimary : "transparent",
          borderColor: active ? colors.brandPrimary : colors.border,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipRow}
      contentContainerStyle={styles.chipRowContent}
    >
      {children}
    </ScrollView>
  );
}

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function EmptyState({
  title,
  actionLabel,
  onAction,
  testID,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.empty} testID={testID}>
      <Text style={styles.emptyText}>{title}</Text>
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} style={{ marginTop: spacing.xl, minWidth: 200 }} testID="empty-action" />
      ) : null}
    </View>
  );
}

export function Divider() {
  const styles = useStyles();
  return <View style={styles.divider} />;
}

const useStyles = makeStyles((c) => ({
  btn: {
    height: 52,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  btnText: { fontSize: fontSize.base, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  chipText: { fontSize: fontSize.sm, fontWeight: "700", letterSpacing: 1 },
  chipRow: { maxHeight: 56 },
  chipRowContent: { gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center", height: 56 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  headerTitle: {
    fontSize: fontSize["3xl"],
    fontWeight: "800",
    letterSpacing: -0.5,
    color: c.onSurface,
    textTransform: "uppercase",
  },
  headerSub: { fontSize: fontSize.sm, color: c.muted, marginTop: 2, letterSpacing: 1, textTransform: "uppercase" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  emptyText: { fontSize: fontSize.lg, fontWeight: "700", letterSpacing: 2, color: c.muted, textTransform: "uppercase" },
  divider: { height: 1, backgroundColor: c.divider },
}));
