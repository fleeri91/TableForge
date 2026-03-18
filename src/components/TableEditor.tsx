import { useState, useRef, useEffect, useCallback } from 'react';
import { CELL_COLORS } from '../config/cellColors';
import { CELL_EMOJIS } from '../config/cellEmojis';
import type { TableTemplate } from '../config/templates';

// ── Types ──────────────────────────────────────────────────────────────────

interface Column {
  id: string;
  name: string;
  width: number;
}

interface Row {
  id: string;
  height: number;
}

type Cells = Record<string, string>; // `${rowId}:${colId}` → value

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
}

// ── Helpers ────────────────────────────────────────────────────────────────

let _id = 0;
function uid() { return `i${++_id}`; }

function colLabel(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index);
  return String.fromCharCode(65 + Math.floor(index / 26) - 1) +
    String.fromCharCode(65 + (index % 26));
}

function makeColumn(index: number, width = 140): Column {
  return { id: uid(), name: colLabel(index), width };
}

function makeRow(height = 36): Row {
  return { id: uid(), height };
}

function cellKey(rowId: string, colId: string) {
  return `${rowId}:${colId}`;
}

const ROW_NUM_W = 44;
const MIN_COL_W = 48;
const MIN_ROW_H = 28;

// ── TableEditor ────────────────────────────────────────────────────────────

