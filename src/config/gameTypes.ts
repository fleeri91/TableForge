// ── Game type accent colors ─────────────────────────────────────────────────
// Maps each game type to a Radix color scale (imported in index.css), so the
// UI can accent a table/template by which pool game it belongs to.

// `enum` isn't allowed here (tsconfig has erasableSyntaxOnly) — this const
// object + type alias is the erasable equivalent, used the same way
// (GameType.V85, and GameType as a type).
export const GameType = {
  V85: 'V85',
  GS75: 'GS75',
  V86: 'V86',
  V64: 'V64',
  V65: 'V65',
  DD: 'dd',
  LD: 'ld',
  V5: 'V5',
  V4: 'V4',
  V3: 'V3',
} as const;

export type GameType = (typeof GameType)[keyof typeof GameType];

const gameTypeColor: Partial<Record<string, string>> = {
  v85: 'blue',
  gs75: 'jade',
  v86: 'purple',
  v64: 'orange',
  v65: 'red',
  dd: 'cyan',
  ld: 'cyan',
  v5: 'cyan',
  v4: 'cyan',
  v3: 'cyan',
};

// Resolves a game type (case-insensitive) to one of its Radix color scale
// steps, e.g. getGameTypeColor('V85') -> "var(--blue-9)". Unknown game types
// fall back to gray rather than being left uncolored.
export function getGameTypeColor(gameType: string, step: number = 9): string {
  const c = gameTypeColor[gameType.toLowerCase()] ?? 'gray';
  return `var(--${c}-${step})`;
}
