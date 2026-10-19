import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { CELL_COLORS, migrateCellColors } from "../config/cellColors";
import { CELL_EMOJIS } from "../config/cellEmojis";
import type { TableTemplate } from "../config/templates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// ── Types ──────────────────────────────────────────────────────────────────

type Distance = "S" | "M" | "L" | "ST";
type StartMethod = "A" | "V";
type HandicapPosition = "above" | "below";

interface Handicap {
  meters: number;
  position: HandicapPosition;
}

interface Column {
  id: string;
  name: string;
  width: number;
  distance: Distance;
  startMethod: StartMethod;
}

interface Row {
  id: string;
  height: number;
}

// Each emoji can be highlighted as a column's top pick in at most one cell
// of that column: column id → emoji → row id.
type ColumnTopPicks = Record<string, Record<string, string>>;

// Older saves stored a single { rowId, emoji } pick per column.
function loadTopPicks(raw: unknown): ColumnTopPicks {
  if (!raw || typeof raw !== "object") return {};
  const out: ColumnTopPicks = {};
  for (const [cId, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const legacy = v as { rowId?: unknown; emoji?: unknown };
    if (typeof legacy.rowId === "string" && typeof legacy.emoji === "string")
      out[cId] = { [legacy.emoji]: legacy.rowId };
    else out[cId] = v as Record<string, string>;
  }
  return out;
}

// Sets (or, with null, clears) the cell holding `emoji`'s top pick in a
// column, dropping the column entry once it has no picks left.
function withTopPick(
  picks: ColumnTopPicks,
  cId: string,
  emoji: string,
  rId: string | null,
): ColumnTopPicks {
  const col = { ...picks[cId] };
  if (rId === null) delete col[emoji];
  else col[emoji] = rId;
  const next = { ...picks, [cId]: col };
  if (Object.keys(col).length === 0) delete next[cId];
  return next;
}

// The triggering cell's viewport rect — the menu opens beside it and flips
// to the opposite side when it would overflow the viewport.
interface MenuAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface ContextMenuState {
  anchor: MenuAnchor;
  rowId: string;
  colId: string;
}

interface MenuItem {
  label?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  colorPicker?: {
    active: string | null;
    onSelect: (color: string | null) => void;
  };
  emojiPicker?: {
    active: string[];
    onToggle: (emoji: string) => void;
    // The emojis in this cell marked as their column's top pick.
    topPicks: string[];
    onToggleTopPick: (emoji: string) => void;
  };
  handicapPicker?: {
    active: Handicap | null;
    onSet: (meters: number, position: HandicapPosition) => void;
    onClear: () => void;
  };
  // A labeled on/off switch row, styled like the picker sections above it.
  toggle?: {
    label: string;
    checked: boolean;
    onToggle: () => void;
  };
}

const HANDICAP_PRESETS = [20, 40, 60, 80];
const HANDICAP_POSITION_LABELS: Record<HandicapPosition, string> = {
  above: "Över",
  below: "Under",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return crypto.randomUUID();
}

function colLabel(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  return (
    String.fromCharCode(65 + Math.floor(index / 26) - 1) +
    String.fromCharCode(65 + (index % 26))
  );
}

const DISTANCES: readonly Distance[] = ["S", "M", "L", "ST"];
const START_METHODS: readonly StartMethod[] = ["A", "V"];

// Cycles a value through a fixed list; direction -1 goes backward, +1 forward.
function cycleValue<T>(values: readonly T[], current: T, direction: -1 | 1): T {
  const idx = values.indexOf(current);
  return values[(idx + direction + values.length) % values.length];
}

function makeRow(height = 36): Row {
  return { id: uid(), height };
}

function cellKey(rowId: string, colId: string) {
  return `${rowId}:${colId}`;
}

// A floating popup anchored to a specific cell doesn't translate well to
// touch — the cell context menu instead becomes a bottom sheet below this
// breakpoint. Mirrors the dark-mode media-query pattern in App.tsx.
function useIsMobile() {
  const query = "(max-width: 639px)";
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

// Shared reference for "no emojis" so cells without any keep a referentially
// stable prop across renders — letting TableCell's memo actually skip them.
const EMPTY_EMOJIS: string[] = [];

const ROW_NUM_W = 44;
const MAX_ROWS = 15;
const PERSIST_DEBOUNCE_MS = 400;

// ── TableEditor ────────────────────────────────────────────────────────────

function loadSaved(key: string) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as Record<
      string,
      unknown
    > | null;
  } catch {
    return null;
  }
}