export function TableEditor({ template }: { template?: TableTemplate | null }) {
  const [columns, setColumns] = useState<Column[]>(() =>
    template
      ? Array.from({ length: template.columns }, (_, i) => ({
          id: uid(),
          name: `${template.columnPrefix}:${i + 1}`,
          width: 140,
        }))
      : Array.from({ length: 4 }, (_, i) => makeColumn(i))
  );
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: template ? template.rows : 6 }, () => makeRow())
  );
  const [cells, setCells] = useState<Cells>({});
  const [cellColors, setCellColors] = useState<Record<string, string>>({});
  const [cellEmojis, setCellEmojis] = useState<Record<string, string[]>>({});
  const [cellDisabled, setCellDisabled] = useState<Record<string, boolean>>({});
  const [activeCell, setActiveCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [editingHeader, setEditingHeader] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const cellRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Cell accessors ────────────────────────────────────────────────────────

  const getCell = (rId: string, cId: string) => cells[cellKey(rId, cId)] ?? '';
  const setCell = (rId: string, cId: string, val: string) =>
    setCells(prev => ({ ...prev, [cellKey(rId, cId)]: val }));

  const getCellColor = (rId: string, cId: string) => cellColors[cellKey(rId, cId)] ?? null;
  const setCellColor = (rId: string, cId: string, color: string | null) =>
    setCellColors(prev => {
      const next = { ...prev };
      if (color === null) delete next[cellKey(rId, cId)];
      else next[cellKey(rId, cId)] = color;
      return next;
    });

  const getCellEmojis = (rId: string, cId: string) => cellEmojis[cellKey(rId, cId)] ?? [];
  const toggleCellEmoji = (rId: string, cId: string, emoji: string) =>
    setCellEmojis(prev => {
      const k = cellKey(rId, cId);
      const current = prev[k] ?? [];
      const next = current.includes(emoji)
        ? current.filter(e => e !== emoji)
        : [...current, emoji];
      if (next.length === 0) {
        const { [k]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [k]: next };
    });

  const isCellDisabled = (rId: string, cId: string) => cellDisabled[cellKey(rId, cId)] ?? false;
  const toggleCellDisabled = (rId: string, cId: string) =>
    setCellDisabled(prev => {
      const k = cellKey(rId, cId);
      if (prev[k]) { const { [k]: _, ...rest } = prev; return rest; }
      return { ...prev, [k]: true };
    });

  // ── Column operations ─────────────────────────────────────────────────────

  const addColumn = (afterIdx?: number) => {
    setColumns(prev => {
      const idx = afterIdx !== undefined ? afterIdx + 1 : prev.length;
      const col = makeColumn(idx);
      const next = [...prev];
      next.splice(idx, 0, col);
      return next;
    });
  };

  const deleteColumn = (colId: string) => {
    if (columns.length <= 1) return;
    setColumns(prev => prev.filter(c => c.id !== colId));
    setCells(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (k.endsWith(`:${colId}`)) delete next[k]; });
      return next;
    });
    if (activeCell?.colId === colId) setActiveCell(null);
  };

  const renameColumn = (colId: string, name: string) =>
    setColumns(prev => prev.map(c => c.id === colId ? { ...c, name } : c));

  const resizeColumn = (colId: string, width: number) =>
    setColumns(prev =>
      prev.map(c => c.id === colId ? { ...c, width: Math.max(MIN_COL_W, width) } : c)
    );

  // ── Row operations ────────────────────────────────────────────────────────

  const addRow = (afterIdx?: number) => {
    setRows(prev => {
      const idx = afterIdx !== undefined ? afterIdx + 1 : prev.length;
      const row = makeRow();
      const next = [...prev];
      next.splice(idx, 0, row);
      return next;
    });
  };

  const deleteRow = (rowId: string) => {
    if (rows.length <= 1) return;
    setRows(prev => prev.filter(r => r.id !== rowId));
    setCells(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (k.startsWith(`${rowId}:`)) delete next[k]; });
      return next;
    });
    if (activeCell?.rowId === rowId) setActiveCell(null);
  };

  const resizeRow = (rowId: string, height: number) =>
    setRows(prev =>
      prev.map(r => r.id === rowId ? { ...r, height: Math.max(MIN_ROW_H, height) } : r)
    );

  // ── Navigation ────────────────────────────────────────────────────────────

  const navigate = useCallback(
    (rowId: string, colId: string, dir: 'up' | 'down' | 'tab' | 'tab-back') => {
      const ri = rows.findIndex(r => r.id === rowId);
      const ci = columns.findIndex(c => c.id === colId);
      let nr = ri, nc = ci;

      if (dir === 'up')        nr = Math.max(0, ri - 1);
      else if (dir === 'down') nr = Math.min(rows.length - 1, ri + 1);
      else if (dir === 'tab') {
        nc = ci + 1;
        if (nc >= columns.length) { nc = 0; nr = Math.min(rows.length - 1, ri + 1); }
      } else {
        nc = ci - 1;
        if (nc < 0) { nc = columns.length - 1; nr = Math.max(0, ri - 1); }
      }

      const newRowId = rows[nr].id;
      const newColId = columns[nc].id;
      setActiveCell({ rowId: newRowId, colId: newColId });
      setTimeout(() => {
        cellRefs.current[cellKey(newRowId, newColId)]?.focus();
      }, 0);
    },
    [rows, columns]
  );

  // ── Drag resize ───────────────────────────────────────────────────────────

  const startColResize = (e: React.MouseEvent, colId: string, startWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => resizeColumn(colId, startWidth + ev.clientX - startX);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const startRowResize = (e: React.MouseEvent, rowId: string, startHeight: number) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const onMove = (ev: MouseEvent) => resizeRow(rowId, startHeight + ev.clientY - startY);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Context menu ──────────────────────────────────────────────────────────

  const openCtxMenu = (e: React.MouseEvent, rowId: string, colId: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, rowId, colId });
  };

  useEffect(() => {
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative">
      <div className="inline-flex flex-col overflow-hidden rounded-xl border border-gray-300 dark:border-gray-600 shadow-lg bg-white dark:bg-gray-900">

        {/* ── Header Row ── */}
        <div className="flex border-b-2 border-gray-200 dark:border-gray-700">
          {/* Corner cell */}
          <div
            className="shrink-0 bg-gray-100 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700"
            style={{ width: ROW_NUM_W, height: 38 }}
          />

          {/* Column headers */}
          {columns.map((col, ci) => (
            <div
              key={col.id}
              className="relative shrink-0 bg-gray-100 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 group"
              style={{ width: col.width, height: 38 }}
            >
              {editingHeader === col.id ? (
                <input
                  className="absolute inset-0 w-full h-full px-2 text-sm font-medium text-center text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 outline-none"
                  value={col.name}
                  onChange={e => renameColumn(col.id, e.target.value)}
                  onBlur={() => setEditingHeader(null)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === 'Escape') setEditingHeader(null);
                  }}
                  autoFocus
                />
              ) : (
                <div
                  className="flex items-center justify-center h-full px-2 text-sm font-semibold text-gray-500 dark:text-gray-400 cursor-default select-none"
                  onDoubleClick={() => setEditingHeader(col.id)}
                  title="Double-click to rename"
                >
                  {col.name || colLabel(ci)}
                </div>
              )}

              {/* Column resize handle */}
              <div
                className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-400 transition-colors z-10"
                onMouseDown={e => startColResize(e, col.id, col.width)}
              />
            </div>
          ))}

          {/* Add column */}
          <button
            className="shrink-0 flex items-center justify-center w-10 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            style={{ height: 38 }}
            onClick={() => addColumn()}
            title="Add column"
          >
            <PlusIcon size={12} />
          </button>
        </div>

        {/* ── Data rows ── */}
        {rows.map((row, ri) => (
          <div
            key={row.id}
            className="flex border-b border-gray-100 dark:border-gray-700/60 group/row"
            style={{ height: row.height }}
          >
            {/* Row number */}
            <div
              className="relative shrink-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 select-none cursor-default hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              style={{ width: ROW_NUM_W }}
              onContextMenu={e => openCtxMenu(e, row.id, columns[0]?.id ?? '')}
            >
              {ri + 1}
              {/* Row resize handle */}
              <div
                className="absolute bottom-0 left-0 right-0 h-1.5 cursor-row-resize hover:bg-blue-400 transition-colors z-10"
                onMouseDown={e => startRowResize(e, row.id, row.height)}
              />
            </div>

            {/* Cells */}
            {columns.map(col => {
              const isActive =
                activeCell?.rowId === row.id && activeCell?.colId === col.id;
              const isDisabled = isCellDisabled(row.id, col.id);
              const emojis = getCellEmojis(row.id, col.id);
              const hasEmojis = emojis.length > 0;
              return (
                <div
                  key={col.id}
                  className={[
                    'relative shrink-0 border-r border-gray-100 dark:border-gray-700/60',
                    isDisabled
                      ? 'bg-gray-400 dark:bg-gray-600'
                      : isActive
                        ? 'ring-2 ring-inset ring-blue-500 z-10'
                        : 'hover:bg-black/3 dark:hover:bg-white/4',
                  ].join(' ')}
                  style={{
                    width: col.width,
                    height: row.height,
                    backgroundColor: isDisabled ? undefined : (getCellColor(row.id, col.id) ?? undefined),
                  }}
                  onContextMenu={e => openCtxMenu(e, row.id, col.id)}
                >
                  {/* Emoji overlay */}
                  {!isDisabled && hasEmojis && (
                    <div className="absolute inset-0 flex items-center px-2 gap-1 pointer-events-none overflow-hidden">
                      {emojis.map(e => (
                        <span key={e} style={{ fontSize: 18 }}>{e}</span>
                      ))}
                    </div>
                  )}

                  <input
                    ref={el => { cellRefs.current[cellKey(row.id, col.id)] = el; }}
                    className="absolute inset-0 w-full h-full px-2 text-sm text-gray-900 dark:text-gray-100 outline-none bg-transparent disabled:cursor-not-allowed"
                    disabled={isDisabled || hasEmojis}
                    value={getCell(row.id, col.id)}
                    onChange={e => setCell(row.id, col.id, e.target.value)}
                    onFocus={() => setActiveCell({ rowId: row.id, colId: col.id })}
                    onKeyDown={e => {
                      switch (e.key) {
                        case 'Tab':
                          e.preventDefault();
                          navigate(row.id, col.id, e.shiftKey ? 'tab-back' : 'tab');
                          break;
                        case 'Enter':
                          e.preventDefault();
                          navigate(row.id, col.id, 'down');
                          break;
                        case 'ArrowUp':
                          e.preventDefault();
                          navigate(row.id, col.id, 'up');
                          break;
                        case 'ArrowDown':
                          e.preventDefault();
                          navigate(row.id, col.id, 'down');
                          break;
                        case 'Escape':
                          setActiveCell(null);
                          (e.target as HTMLInputElement).blur();
                          break;
                      }
                    }}
                  />
                </div>
              );
            })}
          </div>
        ))}

        {/* ── Add row ── */}
        <div className="flex">
          <div
            className="shrink-0 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700"
            style={{ width: ROW_NUM_W }}
          />
          <button
            className="flex-1 flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            onClick={() => addRow()}
          >
            <PlusIcon size={10} />
            Add row
          </button>
        </div>
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
                onSelect: color => setCellColor(ctxMenu.rowId, ctxMenu.colId, color),
              },
            },
            {
              emojiPicker: {
                active: getCellEmojis(ctxMenu.rowId, ctxMenu.colId),
                onToggle: emoji => toggleCellEmoji(ctxMenu.rowId, ctxMenu.colId, emoji),
              },
            },
            {
              label: isCellDisabled(ctxMenu.rowId, ctxMenu.colId) ? 'Enable cell' : 'Disable cell',
              onClick: () => toggleCellDisabled(ctxMenu.rowId, ctxMenu.colId),
            },
            { divider: true },
            {
              label: 'Insert row above',
              onClick: () => addRow(rows.findIndex(r => r.id === ctxMenu.rowId) - 1),
            },
            {
              label: 'Insert row below',
              onClick: () => addRow(rows.findIndex(r => r.id === ctxMenu.rowId)),
            },
            {
              label: 'Delete row',
              onClick: () => deleteRow(ctxMenu.rowId),
              danger: true,
              disabled: rows.length <= 1,
            },
            { divider: true },
            {
              label: 'Insert column left',
              onClick: () =>
                addColumn(columns.findIndex(c => c.id === ctxMenu.colId) - 1),
            },
            {
              label: 'Insert column right',
              onClick: () =>
                addColumn(columns.findIndex(c => c.id === ctxMenu.colId)),
            },
            {
              label: 'Delete column',
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

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="1" x2="6" y2="11" />
      <line x1="1" y1="6" x2="11" y2="6" />
    </svg>
  );
}

