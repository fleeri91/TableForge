import { useState, useEffect, useRef } from 'react';
import { Grid3x3, Save, FolderOpen, FileText, RotateCcw, Sun, Moon, Trash2, Check } from 'lucide-react';
import { TableEditor } from './components/TableEditor';
import { TABLE_TEMPLATES, type TableTemplate } from './config/templates';
import { getGameTypeColor } from './config/gameTypes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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

function uid() { return crypto.randomUUID(); }

// A save's own data key holds the last-persisted snapshot; edits made after
// loading it go to this separate working-copy key instead, so typing (or
// Reset) never mutates the snapshot until Save/Update is clicked.
function draftKeyForSave(saveId: string) { return `tableforge:save-draft:${saveId}`; }

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
  const [isDark, setIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [activeTemplate, setActiveTemplate] = useState<TableTemplate | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [activeSlot, setActiveSlot] = useState<ActiveSlot>({ kind: 'draft', templateId: null });
  const [savedTables, setSavedTables] = useState<SavedTable[]>(() => loadRegistry());
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; visible: boolean } | null>(null);
  const feedbackTimers = useRef<{ hide?: number; clear?: number }>({});
  const [started, setStarted] = useState(false);

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

  // Every table belongs to a game type, so the very first thing a session
  // does is pick one — there's no "blank" table anymore.
  if (!started || !activeTemplate) {
    return (
      <StartupScreen
        savedTables={savedTables}
        onChoose={t => {
          setActiveTemplate(t);
          setActiveSlot({ kind: 'draft', templateId: t.id });
          setStarted(true);
        }}
        onOpenSave={loadSave}
      />
    );
  }

  // Aliased so the functions below (hoisted declarations, so TS can't narrow
  // `activeTemplate` inside them) see the non-null type too.
  const template = activeTemplate;

  const activeSave = activeSlot.kind === 'save'
    ? savedTables.find(s => s.id === activeSlot.saveId) ?? null
    : null;
  const draftKey = `tableforge-${template.id}`;
  const storageKey = activeSave ? draftKeyForSave(activeSave.id) : draftKey;

  function flashFeedback(text: string) {
    if (feedbackTimers.current.hide) window.clearTimeout(feedbackTimers.current.hide);
    if (feedbackTimers.current.clear) window.clearTimeout(feedbackTimers.current.clear);
    setFeedback({ text, visible: true });
    feedbackTimers.current.hide = window.setTimeout(() => {
      setFeedback(f => (f ? { ...f, visible: false } : f));
      feedbackTimers.current.clear = window.setTimeout(() => setFeedback(null), 300);
    }, 1800);
  }

  function defaultName() {
    return `${template.label} — ${new Date().toLocaleDateString()}`;
  }

  // Update the already-loaded save in place — no naming step, since there's
  // nothing to choose: it just writes back to the save that's active.
  function updateCurrentSave() {
    if (!activeSave) return;
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        localStorage.setItem(activeSave.dataKey, raw);
        flashFeedback(`"${activeSave.name}" updated`);
      } catch {
        flashFeedback('Update failed — storage full?');
      }
    }
    setSavedTables(prev => prev.map(s =>
      s.id === activeSave.id ? { ...s, savedAt: Date.now() } : s
    ));
  }

  function confirmSave() {
    const name = saveName.trim() || defaultName();
    const raw = localStorage.getItem(storageKey);
    const id = uid();
    const dataKey = `tableforge:save:${id}`;
    if (raw) {
      try {
        localStorage.setItem(dataKey, raw);
        // Seed the working copy too, so continued edits don't touch the
        // snapshot again until the next explicit Update.
        localStorage.setItem(draftKeyForSave(id), raw);
        flashFeedback(`Saved as "${name}"`);
      } catch {
        flashFeedback('Save failed — storage full?');
      }
    }
    const entry: SavedTable = {
      id, name, templateId: template.id, dataKey, savedAt: Date.now(),
    };
    setSavedTables(prev => [entry, ...prev]);
    setActiveSlot({ kind: 'save', saveId: id });
    setSaveOpen(false);
  }

  function loadSave(entry: SavedTable) {
    // Always refresh the working copy from the snapshot, discarding any
    // earlier unsaved edits so Load reliably shows what was last saved.
    const raw = localStorage.getItem(entry.dataKey);
    try {
      if (raw) localStorage.setItem(draftKeyForSave(entry.id), raw);
      else localStorage.removeItem(draftKeyForSave(entry.id));
    } catch { /* storage full or unavailable */ }

    // Falls back to the first template for saves made before "Blank" was
    // removed (they may carry a null templateId).
    const t = TABLE_TEMPLATES.find(t => t.id === entry.templateId) ?? TABLE_TEMPLATES[0];
    setActiveTemplate(t);
    setActiveSlot({ kind: 'save', saveId: entry.id });
    setLoadOpen(false);
    setStarted(true); // also used to jump straight in from the startup screen
    setResetCount(c => c + 1); // force remount even if this save was already active
  }

  function deleteSave(entry: SavedTable, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
    localStorage.removeItem(entry.dataKey);
    localStorage.removeItem(draftKeyForSave(entry.id));
    setSavedTables(prev => prev.filter(s => s.id !== entry.id));
    if (activeSlot.kind === 'save' && activeSlot.saveId === entry.id) {
      const fallback = TABLE_TEMPLATES.find(t => t.id === entry.templateId) ?? template;
      setActiveTemplate(fallback);
      setActiveSlot({ kind: 'draft', templateId: fallback.id });
    }
  }

  // Print just the table (toolbar hidden via print:hidden) using the browser's
  // native "Save as PDF" — no extra dependencies needed. The current light/dark
  // theme carries over as-is, since print-color-adjust keeps background colors.
  function exportPdf() {
    window.print();
  }

  return (
    <div className="min-h-screen bg-muted/40 flex flex-col transition-colors">
      {/* Toolbar */}
      <header className="print:hidden bg-card border-b border-border px-3 sm:px-5 py-2.5 flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-3 shadow-sm">
        <Grid3x3 className="size-5 text-primary" />
        <span className="text-base font-semibold text-foreground tracking-tight">
          TableForge
        </span>

        <Separator orientation="vertical" className="h-5" />

        {/* Template picker */}
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-muted-foreground font-medium">
            Template
          </span>
          <Select
            items={Object.fromEntries(TABLE_TEMPLATES.map(t => [t.id, t.label]))}
            value={template.id}
            onValueChange={v => {
              const t = TABLE_TEMPLATES.find(t => t.id === v);
              if (!t) return;
              setActiveTemplate(t);
              setActiveSlot({ kind: 'draft', templateId: t.id });
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TABLE_TEMPLATES.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator orientation="vertical" className="h-5" />

        {/* Save / Update */}
        <div className="relative">
          {activeSave ? (
            <Button variant="outline" size="sm" onClick={updateCurrentSave} title={`Update "${activeSave.name}"`} aria-label={`Update "${activeSave.name}"`}>
              <Save /> <span className="hidden sm:inline">Update</span>
            </Button>
          ) : (
            <Popover
              open={saveOpen}
              onOpenChange={o => {
                setSaveOpen(o);
                if (o) { setSaveName(defaultName()); setLoadOpen(false); }
              }}
            >
              <PopoverTrigger render={<Button variant="outline" size="sm" title="Save table" aria-label="Save table" />}>
                <Save /> <span className="hidden sm:inline">Save</span>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 max-w-[calc(100vw-1.5rem)]">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Save table as
                </p>
                <Input
                  autoFocus
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') confirmSave();
                    if (e.key === 'Escape') setSaveOpen(false);
                  }}
                  placeholder="Table name"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={confirmSave}>
                    Save
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {feedback && (
            <Badge
              variant="secondary"
              className={[
                'pointer-events-none absolute left-0 top-full mt-1.5 max-w-[80vw] truncate transition-opacity duration-300',
                feedback.visible ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
            >
              <Check /> {feedback.text}
            </Badge>
          )}
        </div>

        {/* Load */}
        <Popover open={loadOpen} onOpenChange={o => { setLoadOpen(o); if (o) setSaveOpen(false); }}>
          <PopoverTrigger render={<Button variant="outline" size="sm" title="Load a saved table" aria-label="Load a saved table" />}>
            <FolderOpen /> <span className="hidden sm:inline">Saved{savedTables.length > 0 ? ` (${savedTables.length})` : ''}</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-w-[calc(100vw-1.5rem)] max-h-80 overflow-y-auto no-scrollbar p-1.5 gap-0">
            {savedTables.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
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
                    'w-full flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left cursor-pointer transition-colors',
                    activeSave?.id === entry.id ? 'bg-accent' : 'hover:bg-accent/60',
                  ].join(' ')}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {entry.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelative(entry.savedAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={e => deleteSave(entry, e)}
                    title="Delete"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            )}
          </PopoverContent>
        </Popover>

        {/* Export */}
        <Button variant="outline" size="sm" onClick={exportPdf} title="Export the table as a PDF" aria-label="Export the table as a PDF">
          <FileText /> <span className="hidden sm:inline">Export PDF</span>
        </Button>

        <Badge variant="outline" className="hidden lg:inline-flex ml-1 text-muted-foreground font-normal">
          Tap ⋯ on a cell for options · Tap a header to rename
        </Badge>

        {/* Reset button */}
        <Button
          variant="destructive"
          size="sm"
          className="ml-auto"
          onClick={() => {
            localStorage.removeItem(storageKey);
            setResetCount(c => c + 1);
          }}
          title="Clear all data and reset table"
          aria-label="Clear all data and reset table"
        >
          <RotateCcw /> <span className="hidden sm:inline">Reset</span>
        </Button>

        <Button variant="ghost" size="icon" onClick={() => setIsDark(d => !d)} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'} aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          {isDark ? <Sun /> : <Moon />}
        </Button>
      </header>

      {/* Canvas */}
      <main className="flex-1 overflow-auto no-scrollbar p-3 sm:p-6 md:p-12 flex items-start justify-center print:p-0 print:overflow-visible print:h-auto">
        <TableEditor
          key={`${storageKey}-${resetCount}`}
          template={template}
          storageKey={storageKey}
          accentColor={getGameTypeColor(template.id)}
          accentSoft={getGameTypeColor(template.id, 3)}
          accentBorder={getGameTypeColor(template.id, 7)}
        />
      </main>
    </div>
  );
}

function StartupScreen({
  savedTables, onChoose, onOpenSave,
}: {
  savedTables: SavedTable[];
  onChoose: (template: TableTemplate) => void;
  onOpenSave: (entry: SavedTable) => void;
}) {
  const recentSaves = [...savedTables].sort((a, b) => b.savedAt - a.savedAt);

  return (
    <div className="min-h-screen bg-muted/40 flex flex-col items-center justify-center gap-8 p-6">
      <div className="flex items-center gap-2">
        <Grid3x3 className="size-7 text-primary" />
        <span className="text-2xl font-semibold text-foreground tracking-tight">
          TableForge
        </span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground">Choose a game to get started</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-md">
          {TABLE_TEMPLATES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChoose(t)}
              className="flex items-center justify-center rounded-xl border border-border border-t-[3px] bg-card px-4 py-5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
              style={{ borderTopColor: getGameTypeColor(t.id) }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {recentSaves.length > 0 && (
        <div className="flex flex-col items-center gap-3 w-full max-w-md">
          <div className="flex items-center gap-3 w-full">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground font-medium">or open a saved table</span>
            <Separator className="flex-1" />
          </div>
          <div className="flex flex-col gap-1.5 w-full max-h-64 overflow-y-auto no-scrollbar rounded-xl border border-border bg-card p-1.5 shadow-sm">
            {recentSaves.map(entry => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onOpenSave(entry)}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: getGameTypeColor(entry.templateId ?? '') }}
                />
                <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">
                  {entry.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelative(entry.savedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
