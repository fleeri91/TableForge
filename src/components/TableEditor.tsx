import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { CELL_COLORS } from "../config/cellColors";
import { CELL_EMOJIS } from "../config/cellEmojis";
import type { TableTemplate } from "../config/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface ContextMenuState {
  x: number;
  y: number;
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
  };
  handicapPicker?: {
    active: Handicap | null;
    onSet: (meters: number, position: HandicapPosition) => void;
    onClear: () => void;
  };
}

const HANDICAP_PRESETS = [20, 40, 60, 80];

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
    if (Array.isArray(saved?.columns) && (saved!.columns as Column[]).length > 0) {
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
  const [cellColors, setCellColors] = useState<Record<string, string>>(
    () => (saved?.cellColors as Record<string, string>) ?? {},
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
  const [editingHeader, setEditingHeader] = useState<string | null>(null);

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
  const toggleCellEmoji = (rId: string, cId: string, emoji: string) =>
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

  const renameColumn = (colId: string, name: string) =>
    setColumns((prev) =>
      prev.map((c) => (c.id === colId ? { ...c, name } : c)),
    );

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
      setCtxMenu({ x: rect.right + 4, y: rect.top, rowId, colId });
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
        className="inline-flex flex-col max-w-full overflow-x-auto rounded-xl border border-(--tf-border) border-t-[3px] border-t-(--tf-accent) shadow-lg bg-card print:overflow-visible"
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
              {editingHeader === col.id ? (
                <Input
                  className="absolute inset-0 h-full w-full rounded-none border-0 px-2 text-center text-sm font-medium focus-visible:ring-1"
                  value={col.name}
                  onChange={(e) => renameColumn(col.id, e.target.value)}
                  onBlur={() => setEditingHeader(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape")
                      setEditingHeader(null);
                  }}
                  autoFocus
                />
              ) : (
                <div
                  className="flex items-center justify-center gap-1 h-full px-2 text-sm font-semibold text-muted-foreground cursor-default select-none"
                  onClick={() => setEditingHeader(col.id)}
                  title="Tap to rename"
                >
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
                    className="rounded-sm w-7 h-7 shrink-0 justify-center font-bold bg-(--tf-accent) text-white hover:opacity-85"
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
                    className="rounded-sm w-7 h-7 shrink-0 justify-center font-bold bg-(--tf-accent) text-white hover:opacity-85"
                  >
                    {col.startMethod}
                  </Badge>
                </div>
              )}
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
                "sticky left-0 z-20 shrink-0 flex items-center justify-center border-r border-(--tf-border) print:static print:border-r-0 text-xs text-muted-foreground select-none cursor-default transition-colors",
                hoveredRowId === row.id ? "bg-(--tf-accent)/15" : "bg-(--tf-soft)",
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
              Add row
            </Button>
          </div>
        )}
      </div>

      {/* ── Context Menu ── */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
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
              },
            },
            {
              handicapPicker: {
                active: getCellHandicap(ctxMenu.rowId, ctxMenu.colId),
                onSet: (meters, position) =>
                  setCellHandicap(ctxMenu.rowId, ctxMenu.colId, meters, position),
                onClear: () => clearCellHandicap(ctxMenu.rowId, ctxMenu.colId),
              },
            },
            {
              label: isCellDisabled(ctxMenu.rowId, ctxMenu.colId)
                ? "Enable cell"
                : "Disable cell",
              onClick: () => toggleCellDisabled(ctxMenu.rowId, ctxMenu.colId),
            },
            { divider: true },
            {
              label: "Insert row above",
              onClick: () =>
                addRow(rows.findIndex((r) => r.id === ctxMenu.rowId) - 1),
              disabled: rows.length >= MAX_ROWS,
            },
            {
              label: "Insert row below",
              onClick: () =>
                addRow(rows.findIndex((r) => r.id === ctxMenu.rowId)),
              disabled: rows.length >= MAX_ROWS,
            },
            {
              label: "Delete row",
              onClick: () => deleteRow(ctxMenu.rowId),
              danger: true,
              disabled: rows.length <= 1,
            },
            { divider: true },
            {
              label: "Delete column",
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
        <div className="absolute inset-0 flex items-center px-2 gap-1 pointer-events-none overflow-hidden">
          {emojis.map((e) => (
            <span key={e} style={{ fontSize: 18 }}>
              {e}
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
          <span className="rounded-full bg-(--tf-accent) text-white text-[9px] font-bold leading-none px-1.5 py-0.5 shadow-sm whitespace-nowrap">
            +{handicap.meters}m
          </span>
        </div>
      )}
    </div>
  );
});