function ContextMenu({
  x, y, onClose, items,
}: {
  x: number;
  y: number;
  onClose: () => void;
  items: MenuItem[];
}) {
  return (
    <div
      className="fixed z-50 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 py-1.5 min-w-50 text-sm"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.colorPicker) {
          const { active, onSelect } = item.colorPicker;
          return (
            <div key={i} className="px-3 pt-2.5 pb-1.5">
              <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                Cell color
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Clear */}
                <button
                  className={[
                    'w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110',
                    active === null
                      ? 'border-blue-500 scale-110'
                      : 'border-gray-200 dark:border-gray-600',
                  ].join(' ')}
                  style={{ background: 'white' }}
                  onClick={() => { onSelect(null); onClose(); }}
                  title="No color"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" stroke="#d1d5db" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="9" y2="9" />
                    <line x1="9" y1="1" x2="1" y2="9" />
                  </svg>
                </button>
                {CELL_COLORS.map(c => (
                  <button
                    key={c.value}
                    className={[
                      'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                      active === c.value
                        ? 'border-blue-500 scale-110'
                        : 'border-transparent hover:border-gray-300 dark:hover:border-gray-500',
                    ].join(' ')}
                    style={{ backgroundColor: c.value }}
                    onClick={() => { onSelect(c.value); onClose(); }}
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
              <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                Emojis
              </p>
              <div className="grid grid-cols-5 gap-1">
                {CELL_EMOJIS.map(e => (
                  <button
                    key={e.value}
                    className={[
                      'w-8 h-8 rounded-lg text-base flex items-center justify-center transition-colors',
                      active.includes(e.value)
                        ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400 dark:ring-blue-500'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700',
                    ].join(' ')}
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

        if (item.divider) {
          return <div key={i} className="h-px bg-gray-100 dark:bg-gray-700 my-1.5 mx-2" />;
        }

        return (
          <button
            key={i}
            disabled={item.disabled}
            className={[
              'w-full text-left px-4 py-1.5 transition-colors',
              item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
              item.danger
                ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
                : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700',
            ].join(' ')}
            onClick={() => {
              if (!item.disabled) {
                item.onClick?.();
                onClose();
              }
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