export function TableEditor({
  template,
  storageKey,
  accentColor = "var(--gray-9)",
  accentSoft = "var(--gray-3)",
  accentBorder = "var(--gray-7)",
}: {
  template: TableTemplate;
  storageKey: string;
  accentColor?: string;
  accentSoft?: string;
  accentBorder?: string;
}) {
  // Parsed once per mount and reused by every initializer below, instead of
  // re-parsing the same localStorage string once per field.
  const [saved] = useState(() => loadSaved(storageKey));

  const [columns, setColumns] = useState<Column[]>(() => {
    if (
      Array.isArray(saved?.columns) &&
      (saved!.columns as Column[]).length > 0
    ) {
      // Older saves may predate the distance/startMethod fields — default them.
      return (saved!.columns as Column[]).map((c) => ({
        ...c,
        distance: c.distance ?? "M",
        startMethod: c.startMethod ?? "A",
      }));
    }
    return Array.from({ length: template.columns }, (_, i) => ({
      id: uid(),
      name: `${template.columnPrefix}:${i + 1}`,
      width: 140,
      distance: "M" as Distance,
      startMethod: "A" as StartMethod,
    }));
  });
  const [rows, setRows] = useState<Row[]>(() => {
    if (Array.isArray(saved?.rows) && (saved!.rows as Row[]).length > 0)
      return saved!.rows as Row[];
    return Array.from({ length: template.rows }, () => makeRow());
  });
  const [cellColors, setCellColors] = useState<Record<string, string>>(() =>
    migrateCellColors((saved?.cellColors as Record<string, string>) ?? {}),
  );
  const [cellEmojis, setCellEmojis] = useState<Record<string, string[]>>(
    () => (saved?.cellEmojis as Record<string, string[]>) ?? {},
  );
  const [cellDisabled, setCellDisabled] = useState<Record<string, boolean>>(
    () => (saved?.cellDisabled as Record<string, boolean>) ?? {},
  );
  const [cellHandicaps, setCellHandicaps] = useState<Record<string, Handicap>>(
    () => (saved?.cellHandicaps as Record<string, Handicap>) ?? {},
  );
  const [columnTopPicks, setColumnTopPicks] = useState<ColumnTopPicks>(() =>
    loadTopPicks(saved?.columnTopPicks),
  );

  // ── Persist to localStorage ────────────────────────────────────────────────
  // Debounced: typing fires many state updates in
  // quick succession, and writing the whole table to localStorage on every one
  // of them (synchronously) is what actually causes visible jank. Only the
  // settled value after a short quiet period gets written, and any pending
  // write is flushed immediately on unmount so switching templates/saves
  // never drops the last edit.
  const latestSnapshotRef = useRef<Record<string, unknown>>({});
  latestSnapshotRef.current = {
    columns,
    rows,
    cellColors,
    cellEmojis,
    cellDisabled,
    cellHandicaps,
    columnTopPicks,
  };

  const persist = useCallback(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(latestSnapshotRef.current),
      );
    } catch {
      /* storage full or unavailable */
    }
  }, [storageKey]);

  useEffect(() => {
    const timeout = window.setTimeout(persist, PERSIST_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [
    persist,
    columns,
    rows,
    cellColors,
    cellEmojis,
    cellDisabled,
    cellHandicaps,
    columnTopPicks,
  ]);

  useEffect(() => () => persist(), [persist]);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ── Cell accessors ────────────────────────────────────────────────────────

  const getCellColor = (rId: string, cId: string) =>
    cellColors[cellKey(rId, cId)] ?? null;
  const setCellColor = (rId: string, cId: string, color: string | null) =>
    setCellColors((prev) => {
      const next = { ...prev };
      if (color === null) delete next[cellKey(rId, cId)];
      else next[cellKey(rId, cId)] = color;
      return next;
    });

  const getCellEmojis = (rId: string, cId: string) =>
    cellEmojis[cellKey(rId, cId)] ?? EMPTY_EMOJIS;
  const toggleCellEmoji = (rId: string, cId: string, emoji: string) => {
    // Removing an emoji that is the column's top pick also clears the pick.
    if (
      columnTopPicks[cId]?.[emoji] === rId &&
      getCellEmojis(rId, cId).includes(emoji)
    ) {
      setColumnTopPicks((prev) => withTopPick(prev, cId, emoji, null));
    }
    setCellEmojis((prev) => {
      const k = cellKey(rId, cId);
      const current = prev[k] ?? [];
      const next = current.includes(emoji)
        ? current.filter((e) => e !== emoji)
        : [...current, emoji];
      if (next.length === 0) {
        const { [k]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [k]: next };
    });
  };

  // The emojis in this cell that are their column's top pick.
  const getCellTopPicks = (rId: string, cId: string) => {
    const picks = columnTopPicks[cId];
    if (!picks) return EMPTY_EMOJIS;
    const mine = Object.keys(picks).filter((e) => picks[e] === rId);
    return mine.length > 0 ? mine : EMPTY_EMOJIS;
  };
  // Marking an emoji as top pick replaces that emoji's previous pick in the
  // same column; other emojis' picks are unaffected.
  const toggleCellTopPick = (rId: string, cId: string, emoji: string) =>
    setColumnTopPicks((prev) =>
      withTopPick(prev, cId, emoji, prev[cId]?.[emoji] === rId ? null : rId),
    );

  const isCellDisabled = (rId: string, cId: string) =>
    cellDisabled[cellKey(rId, cId)] ?? false;
  const toggleCellDisabled = (rId: string, cId: string) =>
    setCellDisabled((prev) => {
      const k = cellKey(rId, cId);
      if (prev[k]) {
        const { [k]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [k]: true };
    });

  const getCellHandicap = (rId: string, cId: string) =>
    cellHandicaps[cellKey(rId, cId)] ?? null;
  const setCellHandicap = (
    rId: string,
    cId: string,
    meters: number,
    position: HandicapPosition,
  ) =>
    setCellHandicaps((prev) => ({
      ...prev,
      [cellKey(rId, cId)]: { meters, position },
    }));
  const clearCellHandicap = (rId: string, cId: string) =>
    setCellHandicaps((prev) => {
      const k = cellKey(rId, cId);
      if (!(k in prev)) return prev;
      const { [k]: _, ...rest } = prev;
      return rest;
    });

  // ── Column operations ─────────────────────────────────────────────────────
  // Columns are fixed by the template (one per race) — no add, only delete.

  const deleteColumn = (colId: string) => {
    if (columns.length <= 1) return;
    setColumns((prev) => prev.filter((c) => c.id !== colId));
    if (ctxMenu?.colId === colId) setCtxMenu(null);
  };

  const cycleDistance = (colId: string, direction: -1 | 1) =>
    setColumns((prev) =>
      prev.map((c) =>
        c.id === colId
          ? { ...c, distance: cycleValue(DISTANCES, c.distance, direction) }
          : c,
      ),
    );

  const cycleStartMethod = (colId: string, direction: -1 | 1) =>
    setColumns((prev) =>
      prev.map((c) =>
        c.id === colId
          ? {
              ...c,
              startMethod: cycleValue(START_METHODS, c.startMethod, direction),
            }
          : c,
      ),
    );

  // ── Row operations ────────────────────────────────────────────────────────
  // Rows cap at MAX_ROWS (the largest a template ever starts with) — adding
  // is only ever "restoring" capacity freed up by a previous delete.

  const addRow = (afterIdx?: number) => {
    setRows((prev) => {
      if (prev.length >= MAX_ROWS) return prev;
      const idx = afterIdx !== undefined ? afterIdx + 1 : prev.length;
      const row = makeRow();
      const next = [...prev];
      next.splice(idx, 0, row);
      return next;
    });
  };

  const deleteRow = (rowId: string) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    if (ctxMenu?.rowId === rowId) setCtxMenu(null);
  };

  // ── Context menu ──────────────────────────────────────────────────────────

  const openCtxMenu = useCallback(
    (e: React.MouseEvent, rowId: string, colId: string) => {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const { left, right, top, bottom } = rect;
      setCtxMenu({ anchor: { left, right, top, bottom }, rowId, colId });
    },
    [],
  );

  useEffect(() => {
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative min-w-0 max-w-full"
      style={
        {
          "--tf-accent": accentColor,
          "--tf-soft": accentSoft,
          "--tf-border": accentBorder,
        } as React.CSSProperties
      }
    >
      {/* The table scrolls horizontally on itself (rather than relying on
          the page-level scroll container) specifically so the sticky row-
          number column below has a well-defined scroll ancestor to stick
          against — an intervening `overflow-hidden` wrapper with no scroll
          of its own would otherwise block position:sticky from tracking the
          real scroll position. `max-w-full` is what lets `overflow-x-auto`
          ever actually kick in: without it this shrink-to-fit box would
          just keep growing to match its content instead of clipping/
          scrolling it. Each row below also needs `w-max`: as a column-flex
          child with no explicit width it would otherwise stretch to this
          container's post-clamp (scrollport) width rather than its own
          shrink-0 cells' full width, and a sticky child can only stay
          stuck up to (its row's width − its own width) — on a narrow
          screen that cap is reached a couple columns in, so the sticky
          column desyncs from scroll right around there. */}
      <div
        data-scroll-hide
        className="animate-in fade-in zoom-in-[0.98] duration-300 inline-flex flex-col max-w-full overflow-x-auto rounded-xl border border-(--tf-border) border-t-[3px] border-t-(--tf-accent) shadow-lg bg-card print:overflow-visible"
      >
        {/* ── Header Row ── */}
        <div className="flex w-max border-b-2 border-(--tf-border) print:border-b-0">
          {/* Corner cell — sticky so it (and the row numbers below it) stay
              visible while horizontally scrolling a wide table on mobile. */}
          <div
            className="sticky left-0 z-20 shrink-0 bg-(--tf-soft) border-r border-(--tf-border) print:static print:border-r-0"
            style={{ width: ROW_NUM_W, height: 38 }}
          />

          {/* Column headers */}
          {columns.map((col, ci) => (
            <div
              key={col.id}
              className="relative shrink-0 bg-(--tf-soft) border-r border-(--tf-border) print:border-r-0 group"
              style={{ width: col.width, height: 38 }}
            >
              <div className="flex items-center justify-center gap-1 h-full px-2 font-display text-sm font-bold tracking-tight text-muted-foreground select-none">
                <span className="truncate">{col.name || colLabel(ci)}</span>
                <Badge
                  variant="secondary"
                  render={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleDistance(col.id, 1);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        cycleDistance(col.id, -1);
                      }}
                    />
                  }
                  className="rounded-[5px] size-8 sm:size-7 shrink-0 justify-center font-display font-bold bg-(--tf-accent) text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] transition-transform hover:scale-105 active:scale-95 active:shadow-none"
                >
                  {col.distance}
                </Badge>
                <Badge
                  variant="secondary"
                  render={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleStartMethod(col.id, 1);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        cycleStartMethod(col.id, -1);
                      }}
                    />
                  }
                  className="rounded-[5px] size-8 sm:size-7 shrink-0 justify-center font-display font-bold bg-(--tf-accent) text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] transition-transform hover:scale-105 active:scale-95 active:shadow-none"
                >
                  {col.startMethod}
                </Badge>
              </div>
            </div>
          ))}
        </div>

        {/* ── Data rows ── */}
        {rows.map((row, ri) => (
          <div
            key={row.id}
            className="flex w-max border-b border-border/60 print:border-b-0 group/row"
            style={{ height: row.height }}
            onMouseEnter={() => setHoveredRowId(row.id)}
            onMouseLeave={() => setHoveredRowId(null)}
          >
            {/* Row number — sticky so it stays visible while horizontally
                scrolling a wide table on mobile. */}
            <div
              className={[
                "sticky left-0 z-20 shrink-0 flex items-center justify-center border-r border-(--tf-border) print:static print:border-r-0 font-display text-xs font-bold tabular-nums text-muted-foreground select-none cursor-default transition-colors",
                hoveredRowId === row.id
                  ? "bg-(--tf-accent)/15"
                  : "bg-(--tf-soft)",
              ].join(" ")}
              style={{ width: ROW_NUM_W }}
              onContextMenu={(e) =>
                openCtxMenu(e, row.id, columns[0]?.id ?? "")
              }
            >
              {ri + 1}
            </div>

            {/* Cells */}
            {columns.map((col) => (
              <TableCell
                key={col.id}
                rowId={row.id}
                colId={col.id}
                width={col.width}
                height={row.height}
                isActive={
                  ctxMenu?.rowId === row.id && ctxMenu?.colId === col.id
                }
                isDisabled={isCellDisabled(row.id, col.id)}
                isHovered={hoveredRowId === row.id}
                color={getCellColor(row.id, col.id)}
                emojis={getCellEmojis(row.id, col.id)}
                topPicks={getCellTopPicks(row.id, col.id)}
                handicap={getCellHandicap(row.id, col.id)}
                onOpenMenu={openCtxMenu}
              />
            ))}
          </div>
        ))}

        {/* ── Add row ── */}
        {/* Only shown once a row has been deleted, to restore capacity back up to MAX_ROWS. */}
        {rows.length < MAX_ROWS && (
          <div className="flex w-max print:hidden">
            <div
              className="sticky left-0 z-20 shrink-0 bg-(--tf-soft) border-r border-(--tf-border)"
              style={{ width: ROW_NUM_W }}
            />
            <Button
              variant="ghost"
              className="flex-1 justify-start rounded-none text-xs text-muted-foreground hover:text-(--tf-accent)"
              onClick={() => addRow()}
            >
              <Plus className="size-2.5" />
              Lägg till rad
            </Button>
          </div>
        )}
      </div>

      {/* ── Context Menu ── */}
      {ctxMenu && (
        <ContextMenu
          anchor={ctxMenu.anchor}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              colorPicker: {
                active: getCellColor(ctxMenu.rowId, ctxMenu.colId),
                onSelect: (color) =>
                  setCellColor(ctxMenu.rowId, ctxMenu.colId, color),
              },
            },
            {
              emojiPicker: {
                active: getCellEmojis(ctxMenu.rowId, ctxMenu.colId),
                onToggle: (emoji) =>
                  toggleCellEmoji(ctxMenu.rowId, ctxMenu.colId, emoji),
                topPicks: getCellTopPicks(ctxMenu.rowId, ctxMenu.colId),
                onToggleTopPick: (emoji) =>
                  toggleCellTopPick(ctxMenu.rowId, ctxMenu.colId, emoji),
              },
            },
            {
              handicapPicker: {
                active: getCellHandicap(ctxMenu.rowId, ctxMenu.colId),
                onSet: (meters, position) =>
                  setCellHandicap(
                    ctxMenu.rowId,
                    ctxMenu.colId,
                    meters,
                    position,
                  ),
                onClear: () => clearCellHandicap(ctxMenu.rowId, ctxMenu.colId),
              },
            },
            { divider: true },
            {
              toggle: {
                label: "Inaktivera cell",
                checked: isCellDisabled(ctxMenu.rowId, ctxMenu.colId),
                onToggle: () =>
                  toggleCellDisabled(ctxMenu.rowId, ctxMenu.colId),
              },
            },
            { divider: true },
            {
              label: "Infoga rad ovanför",
              onClick: () =>
                addRow(rows.findIndex((r) => r.id === ctxMenu.rowId) - 1),
              disabled: rows.length >= MAX_ROWS,
            },
            {
              label: "Infoga rad nedanför",
              onClick: () =>
                addRow(rows.findIndex((r) => r.id === ctxMenu.rowId)),
              disabled: rows.length >= MAX_ROWS,
            },
            {
              label: "Radera rad",
              onClick: () => deleteRow(ctxMenu.rowId),
              danger: true,
              disabled: rows.length <= 1,
            },
            { divider: true },
            {
              label: "Radera kolumn",
              onClick: () => deleteColumn(ctxMenu.colId),
              danger: true,
              disabled: columns.length <= 1,
            },
          ]}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface TableCellProps {
  rowId: string;
  colId: string;
  width: number;
  height: number;
  isActive: boolean;
  isDisabled: boolean;
  isHovered: boolean;
  color: string | null;
  emojis: string[];
  topPicks: string[];
  handicap: Handicap | null;
  onOpenMenu: (e: React.MouseEvent, rowId: string, colId: string) => void;
}

