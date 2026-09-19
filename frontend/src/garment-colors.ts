/**
 * Garment color names → swatch hex. These represent real fabric colors, so they are
 * intentionally identical in light and dark themes (not theme tokens).
 */
const SWATCHES: Record<string, string> = {
  black: "#111111",
  white: "#f7f7f7",
  ivory: "#f4efe3",
  cream: "#f1e9d6",
  beige: "#d9c7a7",
  khaki: "#b8a476",
  camel: "#c19a6b",
  tan: "#c9a77c",
  brown: "#6b4a2b",
  chocolate: "#4a2f1b",
  navy: "#1f2a44",
  blue: "#3b5ba5",
  "light blue": "#9fbbe0",
  denim: "#4e6a92",
  indigo: "#2f3a6b",
  grey: "#8d8d8d",
  gray: "#8d8d8d",
  charcoal: "#3a3a3a",
  silver: "#c4c4c4",
  green: "#3f6b4a",
  olive: "#6b6b3a",
  sage: "#9aae8c",
  forest: "#2f4a3a",
  red: "#a83232",
  burgundy: "#6e1f2e",
  maroon: "#5e1a25",
  wine: "#722f3a",
  pink: "#e3a4b5",
  blush: "#e8c2c4",
  purple: "#6c4a8c",
  lavender: "#b7a4d6",
  yellow: "#e2c04a",
  mustard: "#c9a227",
  gold: "#c9a440",
  orange: "#d97a2a",
  rust: "#a4502a",
  coral: "#e0776a",
  teal: "#2f6f73",
  turquoise: "#4cb3b0",
  multi: "#9c9c9c",
  multicolor: "#9c9c9c",
};

export function swatchFor(color: string, fallback: string): string {
  const key = color.trim().toLowerCase();
  if (SWATCHES[key]) return SWATCHES[key];
  // Try the last word (e.g. "Dark Navy" → navy, "Off White" → white).
  const parts = key.split(/[\s/-]+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (SWATCHES[parts[i]]) return SWATCHES[parts[i]];
  }
  return fallback;
}

/** Light swatches need a hairline so they don't vanish on a light surface. */
export function isLightSwatch(hex: string) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 200;
}
