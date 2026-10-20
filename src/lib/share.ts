import { CELL_COLORS } from "../config/cellColors";

// ── Share links ─────────────────────────────────────────────────────────────
// A shared table travels entirely inside the URL fragment (`#t=…`), so
// opening one needs no server, session, cookie or localStorage — and the
// fragment is never sent to the server either.
//
// The snapshot TableEditor persists is keyed by random UUIDs, which would
// dominate the link length. The wire format swaps every id for its row or
// column index (cell keys become "row.col"), stores palette colors by
// index, and is then deflated and base64url-encoded. Decoding mints fresh
// ids, so the result is a regular snapshot TableEditor can load as-is.

export const SHARE_PARAM = "t";

interface WireTable {
  v: 1;
  // Template id
  t: string;
  // Columns: [name, width, distance, startMethod]
  c: [string, number, string, string][];
  // Row heights
  r: number[];
  // Cell colors: palette index, or the raw value if it isn't in the palette
  k?: Record<string, number | string>;
  // Cell emojis
  e?: Record<string, string[]>;
  // Disabled cells
  d?: string[];
  // Handicaps: [meters, 0 = above | 1 = below]
  h?: Record<string, [number, 0 | 1]>;
  // Top picks: column index → emoji → row index
  p?: Record<string, Record<string, number>>;
}

export interface SharedTable {
  templateId: string;
  snapshot: Record<string, unknown>;
}

// Prefixes mark the encoding: "z" is deflated, "j" plain JSON for browsers
// without CompressionStream.
const canCompress = typeof CompressionStream !== "undefined";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

type Snapshot = {
  columns?: { id: string; name: string; width: number; distance: string; startMethod: string }[];
  rows?: { id: string; height: number }[];
  cellColors?: Record<string, string>;
  cellEmojis?: Record<string, string[]>;
  cellDisabled?: Record<string, boolean>;
  cellHandicaps?: Record<string, { meters: number; position: "above" | "below" }>;
  columnTopPicks?: Record<string, Record<string, string>>;
};

function toWire(templateId: string, snap: Snapshot): WireTable {
  const columns = snap.columns ?? [];
  const rows = snap.rows ?? [];
  const colIdx = new Map(columns.map((c, i) => [c.id, i]));
  const rowIdx = new Map(rows.map((r, i) => [r.id, i]));

  // Cell keys are "rowId:colId"; entries for deleted rows/columns are dropped.
  const key = (k: string) => {
    const [rId, cId] = k.split(":");
    const ri = rowIdx.get(rId), ci = colIdx.get(cId);
    return ri === undefined || ci === undefined ? null : `${ri}.${ci}`;
  };
  function remap<V, W>(rec: Record<string, V> | undefined, f: (v: V) => W) {
    const out: Record<string, W> = {};
    for (const [k, v] of Object.entries(rec ?? {})) {
      const nk = key(k);
      if (nk) out[nk] = f(v);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  const disabled = Object.entries(snap.cellDisabled ?? {})
    .filter(([, on]) => on)
    .map(([k]) => key(k))
    .filter((k): k is string => k !== null);

  const picks: Record<string, Record<string, number>> = {};
  for (const [cId, byEmoji] of Object.entries(snap.columnTopPicks ?? {})) {
    const ci = colIdx.get(cId);
    if (ci === undefined) continue;
    for (const [emoji, rId] of Object.entries(byEmoji)) {
      const ri = rowIdx.get(rId);
      if (ri !== undefined) (picks[ci] ??= {})[emoji] = ri;
    }
  }

  return {
    v: 1,
    t: templateId,
    c: columns.map((c) => [c.name, c.width, c.distance, c.startMethod]),
    r: rows.map((r) => r.height),
    k: remap(snap.cellColors, (v) => {
      const i = CELL_COLORS.findIndex((c) => c.value === v);
      return i >= 0 ? i : v;
    }),
    e: remap(snap.cellEmojis, (v) => v),
    d: disabled.length > 0 ? disabled : undefined,
    h: remap(snap.cellHandicaps, (v) => [v.meters, v.position === "below" ? 1 : 0]),
    p: Object.keys(picks).length > 0 ? picks : undefined,
  };
}

function fromWire(w: WireTable): SharedTable {
  if (w.v !== 1 || typeof w.t !== "string" || !Array.isArray(w.c) || !Array.isArray(w.r))
    throw new Error("Unsupported share format");

  const columns = w.c.map(([name, width, distance, startMethod]) => ({
    id: crypto.randomUUID(), name, width, distance, startMethod,
  }));
  const rows = w.r.map((height) => ({ id: crypto.randomUUID(), height }));

  const key = (k: string) => {
    const [ri, ci] = k.split(".").map(Number);
    const r = rows[ri], c = columns[ci];
    return r && c ? `${r.id}:${c.id}` : null;
  };
  function remap<V, W>(rec: Record<string, V> | undefined, f: (v: V) => W) {
    const out: Record<string, W> = {};
    for (const [k, v] of Object.entries(rec ?? {})) {
      const nk = key(k);
      if (nk) out[nk] = f(v);
    }
    return out;
  }

  const cellDisabled: Record<string, boolean> = {};
  for (const k of w.d ?? []) {
    const nk = key(k);
    if (nk) cellDisabled[nk] = true;
  }

  const columnTopPicks: Record<string, Record<string, string>> = {};
  for (const [ci, byEmoji] of Object.entries(w.p ?? {})) {
    const c = columns[Number(ci)];
    if (!c) continue;
    for (const [emoji, ri] of Object.entries(byEmoji)) {
      const r = rows[ri];
      if (r) (columnTopPicks[c.id] ??= {})[emoji] = r.id;
    }
  }

  return {
    templateId: w.t,
    snapshot: {
      columns,
      rows,
      cellColors: remap(w.k, (v) =>
        typeof v === "number" ? CELL_COLORS[v]?.value ?? "" : v,
      ),
      cellEmojis: remap(w.e, (v) => v),
      cellDisabled,
      cellHandicaps: remap(w.h, ([meters, pos]) => ({
        meters, position: pos === 1 ? "below" : "above",
      })),
      columnTopPicks,
    },
  };
}

export async function encodeShare(
  templateId: string,
  snapshot: Record<string, unknown>,
): Promise<string> {
  const json = new TextEncoder().encode(
    JSON.stringify(toWire(templateId, snapshot as Snapshot)),
  );
  return canCompress
    ? "z" + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))
    : "j" + toBase64Url(json);
}

export async function decodeShare(token: string): Promise<SharedTable> {
  const body = fromBase64Url(token.slice(1));
  let json: Uint8Array;
  if (token[0] === "z") json = await pipe(body, new DecompressionStream("deflate-raw"));
  else if (token[0] === "j") json = body;
  else throw new Error("Unknown share encoding");
  return fromWire(JSON.parse(new TextDecoder().decode(json)) as WireTable);
}

export function readShareToken(hash = window.location.hash): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get(SHARE_PARAM);
}

export function shareUrl(token: string): string {
  const url = new URL(window.location.href);
  url.hash = `${SHARE_PARAM}=${token}`;
  return url.toString();
}