// Memoized so that a change unrelated to this specific cell doesn't force
// it to re-render — only cells whose
// own props actually changed do. Relies on all callback props and the
// `emojis` array staying referentially stable when this cell's own data
// hasn't changed (see EMPTY_EMOJIS and the functional setState updates
// above).
const TableCell = memo(function TableCell({
  rowId,
  colId,
  width,
  height,
  isActive,
  isDisabled,
  isHovered,
  color,
  emojis,
  topPicks,
  handicap,
  onOpenMenu,
}: TableCellProps) {
  return (
    <div
      className={[
        "relative shrink-0 border-r border-border/60 print:border-r-0 transition-colors cursor-pointer",
        isDisabled
          ? "bg-muted-foreground/40"
          : isActive
            ? "ring-2 ring-inset ring-(--tf-accent) z-10"
            : isHovered
              ? "bg-(--tf-accent)/10"
              : "",
      ].join(" ")}
      style={{
        width,
        height,
        backgroundColor: isDisabled ? undefined : (color ?? undefined),
      }}
      onContextMenu={(e) => onOpenMenu(e, rowId, colId)}
      onClick={(e) => {
        // Stops the click from bubbling to the window-level listener that
        // closes the context menu on any outside click — otherwise the menu
        // this very click just opened would immediately close again.
        e.stopPropagation();
        onOpenMenu(e, rowId, colId);
      }}
    >
      {/* Emoji overlay */}
      {!isDisabled && emojis.length > 0 && (
        <div
          className="absolute inset-0 flex items-center px-2 gap-1 pointer-events-none overflow-hidden"
          data-emoji-halo={color !== null || undefined}
        >
          {emojis.map((e) => (
            <span
              key={e}
              style={{ fontSize: 18 }}
              data-top-pick={topPicks.includes(e) || undefined}
            >
              <span data-emoji-glyph>{e}</span>
            </span>
          ))}
        </div>
      )}

      {/* Handicap badge — straddles the cell's top or bottom edge */}
      {handicap && (
        <div
          className={[
            "absolute inset-x-0 flex justify-center pointer-events-none z-20",
            handicap.position === "above"
              ? "top-0 -translate-y-1/2"
              : "bottom-0 translate-y-1/2",
          ].join(" ")}
        >
          <span className="rounded-full bg-(--tf-accent) text-white font-display text-[9px] font-bold tabular-nums leading-none px-1.5 py-0.5 shadow-sm whitespace-nowrap">
            +{handicap.meters}m
          </span>
        </div>
      )}
    </div>
  );
});

