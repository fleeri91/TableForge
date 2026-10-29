import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Plus, Star, TrendingDown, TrendingUp, X } from "lucide-react";
import { CELL_COLORS, migrateCellColors } from "../config/cellColors";
import { CELL_EMOJIS } from "../config/cellEmojis";
import type { TableTemplate } from "../config/templates";
import { Button } from "@/components/ui/button";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Switch } from "@/components/ui/switch";

// ── Types ──────────────────────────────────────────────────────────────────

type Distance = "S" | "M" | "L" | "ST";
type StartMethod = "A" | "V";
type HandicapPosition = "above" | "below";
// Whether a start's form is trending up or down.
type Trend = "up" | "down";

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

interface ContextMenuState {
  // The triggering cell — the desktop menu opens beside it.
  anchor: HTMLElement;
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
  trendPicker?: {
    active: Trend | null;
    onSelect: (trend: Trend | null) => void;
  };
  // A labeled on/off switch row, styled like the picker sections above it.
  toggle?: {
    label: string;
    checked: boolean;
    onToggle: () => void;
    // While checked, every other item in the menu is disabled.
    locksMenu?: boolean;
  };
}

const HANDICAP_PRESETS = [20, 40, 60, 80];
// The color picker's "no color" option, as a ToggleGroup value.
const NO_COLOR = "none";
const TRENDS: { value: Trend; label: string }[] = [
  { value: "up", label: "Uppåt" },
  { value: "down", label: "Nedåt" },
];

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
  initialSnapshot,
  snapshotRef,
  accentColor = "var(--gray-9)",
  accentSoft = "var(--gray-3)",
  accentBorder = "var(--gray-7)",
}: {
  template: TableTemplate;
  storageKey: string;
  // Starting state that takes precedence over localStorage — used to open a
  // shared link, which must work even where storage is unavailable.
  initialSnapshot?: Record<string, unknown> | null;
  // Mirrors the live snapshot out to the parent (e.g. for building a share
  // link) without waiting on the debounced localStorage write.
  snapshotRef?: React.RefObject<Record<string, unknown> | null>;
  accentColor?: string;
  accentSoft?: string;
  accentBorder?: string;
}) {
  // Parsed once per mount and reused by every initializer below, instead of
  // re-parsing the same localStorage string once per field.
  const [saved] = useState(() => initialSnapshot ?? loadSaved(storageKey));

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
  const [cellTrends, setCellTrends] = useState<Record<string, Trend>>(
    () => (saved?.cellTrends as Record<string, Trend>) ?? {},
  );
  // Cells whose start has an elite (star) driver.
  const [cellElite, setCellElite] = useState<Record<string, boolean>>(
    () => (saved?.cellElite as Record<string, boolean>) ?? {},
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
    cellTrends,
    cellElite,
  };
  if (snapshotRef) snapshotRef.current = latestSnapshotRef.current;

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
    cellTrends,
    cellElite,
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

  const getCellTrend = (rId: string, cId: string) =>
    cellTrends[cellKey(rId, cId)] ?? null;
  const setCellTrend = (rId: string, cId: string, trend: Trend | null) =>
    setCellTrends((prev) => {
      const k = cellKey(rId, cId);
      if (trend === null) {
        if (!(k in prev)) return prev;
        const { [k]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [k]: trend };
    });

  const isCellElite = (rId: string, cId: string) =>
    cellElite[cellKey(rId, cId)] ?? false;
  const toggleCellElite = (rId: string, cId: string) =>
    setCellElite((prev) => {
      const k = cellKey(rId, cId);
      if (prev[k]) {
        const { [k]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [k]: true };
    });

  // ── Column operations ─────────────────────────────────────────────────────
  // Columns are fixed by the template (one per race) — no add or delete.

  const setColumnDistance = (colId: string, distance: Distance) =>
    setColumns((prev) =>
      prev.map((c) => (c.id === colId ? { ...c, distance } : c)),
    );

  const setColumnStartMethod = (colId: string, startMethod: StartMethod) =>
    setColumns((prev) =>
      prev.map((c) => (c.id === colId ? { ...c, startMethod } : c)),
    );

  // ── Row operations ────────────────────────────────────────────────────────
  // Rows cap at MAX_ROWS (the largest a template ever starts with) — adding
  // is only ever "restoring" capacity freed up by a previous delete.

  const addRow = () =>
    setRows((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, makeRow()]));

  const deleteRow = (rowId: string) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    if (ctxMenu?.rowId === rowId) setCtxMenu(null);
  };

  // ── Context menu ──────────────────────────────────────────────────────────

  const openCtxMenu = useCallback(
    (e: React.MouseEvent, rowId: string, colId: string) => {
      e.preventDefault();
      setCtxMenu({ anchor: e.currentTarget as HTMLElement, rowId, colId });
    },
    [],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  // The game-color variables. The cell menu renders in a portal outside this
  // tree, so it gets them passed in too.
  const accentVars = {
    "--tf-accent": accentColor,
    "--tf-soft": accentSoft,
    "--tf-border": accentBorder,
  } as React.CSSProperties;

  return (
    <div className="relative min-w-0 max-w-full" style={accentVars}>
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
              <div className="flex items-center justify-between gap-2 h-full px-2 font-display text-sm font-bold tracking-tight text-white select-none">
                <span className="min-w-0 truncate">
                  {col.name || colLabel(ci)}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <HeaderValuePicker
                    label="Distans"
                    value={col.distance}
                    options={DISTANCES}
                    onSelect={(d) => setColumnDistance(col.id, d)}
                  />
                  <HeaderValuePicker
                    label="Startmetod"
                    value={col.startMethod}
                    options={START_METHODS}
                    onSelect={(m) => setColumnStartMethod(col.id, m)}
                  />
                </div>
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
                "sticky left-0 z-20 shrink-0 flex items-center justify-center border-r border-(--tf-border) print:static print:border-r-0 font-display text-xs font-bold tabular-nums text-white select-none cursor-default transition-colors",
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
                trend={getCellTrend(row.id, col.id)}
                isElite={isCellElite(row.id, col.id)}
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
          accentVars={accentVars}
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
            { divider: true },
            {
              toggle: {
                label: "Struken",
                checked: isCellDisabled(ctxMenu.rowId, ctxMenu.colId),
                onToggle: () =>
                  toggleCellDisabled(ctxMenu.rowId, ctxMenu.colId),
                locksMenu: true,
              },
            },
            { divider: true },
            {
              toggle: {
                label: "Stjärnkusk",
                checked: isCellElite(ctxMenu.rowId, ctxMenu.colId),
                onToggle: () => toggleCellElite(ctxMenu.rowId, ctxMenu.colId),
              },
            },
            { divider: true },
            // The handicap badge sits below the cell, so the last row has
            // no room for one.
            ...(rows[rows.length - 1]?.id === ctxMenu.rowId
              ? []
              : [
                  {
                    handicapPicker: {
                      active: getCellHandicap(ctxMenu.rowId, ctxMenu.colId),
                      onSet: (meters: number, position: HandicapPosition) =>
                        setCellHandicap(
                          ctxMenu.rowId,
                          ctxMenu.colId,
                          meters,
                          position,
                        ),
                      onClear: () =>
                        clearCellHandicap(ctxMenu.rowId, ctxMenu.colId),
                    },
                  },
                ]),
            {
              trendPicker: {
                active: getCellTrend(ctxMenu.rowId, ctxMenu.colId),
                onSelect: (trend) =>
                  setCellTrend(ctxMenu.rowId, ctxMenu.colId, trend),
              },
            },
            { divider: true },
            {
              label: "Radera rad",
              onClick: () => deleteRow(ctxMenu.rowId),
              danger: true,
              disabled: rows.length <= 1,
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
  trend: Trend | null;
  isElite: boolean;
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
  trend,
  isElite,
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
      onClick={(e) => onOpenMenu(e, rowId, colId)}
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

      {/* Scratched marker */}
      {isDisabled && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
          <span className="font-display text-xs font-bold tracking-widest text-foreground/80 whitespace-nowrap">
            STRUKEN
          </span>
        </div>
      )}

      {/* Elite driver and form trend — corner flags that take no space
          from the cell's contents. The elite flag folds into the top-left
          corner; the trend flag sits top-right for up, bottom-right for
          down, so its position alone reads as the direction. */}
      {!isDisabled && isElite && (
        <span
          className="absolute top-0 left-0 size-4 bg-amber-400 pointer-events-none [clip-path:polygon(0_0,100%_0,0_100%)]"
          title="Stjärnkusk"
        >
          <Star
            className="absolute top-px left-px size-2 text-white fill-current"
            strokeWidth={0}
          />
        </span>
      )}
      {!isDisabled && trend && (
        <span
          className={[
            "absolute right-0 size-3 pointer-events-none",
            trend === "up"
              ? "top-0 bg-emerald-600 [clip-path:polygon(0_0,100%_0,100%_100%)]"
              : "bottom-0 bg-red-600 [clip-path:polygon(100%_0,100%_100%,0_100%)]",
          ].join(" ")}
          title={trend === "up" ? "Trend uppåt" : "Trend nedåt"}
        />
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

// A column header badge that opens a short list of its possible values,
// with the current one checked.
function HeaderValuePicker<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onSelect: (value: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${label}: ${value}`}
        title={label}
        className={cn(
          badgeVariants({ variant: "secondary" }),
          // Hover darkens the badge and press nudges it down onto its
          // bottom edge; nothing scales, so the letter stays the same size.
          "rounded-[5px] size-8 sm:size-7 shrink-0 justify-center cursor-pointer font-display font-bold bg-(--tf-accent) text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] transition-[filter,box-shadow,translate] duration-150 hover:brightness-90 active:translate-y-px active:shadow-none data-popup-open:brightness-90 data-popup-open:ring-2 data-popup-open:ring-(--tf-accent)/35",
        )}
      >
        {value}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-auto min-w-28">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(v) => onSelect(v as T)}
          >
            {options.map((o) => (
              <DropdownMenuRadioItem
                key={o}
                value={o}
                closeOnClick
                className="font-display font-bold"
              >
                {o}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ContextMenu({
  anchor,
  accentVars,
  onClose,
  items,
}: {
  anchor: HTMLElement;
  accentVars: React.CSSProperties;
  onClose: () => void;
  items: MenuItem[];
}) {
  const isMobile = useIsMobile();

  // On desktop this is a DropdownMenu anchored beside the cell, which flips
  // and shifts itself to stay inside the viewport. On a narrow phone
  // viewport a small popup tacked onto the edge of a cell is awkward to hit
  // with a thumb, so below the `sm` breakpoint it renders as a full-width
  // bottom sheet instead (see the `isMobile` branch below). The sheet isn't
  // a menu, so toggles, actions and dividers render as plain controls there
  // and as DropdownMenu items on desktop; the picker sections are the same
  // in both.

  const locked = items.some(
    (item) => item.toggle?.locksMenu && item.toggle.checked,
  );

  const renderItem = (item: MenuItem, i: number, isLocked: boolean) => {
    // The pickers are ToggleGroups: arrow keys move between options, and each
    // option reports its pressed state. The single-choice ones clear when the
    // selected option is clicked again (the group's value becomes empty).
    if (item.colorPicker) {
      const { active, onSelect } = item.colorPicker;
      return (
        <div key={i} className="px-3 pt-2.5 pb-1.5">
          <p className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Cellfärg
          </p>
          <ToggleGroup
            aria-label="Cellfärg"
            spacing={1.5}
            className="flex-wrap"
            value={[active ?? NO_COLOR]}
            onValueChange={([next]) =>
              onSelect(next === undefined || next === NO_COLOR ? null : next)
            }
          >
            <ToggleGroupItem
              value={NO_COLOR}
              title="Ingen färg"
              aria-label="Ingen färg"
              className="size-8 min-w-0 p-0 rounded-full border-2 border-border bg-background hover:bg-background hover:scale-110 transition-transform aria-pressed:bg-background aria-pressed:border-primary aria-pressed:scale-110"
            >
              <X className="size-2.5 text-muted-foreground" />
            </ToggleGroupItem>
            {CELL_COLORS.map((c) => (
              <ToggleGroupItem
                key={c.value}
                value={c.value}
                title={c.label}
                aria-label={c.label}
                className="size-8 min-w-0 p-0 rounded-full border-2 border-transparent hover:border-muted-foreground hover:scale-110 transition-transform aria-pressed:border-primary aria-pressed:scale-110"
                style={{ backgroundColor: c.value }}
              />
            ))}
          </ToggleGroup>
        </div>
      );
    }

    if (item.emojiPicker) {
      // Each button's ::before pads its hit area by 5px, so the whole row
      // (and a margin around it) is tappable without enlarging the visible
      // buttons. Neighbors' pads overlap in the 6px gap; the later one wins.
      const { active, onToggle, topPicks, onToggleTopPick } = item.emojiPicker;
      const emojiClass =
        "relative p-4 w-6 h-6 min-w-0 rounded-lg text-[24px] leading-none transition-colors before:absolute before:-inset-[5px] before:content-[''] hover:bg-accent aria-pressed:bg-accent aria-pressed:ring-1";
      return (
        <div key={i} className="px-3 pt-2 pb-2.5">
          <p className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Emojis
          </p>
          <ToggleGroup
            aria-label="Emojis"
            multiple
            spacing={1.5}
            className="flex-wrap"
            value={active}
          >
            {CELL_EMOJIS.map((e) => (
              <ToggleGroupItem
                key={e.value}
                value={e.value}
                title={e.label}
                aria-label={e.label}
                className={`${emojiClass} aria-pressed:ring-primary`}
                onPressedChange={() => onToggle(e.value)}
              >
                {e.value}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {active.length > 0 && (
            <>
              <p className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-2.5 mb-2">
                Kolumnens toppval
              </p>
              <ToggleGroup
                aria-label="Kolumnens toppval"
                multiple
                spacing={1.5}
                className="flex-wrap"
                value={topPicks}
              >
                {active.map((emoji) => (
                  <ToggleGroupItem
                    key={emoji}
                    value={emoji}
                    className={`${emojiClass} aria-pressed:ring-amber-400`}
                    onPressedChange={() => onToggleTopPick(emoji)}
                    title={
                      topPicks.includes(emoji)
                        ? "Ta bort toppval"
                        : "Markera som kolumnens toppval"
                    }
                  >
                    <span data-top-pick={topPicks.includes(emoji) || undefined}>
                      {emoji}
                    </span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
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
          {/* New handicaps always go below the cell; older saves may still
              hold "above" ones, which keep rendering where they were. */}
          <ToggleGroup
            aria-label="Handicap"
            spacing={1.5}
            value={active ? [String(active.meters)] : []}
            onValueChange={([next]) =>
              next === undefined ? onClear() : onSet(Number(next), "below")
            }
          >
            {HANDICAP_PRESETS.map((meters) => (
              <ToggleGroupItem
                key={meters}
                value={String(meters)}
                className="h-8 min-w-0 px-1.5 rounded-md font-display text-sm font-bold tabular-nums bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-pressed:bg-(--tf-accent) aria-pressed:text-white aria-pressed:hover:bg-(--tf-accent) aria-pressed:hover:text-white"
              >
                {meters}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      );
    }

    if (item.trendPicker) {
      const { active, onSelect } = item.trendPicker;
      return (
        <div key={i} className="px-3 pt-2.5 pb-1.5">
          <p className="font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Trend
          </p>
          <ToggleGroup
            aria-label="Trend"
            spacing={1.5}
            value={active ? [active] : []}
            onValueChange={([next]) => onSelect((next as Trend) ?? null)}
          >
            {TRENDS.map(({ value, label }) => {
              const Icon = value === "up" ? TrendingUp : TrendingDown;
              return (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className={[
                    "h-8 px-2 gap-1.5 rounded-md font-display text-sm font-bold bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-pressed:text-white aria-pressed:hover:text-white",
                    value === "up"
                      ? "aria-pressed:bg-emerald-600 aria-pressed:hover:bg-emerald-600"
                      : "aria-pressed:bg-red-600 aria-pressed:hover:bg-red-600",
                  ].join(" ")}
                >
                  <Icon className="size-4" strokeWidth={2.5} />
                  {label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>
      );
    }

    if (item.toggle) {
      const { label, checked, onToggle } = item.toggle;
      if (!isMobile) {
        return (
          <DropdownMenuCheckboxItem
            key={i}
            checked={checked}
            onCheckedChange={onToggle}
            disabled={isLocked}
            className="mx-1 h-8 pl-2"
          >
            {label}
          </DropdownMenuCheckboxItem>
        );
      }
      return (
        <label
          key={i}
          className="w-full h-10 flex items-center justify-between gap-3 px-3 cursor-pointer hover:bg-accent"
        >
          <span>{label}</span>
          <Switch
            checked={checked}
            onCheckedChange={onToggle}
            className="data-checked:bg-(--tf-accent)"
          />
        </label>
      );
    }

    if (item.divider) {
      return isMobile ? (
        <Separator key={i} className="my-1.5 mx-2 data-horizontal:w-auto" />
      ) : (
        <DropdownMenuSeparator key={i} className="my-1.5 mx-2" />
      );
    }

    if (!isMobile) {
      return (
        <DropdownMenuItem
          key={i}
          variant={item.danger ? "destructive" : "default"}
          disabled={item.disabled || isLocked}
          // Deleting this cell's row closes the menu on its own (the parent
          // clears ctxMenu); everything else keeps it open.
          closeOnClick={false}
          className="mx-1 h-8 px-2"
          onClick={item.onClick}
        >
          {item.label}
        </DropdownMenuItem>
      );
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
          // Deleting this cell's row closes the menu on its own (the parent
          // clears ctxMenu); everything else keeps it open.
          if (!item.disabled) item.onClick?.();
        }}
      >
        {item.label}
      </Button>
    );
  };

  // Locked items are also wrapped in an inert, dimmed container so the
  // picker sections' plain buttons (and the mobile sheet's controls) can't
  // be clicked or focused either.
  const content = items.map((item, i) => {
    const isLocked = locked && !item.toggle?.locksMenu && !item.divider;
    const el = renderItem(item, i, isLocked);
    return isLocked ? (
      <div key={i} inert className="opacity-50">
        {el}
      </div>
    ) : (
      el
    );
  });

  if (isMobile) {
    // The Drawer brings the backdrop, swipe-down and Escape to close, focus
    // handling and scroll locking. It's capped below the full viewport
    // height so the header (with its close button) and a strip of backdrop
    // always stay on screen; the options scroll inside it instead.
    return (
      <Drawer
        open
        showSwipeHandle
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent
          className="rounded-t-2xl border-t-[3px] border-t-(--tf-accent) shadow-2xl"
          style={accentVars}
        >
          <DrawerHeader className="flex-row items-center justify-between border-b border-border px-4 py-2.5">
            <DrawerTitle className="font-display text-base font-bold tracking-tight">
              Cellalternativ
            </DrawerTitle>
            <DrawerClose
              className="-mr-1.5 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Stäng"
            >
              <X className="size-4" />
            </DrawerClose>
          </DrawerHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),0.375rem)]">
            {content}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    // Non-modal so a click on another cell both closes this menu and opens
    // that cell's, instead of being swallowed by a modal backdrop.
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuContent
        anchor={anchor}
        side="right"
        align="start"
        collisionPadding={8}
        className="w-auto min-w-50 overscroll-contain rounded-xl border border-border border-t-[3px] border-t-(--tf-accent) px-0 py-1.5 shadow-2xl"
        style={accentVars}
      >
        {content}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
