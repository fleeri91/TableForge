// ── Cell color palette config ───────────────────────────────────────────────
// Edit this array to add, remove, or change available colors.
// Lightness and hue match the original palette; only the chroma (the middle
// value) is lowered, so the colors read as less saturated, not darker.

export const RED = "oklch(70.4% 0.12 22.216)";
export const YELLOW = "oklch(90.5% 0.116 98.111)";
export const BLUE = "oklch(70.7% 0.1 254.624)";
export const GREEN = "oklch(79.2% 0.13 151.711)";

// In the order the color picker shows them.
export const CELL_COLORS: { label: string; value: string }[] = [
  { label: "Grön", value: GREEN },
  { label: "Blå", value: BLUE },
  { label: "Gul", value: YELLOW },
  { label: "Röd", value: RED },
];

// Share links store a color by its index in this list, so its order is
// fixed regardless of how the picker orders CELL_COLORS. Only ever append.
export const SHARE_COLOR_ORDER: readonly string[] = [RED, YELLOW, BLUE, GREEN];

// Briefly-used Radix tints, from before the palette went back to oklch.
const LEGACY_VARS: Record<string, string> = {
  "var(--red-5)": RED,
  "var(--yellow-5)": YELLOW,
  "var(--blue-5)": BLUE,
  "var(--green-5)": GREEN,
};

// Saves store the raw color value, so tweaking a chroma above would leave
// older cells on the previous shade. Any oklch value sharing a palette
// entry's lightness and hue is treated as that entry, whatever its chroma.
function oklchKey(value: string): string | null {
  const m = /^oklch\((\S+) \S+ (\S+)\)$/.exec(value);
  return m ? `${m[1]} ${m[2]}` : null;
}

const BY_LIGHTNESS_HUE = new Map(
  CELL_COLORS.map((c) => [oklchKey(c.value), c.value]),
);

export function migrateCellColors(
  colors: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(colors).map(([k, v]) => {
      const legacy = LEGACY_VARS[v];
      if (legacy !== undefined) return [k, legacy];
      return [k, BY_LIGHTNESS_HUE.get(oklchKey(v)) ?? v];
    }),
  );
}
