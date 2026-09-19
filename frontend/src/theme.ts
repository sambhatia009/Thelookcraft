// Design tokens for StyleVault — Brutalist / editorial fashion (SSENSE / Farfetch).
// Strict monochrome, 0px radius, 1pt hairline borders, no shadows.
// Light + Dark both shipped; device setting decides.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#ffffff",
  onSurface: "#000000",
  surfaceSecondary: "#ffffff",
  onSurfaceSecondary: "#000000",
  surfaceTertiary: "#f2f2f2",
  onSurfaceTertiary: "#000000",
  surfaceInverse: "#000000",
  onSurfaceInverse: "#ffffff",
  muted: "#737373",

  brand: "#000000",
  onBrand: "#ffffff",
  brandPrimary: "#000000",
  onBrandPrimary: "#ffffff",
  brandSecondary: "#333333",
  onBrandSecondary: "#ffffff",
  brandTertiary: "#e5e5e5",
  onBrandTertiary: "#000000",

  success: "#2e4a36",
  onSuccess: "#ffffff",
  warning: "#5c4d29",
  onWarning: "#ffffff",
  error: "#662424",
  onError: "#ffffff",
  info: "#000000",
  onInfo: "#ffffff",

  border: "#e5e5e5",
  borderStrong: "#000000",
  divider: "#e5e5e5",
};

const dark: typeof light = {
  surface: "#000000",
  onSurface: "#ffffff",
  surfaceSecondary: "#000000",
  onSurfaceSecondary: "#ffffff",
  surfaceTertiary: "#1a1a1a",
  onSurfaceTertiary: "#ffffff",
  surfaceInverse: "#ffffff",
  onSurfaceInverse: "#000000",
  muted: "#888888",

  brand: "#ffffff",
  onBrand: "#000000",
  brandPrimary: "#ffffff",
  onBrandPrimary: "#000000",
  brandSecondary: "#cccccc",
  onBrandSecondary: "#000000",
  brandTertiary: "#333333",
  onBrandTertiary: "#ffffff",

  success: "#35523d",
  onSuccess: "#ffffff",
  warning: "#7a6637",
  onWarning: "#000000",
  error: "#8a3131",
  onError: "#ffffff",
  info: "#ffffff",
  onInfo: "#000000",

  border: "#2a2a2a",
  borderStrong: "#ffffff",
  divider: "#2a2a2a",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 } as const;
export const fontSize = { sm: 12, base: 14, lg: 16, xl: 20, "2xl": 24, "3xl": 32 } as const;
export const radius = { sm: 0, md: 0, lg: 0, pill: 0 } as const;

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
