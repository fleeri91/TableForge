import { BLUE, GREEN, RED, YELLOW } from "../config/cellColors";

// ── Rank import ─────────────────────────────────────────────────────────────
// Parses a race's start list copied as HTML from gratistravtips.se (the
// <tbody> of its ranking table, or anything containing it) into a cell color
// per start number. Each horse's rank cell carries an `ay-rank-a`…`ay-rank-d`
// class, which maps onto the palette below.

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

export function parseRankHtml(html: string): ImportedStart[] {
  // The HTML parser drops <tbody>/<tr> found outside a <table>, so a pasted
  // bare <tbody> needs wrapping to survive.
  const source = /<table[\s>]/i.test(html) ? html : `<table>${html}</table>`;
  const doc = new DOMParser().parseFromString(source, "text/html");

  const byNumber = new Map<number, ImportedStart>();
  for (const tr of doc.querySelectorAll("tr")) {
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
