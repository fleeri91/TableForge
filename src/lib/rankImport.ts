import { BLUE, GREEN, RED, YELLOW } from "../config/cellColors";

// ── Rank import ─────────────────────────────────────────────────────────────
// Parses start lists copied as HTML from gratistravtips.se into a cell color
// per start number. Each horse's rank cell carries an `ay-rank-a`…`ay-rank-d`
// class, which maps onto the palette below.
//
// The paste is the whole `<div class="tab-content">` (or anything containing
// its `tab-pane`s): one race per pane, so a full card is imported at once.

export const RANK_COLORS: Record<string, string> = {
  a: GREEN,
  b: BLUE,
  c: YELLOW,
  d: RED,
};

export interface ImportedStart {
  startNumber: number;
  rank: string; // "a" | "b" | "c" | "d"
  color: string;
  scratched: boolean;
}

export interface ImportedRace {
  // 1-based race number within the card ("V85-3" → 3).
  raceNumber: number;
  label: string;
  starts: ImportedStart[];
}

function parseStarts(root: ParentNode): ImportedStart[] {
  const byNumber = new Map<number, ImportedStart>();
  for (const tr of root.querySelectorAll("tr")) {
    const rankCell = tr.querySelector("td.ay-td-rank");
    const rank = rankCell
      ? /\bay-rank-([a-d])\b/i.exec(rankCell.className)?.[1]?.toLowerCase()
      : undefined;
    if (!rank) continue;

    const numberText = tr.querySelector("td.ay-td-name strong")?.textContent;
    const startNumber = Number.parseInt(numberText?.trim() ?? "", 10);
    if (!Number.isFinite(startNumber) || startNumber < 1) continue;

    byNumber.set(startNumber, {
      startNumber,
      rank,
      color: RANK_COLORS[rank],
      scratched: tr.querySelector(".ay-horse-scratched") !== null,
    });
  }
  return [...byNumber.values()].sort((a, b) => a.startNumber - b.startNumber);
}

export function parseRankHtml(html: string): ImportedRace[] {
  if (html.trim() === "") return [];

  const doc = new DOMParser().parseFromString(html, "text/html");
  const panes = [...doc.querySelectorAll(".tab-pane, [role=tabpanel]")];

  const races: ImportedRace[] = [];
  panes.forEach((pane, i) => {
    const starts = parseStarts(pane);
    if (starts.length === 0) return;
    // The heading reads e.g. "V85-3"; fall back to the pane's position.
    const label =
      pane.querySelector(".text-size-17")?.textContent?.trim() ?? "";
    const n = Number.parseInt(/(\d+)\s*$/.exec(label)?.[1] ?? "", 10);
    races.push({
      raceNumber: Number.isFinite(n) && n >= 1 ? n : i + 1,
      label: label || `Lopp ${i + 1}`,
      starts,
    });
  });
  return races;
}
