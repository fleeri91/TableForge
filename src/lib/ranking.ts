import { BLUE, GREEN, RED, YELLOW } from "../config/cellColors";

// ── Race ranking ────────────────────────────────────────────────────────────
// Scores every horse (row) in each race (column) from what's been marked in
// its cell, and ranks the field by total points. Scratched horses are left
// out; horses with nothing marked are listed last, unranked.

export const POINTS = {
  perEmoji: 2,
  topPick: 3,
  color: { [GREEN]: 3, [BLUE]: 2, [YELLOW]: 1, [RED]: 0 } as Record<
    string,
    number
  >,
};

// The parts of TableEditor's snapshot the ranking reads.
interface RankingSnapshot {
  columns?: {
    id: string;
    name: string;
    distance: string;
    startMethod: string;
  }[];
  rows?: { id: string }[];
  cellColors?: Record<string, string>;
  cellEmojis?: Record<string, string[]>;
  cellDisabled?: Record<string, boolean>;
  // Column id → emoji → row id
  columnTopPicks?: Record<string, Record<string, string>>;
}

export interface RankedHorse {
  // Start number, i.e. the row's position in the table.
  number: number;
  points: number;
  // Shared by horses on equal points (1, 1, 3, …); null when unranked.
  place: number | null;
  emojis: string[];
  topPicks: string[];
  color: string | null;
}

export interface RankedRace {
  id: string;
  name: string;
  distance: string;
  startMethod: string;
  horses: RankedHorse[];
}

export function rankRaces(
  snapshot: Record<string, unknown> | null,
): RankedRace[] {
  const snap = (snapshot ?? {}) as RankingSnapshot;
  const rows = snap.rows ?? [];

  return (snap.columns ?? []).map((col, ci) => {
    const picks = snap.columnTopPicks?.[col.id] ?? {};
    const horses: RankedHorse[] = [];

    rows.forEach((row, ri) => {
      const key = `${row.id}:${col.id}`;
      if (snap.cellDisabled?.[key]) return;
      const emojis = snap.cellEmojis?.[key] ?? [];
      const topPicks = Object.keys(picks).filter((e) => picks[e] === row.id);
      const color = snap.cellColors?.[key] ?? null;
      const points =
        emojis.length * POINTS.perEmoji +
        (topPicks.length > 0 ? POINTS.topPick : 0) +
        (color !== null ? (POINTS.color[color] ?? 0) : 0);
      // "Marked" rather than points > 0, so a horse marked only red still
      // gets a place (at 0 points) above the ones nobody has looked at.
      const marked = emojis.length > 0 || color !== null;
      horses.push({
        number: ri + 1,
        points,
        place: marked ? 0 : null,
        emojis,
        topPicks,
        color,
      });
    });

    horses.sort(
      (a, b) =>
        Number(b.place !== null) - Number(a.place !== null) ||
        b.points - a.points ||
        a.number - b.number,
    );
    horses.forEach((h, i) => {
      if (h.place === null) return;
      const prev = horses[i - 1];
      h.place =
        prev?.place != null && prev.points === h.points ? prev.place : i + 1;
    });

    return {
      id: col.id,
      name: col.name || `Lopp ${ci + 1}`,
      distance: col.distance,
      startMethod: col.startMethod,
      horses,
    };
  });
}