function ContextMenu({
  x,
  y,
  onClose,
  items,
}: {
  x: number;
  y: number;
  onClose: () => void;
  items: MenuItem[];
}) {
  // Anchored at (x, y) from the triggering element, but on a narrow phone
  // viewport that point is often near the screen edge. A callback ref (runs
  // synchronously right after the node mounts, before paint) measures the
  // menu's actual size and nudges it back on-screen via direct style
  // mutation — no extra render needed. Re-fires whenever (x, y) changes
  // because it's memoized on them, so re-opening at a new spot re-clamps.
  const clampToViewport = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      // Reset to the unclamped anchor first so this is idempotent no matter
      // how many times it runs — React (StrictMode, Fast Refresh) can and
      // does replay ref callbacks against an already-mutated node, and
      // measuring from that mutated position instead of the original anchor
      // would compound the offset on every replay.
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const margin = 8;
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth - margin) {
        el.style.left = `${Math.max(margin, x - (rect.right - window.innerWidth) - margin)}px`;
      }
      if (rect.bottom > window.innerHeight - margin) {
        el.style.top = `${Math.max(margin, y - (rect.bottom - window.innerHeight) - margin)}px`;
      }
    },
    [x, y],
  );

  return (
    <div
      ref={clampToViewport}
      className="fixed z-50 bg-popover text-popover-foreground rounded-xl shadow-2xl border border-border ring-1 ring-foreground/10 py-1.5 min-w-50 text-sm"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.colorPicker) {
          const { active, onSelect } = item.colorPicker;
          return (
            <div key={i} className="px-3 pt-2.5 pb-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Cell color
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Clear */}
                <button
                  className={[
                    "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 bg-background",
                    active === null
                      ? "border-primary scale-110"
                      : "border-border",
                  ].join(" ")}
                  onClick={() => {
                    onSelect(null);
                    onClose();
                  }}
                  title="No color"
                >
                  <X className="size-2.5 text-muted-foreground" />
                </button>
                {CELL_COLORS.map((c) => (
                  <button
                    key={c.value}
                    className={[
                      "w-6 h-6 rounded-full border-2 transition-transform hover:scale-110",
                      active === c.value
                        ? "border-primary scale-110"
                        : "border-transparent hover:border-muted-foreground",
                    ].join(" ")}
                    style={{ backgroundColor: c.value }}
                    onClick={() => {
                      onSelect(c.value);
                      onClose();
                    }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          );
        }

        if (item.emojiPicker) {
          const { active, onToggle } = item.emojiPicker;
          return (
            <div key={i} className="px-3 pt-2 pb-2.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Emojis
              </p>
              <div className="grid grid-cols-5 gap-1">
                {CELL_EMOJIS.map((e) => (
                  <button
                    key={e.value}
                    className={[
                      "w-8 h-8 rounded-lg text-base flex items-center justify-center transition-colors",
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
            </div>
          );
        }

        if (item.handicapPicker) {
          const { active, onSet, onClear } = item.handicapPicker;
          return (
            <div key={i} className="px-3 pt-2.5 pb-1.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Handicap
                </p>
                {active && (
                  <button
                    className="text-[11px] text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      onClear();
                      onClose();
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {(["above", "below"] as const).map((position) => (
                <div key={position} className="flex items-center gap-1.5 mb-1.5 last:mb-0">
                  <span className="w-11 shrink-0 text-xs text-muted-foreground capitalize">
                    {position}
                  </span>
                  {HANDICAP_PRESETS.map((meters) => {
                    const isActive = active?.position === position && active.meters === meters;
                    return (
                      <button
                        key={meters}
                        className={[
                          "h-6 px-1.5 rounded-md text-[11px] font-medium transition-colors",
                          isActive
                            ? "bg-(--tf-accent) text-white"
                            : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                        ].join(" ")}
                        onClick={() => {
                          onSet(meters, position);
                          onClose();
                        }}
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

        if (item.divider) {
          return <Separator key={i} className="my-1.5 mx-2" />;
        }

        return (
          <Button
            key={i}
            variant="ghost"
            disabled={item.disabled}
            className={[
              "w-full justify-start rounded-none px-4 font-normal",
              item.danger
                ? "text-destructive hover:bg-destructive/10 hover:text-destructive"
                : "",
            ].join(" ")}
            onClick={() => {
              if (!item.disabled) {
                item.onClick?.();
                onClose();
              }
            }}
          >
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}
