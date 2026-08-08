import { useState, useEffect } from 'react';
import { TableEditor } from './components/TableEditor';
import { TABLE_TEMPLATES, type TableTemplate } from './config/templates';

// ── Saved tables registry ────────────────────────────────────────────────────
// Named snapshots live under their own localStorage key; a lightweight
// registry (name, template, timestamp, key) is kept alongside so the UI can
// list and manage them without loading every snapshot's data.

interface SavedTable {
  id: string;
  name: string;
  templateId: string | null;
  dataKey: string;
  savedAt: number;
}

type ActiveSlot =
  | { kind: 'draft'; templateId: string | null }
  | { kind: 'save'; saveId: string };

const REGISTRY_KEY = 'tableforge:registry';

function uid() { return Math.random().toString(36).slice(2, 9); }

function loadRegistry(): SavedTable[] {
  try {
    const raw = JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000, hr = 3_600_000, day = 86_400_000;
  if (diff < min) return 'just now';
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < day * 7) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function App() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const [isDark, setIsDark] = useState(mq.matches);
  const [activeTemplate, setActiveTemplate] = useState<TableTemplate | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [activeSlot, setActiveSlot] = useState<ActiveSlot>({ kind: 'draft', templateId: null });
  const [savedTables, setSavedTables] = useState<SavedTable[]>(() => loadRegistry());
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const activeSave = activeSlot.kind === 'save'
    ? savedTables.find(s => s.id === activeSlot.saveId) ?? null
    : null;
  const draftKey = `tableforge-${activeTemplate?.id ?? 'blank'}`;
  const storageKey = activeSave ? activeSave.dataKey : draftKey;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(savedTables)); }
    catch { /* storage full or unavailable */ }
  }, [savedTables]);

  // ── Close popovers on outside click / Escape ──────────────────────────────
  useEffect(() => {
    if (!saveOpen && !loadOpen) return;
    const close = () => { setSaveOpen(false); setLoadOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [saveOpen, loadOpen]);

  function defaultName() {
    const label = activeTemplate?.label ?? 'Blank';
    return `${label} — ${new Date().toLocaleDateString()}`;
  }

  function openSaveDialog() {
    setSaveName(activeSave?.name ?? defaultName());
    setSaveOpen(true);
    setLoadOpen(false);
  }

  function confirmSave() {
    const name = saveName.trim() || defaultName();
    if (activeSave) {
      setSavedTables(prev => prev.map(s =>
        s.id === activeSave.id ? { ...s, name, savedAt: Date.now() } : s
      ));
    } else {
      const raw = localStorage.getItem(storageKey);
      const id = uid();
      const dataKey = `tableforge:save:${id}`;
      if (raw) {
        try { localStorage.setItem(dataKey, raw); } catch { /* storage full or unavailable */ }
      }
      const entry: SavedTable = {
        id, name, templateId: activeTemplate?.id ?? null, dataKey, savedAt: Date.now(),
      };
      setSavedTables(prev => [entry, ...prev]);
      setActiveSlot({ kind: 'save', saveId: id });
    }
    setSaveOpen(false);
  }

  function loadSave(entry: SavedTable) {
    const t = TABLE_TEMPLATES.find(t => t.id === entry.templateId) ?? null;
    setActiveTemplate(t);
    setActiveSlot({ kind: 'save', saveId: entry.id });
    setLoadOpen(false);
  }

  function deleteSave(entry: SavedTable, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
    localStorage.removeItem(entry.dataKey);
    setSavedTables(prev => prev.filter(s => s.id !== entry.id));
    if (activeSlot.kind === 'save' && activeSlot.saveId === entry.id) {
      setActiveTemplate(null);
      setActiveSlot({ kind: 'draft', templateId: null });
    }
  }

  return (
    <div className="min-h-screen bg-[#eeeef0] dark:bg-gray-950 flex flex-col transition-colors">
      {/* Toolbar */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-5 py-2.5 flex items-center gap-3 shadow-sm">
        <GridIcon />
        <span className="text-base font-semibold text-gray-800 dark:text-gray-100 tracking-tight">
          TableForge
        </span>

        {/* Divider */}
        <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />

        {/* Template picker */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">
            Template
          </span>
          <select
            value={activeTemplate?.id ?? ''}
            onChange={e => {
              const t = TABLE_TEMPLATES.find(t => t.id === e.target.value) ?? null;
              setActiveTemplate(t);
              setActiveSlot({ kind: 'draft', templateId: t?.id ?? null });
            }}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="">Blank</option>
            {TABLE_TEMPLATES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />

        {/* Save */}
        <div className="relative">
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            onClick={e => { e.stopPropagation(); openSaveDialog(); }}
            title="Save table"
          >
            <SaveIcon /> {activeSave ? 'Update' : 'Save'}
          </button>

          {saveOpen && (
            <div
              className="absolute left-0 top-full mt-2 z-50 w-64 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-3"
              onClick={e => e.stopPropagation()}
            >
              <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                {activeSave ? 'Update saved table' : 'Save table as'}
              </p>
              <input
                autoFocus
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmSave();
                  if (e.key === 'Escape') setSaveOpen(false);
                }}
                className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                placeholder="Table name"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setSaveOpen(false)}
                  className="text-xs px-2.5 py-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmSave}
                  className="text-xs px-3 py-1 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Load */}
        <div className="relative">
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            onClick={e => { e.stopPropagation(); setLoadOpen(o => !o); setSaveOpen(false); }}
            title="Load a saved table"
          >
            <FolderIcon /> Saved{savedTables.length > 0 ? ` (${savedTables.length})` : ''}
          </button>

          {loadOpen && (
            <div
              className="absolute left-0 top-full mt-2 z-50 w-72 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 py-1.5"
              onClick={e => e.stopPropagation()}
            >
              {savedTables.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-400 dark:text-gray-500">
                  No saved tables yet. Use Save to create one.
                </p>
              ) : (
                [...savedTables].sort((a, b) => b.savedAt - a.savedAt).map(entry => (
                  <div
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadSave(entry)}
                    onKeyDown={e => { if (e.key === 'Enter') loadSave(entry); }}
                    className={[
                      'w-full flex items-center justify-between gap-2 px-3 py-2 text-left cursor-pointer transition-colors',
                      activeSave?.id === entry.id
                        ? 'bg-blue-50 dark:bg-blue-950/40'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700',
                    ].join(' ')}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                        {entry.name}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {formatRelative(entry.savedAt)}
                      </p>
                    </div>
                    <button
                      onClick={e => deleteSave(entry, e)}
                      className="shrink-0 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 dark:text-gray-600 dark:hover:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                      title="Delete"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1 border border-gray-200 dark:border-gray-700 rounded px-1.5 py-0.5">
          Right-click cells for options · Double-click headers to rename
        </span>

        {/* Reset button */}
        <button
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          onClick={() => {
            localStorage.removeItem(storageKey);
            setResetCount(c => c + 1);
          }}
          title="Clear all data and reset table"
        >
          <ResetIcon /> Reset
        </button>

        <button
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
          onClick={() => setIsDark(d => !d)}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      {/* Canvas */}
      <main className="flex-1 overflow-auto p-12 flex items-start justify-center">
        <TableEditor
          key={`${storageKey}-${resetCount}`}
          template={activeTemplate}
          storageKey={storageKey}
        />
      </main>
    </div>
  );
}

function GridIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3b82f6"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}
