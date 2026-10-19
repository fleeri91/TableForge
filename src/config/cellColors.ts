// ── Cell color palette config ───────────────────────────────────────────────
// Edit this array to add, remove, or change available colors.
// Lightness and hue match the original palette; only the chroma (the middle
// value) is lowered, so the colors read as less saturated, not darker.

export const CELL_COLORS: { label: string; value: string }[] = [
  { label: "Röd", value: "oklch(70.4% 0.12 22.216)" },
  { label: "Gul", value: "oklch(90.5% 0.116 98.111)" },
  { label: "Blå", value: "oklch(70.7% 0.1 254.624)" },
  { label: "Grön", value: "oklch(79.2% 0.13 151.711)" },
];

// Briefly-used Radix tints, from before the palette went back to oklch.
const LEGACY_VARS: Record<string, number> = {
  "var(--red-5)": 0,
  "var(--yellow-5)": 1,
  "var(--blue-5)": 2,
  "var(--green-5)": 3,
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
      const legacyIdx = LEGACY_VARS[v];
      if (legacyIdx !== undefined) return [k, CELL_COLORS[legacyIdx].value];
      return [k, BY_LIGHTNESS_HUE.get(oklchKey(v)) ?? v];
    }),
  );
}