function ContextMenu({
  anchor,
  onClose,
  items,
}: {
  anchor: MenuAnchor;
  onClose: () => void;
  items: MenuItem[];
}) {
  const isMobile = useIsMobile();

  // Anchored beside the triggering element, but on a narrow phone
  // viewport that point is often near the screen edge — and a small popup
  // tacked onto the edge of a cell is awkward to hit with a thumb regardless.
  // Below the `sm` breakpoint the menu renders as a full-width bottom sheet
  // instead (see the `isMobile` branch below), so this positioning — and the
  // anchor entirely — only matters for the desktop popup.
  //
  // A callback ref (runs synchronously right after the node mounts, before
  // paint) measures the menu's actual size and positions it via direct style
  // mutation — no extra render needed. By default it opens to the right of
  // the cell, top-aligned. If that overflows the viewport horizontally it
  // drops below the cell instead (left-aligned with it, or right-aligned if
  // that still overflows), and goes above the cell if there's no room below.
  // Clamping to the edge is the last resort. Re-fires whenever the anchor
  // changes because it's memoized on it, so re-opening at a new spot
  // re-positions.
  const clampToViewport = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || isMobile) return;
      // Reset to the unclamped anchor first so this is idempotent no matter
      // how many times it runs — React (StrictMode, Fast Refresh) can and
      // does replay ref callbacks against an already-mutated node, and
      // measuring from that mutated position instead of the original anchor
      // would compound the offset on every replay.
      const gap = 4;
      const margin = 8;
      el.style.left = `${anchor.right + gap}px`;
      el.style.top = `${anchor.top}px`;
      const { width, height } = el.getBoundingClientRect();
      const maxLeft = window.innerWidth - margin - width;
      const maxTop = window.innerHeight - margin - height;

      const clamp = (v: number, max: number) =>
        Math.min(Math.max(v, margin), Math.max(margin, max));

      let left = anchor.right + gap;
      let top = anchor.top;
      if (left > maxLeft || left < margin) {
        // Beside the cell doesn't fit — place it below (or above) instead.
        left = anchor.left;
        if (left > maxLeft) left = anchor.right - width;
        left = clamp(left, maxLeft);
        top = anchor.bottom + gap;
        if (top > maxTop) {
          const above = anchor.top - gap - height;
          top = above >= margin ? above : clamp(top, maxTop);
        }
      } else if (top > maxTop) {
        const flipped = anchor.bottom - height;
        top = flipped >= margin ? flipped : clamp(top, maxTop);
      }
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    },
    [anchor.left, anchor.right, anchor.top, anchor.bottom, isMobile],
  );

  // Locks background scroll while the mobile sheet is open, like a modal —
  // otherwise a drag on the sheet's own scroll area can also pan the table
  // underneath it.
  useEffect(() => {
    if (!isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isMobile]);

  const content = items.map((item, i) => {
    if (item.colorPicker) {
      const { active, onSelect } = item.colorPicker;
      return (
        <div key={i} className="px-3 pt-2.5 pb-1.5">
          <p className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Cellfärg
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Clear */}
            <button
              className={[
                "w-8 h-8 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 bg-background",
                active === null ? "border-primary scale-110" : "border-border",
              ].join(" ")}
              onClick={() => onSelect(null)}
              title="Ingen färg"
            >
              <X className="size-2.5 text-muted-foreground" />
            </button>
            {CELL_COLORS.map((c) => (
              <button
                key={c.value}
                className={[
                  "w-8 h-8 rounded-full border-2 transition-transform hover:scale-110",
                  active === c.value
                    ? "border-primary scale-110"
                    : "border-transparent hover:border-muted-foreground",
                ].join(" ")}
                style={{ backgroundColor: c.value }}
                onClick={() => onSelect(c.value)}
                title={c.label}
              />
            ))}
          </div>
        </div>
      );
    }

    if (item.emojiPicker) {
      // Each button's ::before pads its hit area by 5px, so the whole row
      // (and a margin around it) is tappable without enlarging the visible
      // buttons. Neighbors' pads overlap in the 6px gap; the later one wins.
      const { active, onToggle, topPicks, onToggleTopPick } = item.emojiPicker;
      return (
        <div key={i} className="px-3 pt-2 pb-2.5">
          <p className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Emojis
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {CELL_EMOJIS.map((e) => (
              <button
                key={e.value}
                className={[
                  "relative p-4 w-6 h-6 rounded-lg text-[24px] leading-none flex items-center justify-center transition-colors before:absolute before:-inset-[5px] before:content-['']",
                  active.includes(e.value)
                    ? "bg-accent ring-1 ring-primary"
                    : "hover:bg-accent",
                ].join(" ")}
                onClick={() => onToggle(e.value)}
                title={e.label}
              >
                {e.value}
              </button>
            ))}
          </div>
          {active.length > 0 && (
            <>
              <p className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2.5 mb-2">
                Kolumnens toppval
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {active.map((emoji) => (
                  <button
                    key={emoji}
                    className={[
                      "relative p-4 w-6 h-6 rounded-lg text-[24px] leading-none flex items-center justify-center transition-colors before:absolute before:-inset-[5px] before:content-['']",
                      topPicks.includes(emoji)
                        ? "bg-accent ring-1 ring-amber-400"
                        : "hover:bg-accent",
                    ].join(" ")}
                    onClick={() => onToggleTopPick(emoji)}
                    title={
                      topPicks.includes(emoji)
                        ? "Ta bort toppval"
                        : "Markera som kolumnens toppval"
                    }
                  >
                    <span data-top-pick={topPicks.includes(emoji) || undefined}>
                      {emoji}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      );
    }

    if (item.handicapPicker) {
      const { active, onSet, onClear } = item.handicapPicker;
      return (
        <div key={i} className="px-3 pt-2.5 pb-1.5">
          <p className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Handicap
          </p>
          {(["above", "below"] as const).map((position) => (
            <div
              key={position}
              className="flex items-center gap-1.5 mb-1.5 last:mb-0"
            >
              <span className="w-11 shrink-0 text-xs text-muted-foreground">
                {HANDICAP_POSITION_LABELS[position]}
              </span>
              {HANDICAP_PRESETS.map((meters) => {
                const isActive =
                  active?.position === position && active.meters === meters;
                return (
                  <button
                    key={meters}
                    className={[
                      "h-8 px-1.5 rounded-md font-display text-sm font-bold tabular-nums",
                      isActive
                        ? "bg-(--tf-accent) text-white"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    ].join(" ")}
                    // Clicking the selected value again clears it.
                    onClick={() =>
                      isActive ? onClear() : onSet(meters, position)
                    }
                  >
                    {meters}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      );
    }

    if (item.toggle) {
      const { label, checked, onToggle } = item.toggle;
      return (
        <button
          key={i}
          type="button"
          role="switch"
          aria-checked={checked}
          className="w-full h-10 sm:h-8 flex items-center justify-between gap-3 px-3 text-left hover:bg-accent"
          onClick={onToggle}
        >
          <span>{label}</span>
          <span
            className={[
              "relative h-4.5 w-8 shrink-0 rounded-full",
              checked ? "bg-(--tf-accent)" : "bg-muted-foreground/30",
            ].join(" ")}
          >
            <span
              className={[
                "absolute top-0.5 size-3.5 rounded-full bg-white shadow-sm",
                checked ? "left-4" : "left-0.5",
              ].join(" ")}
            />
          </span>
        </button>
      );
    }

    if (item.divider) {
      return <Separator key={i} className="my-1.5 mx-2" />;
    }

    return (
      <Button
        key={i}
        variant="ghost"
        disabled={item.disabled}
        className={[
          "w-full h-10 sm:h-8 justify-start rounded-none px-4 font-normal",
          item.danger
            ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
            : "",
        ].join(" ")}
        onClick={() => {
          // Deleting this cell's row/column closes the menu on its own (the
          // parent clears ctxMenu); everything else keeps it open.
          if (!item.disabled) item.onClick?.();
        }}
      >
        {item.label}
      </Button>
    );
  });

  if (isMobile) {
    return (
      <>
        {/* Backdrop — dims the table and doubles as a large tap-to-close
            target, standard for a bottom-sheet-style modal. */}
        <div
          className="fixed inset-0 z-50 bg-black/50 animate-in fade-in duration-150"
          onClick={onClose}
        />
        <div
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-2xl border-t-[3px] border-t-(--tf-accent) bg-popover text-popover-foreground shadow-2xl animate-in slide-in-from-bottom duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-2" aria-hidden>
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
            <span className="font-display text-base font-bold tracking-tight text-foreground">
              Cellalternativ
            </span>
            <button
              onClick={onClose}
              className="-mr-1.5 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Stäng"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="overflow-y-auto pb-[max(env(safe-area-inset-bottom),0.375rem)]">
            {content}
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      ref={clampToViewport}
      className="fixed z-50 bg-popover text-popover-foreground rounded-xl shadow-2xl border border-border border-t-[3px] border-t-(--tf-accent) ring-1 ring-foreground/10 py-1.5 min-w-50 text-sm"
      style={{ left: anchor.right + 4, top: anchor.top }}
      onClick={(e) => e.stopPropagation()}
    >
      {content}
    </div>
  );
}
