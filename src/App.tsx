import { useState, useEffect, useRef } from 'react';
import { Save, FolderOpen, FileText, RotateCcw, Sun, Moon, Trash2, Link } from 'lucide-react';
import { toast } from 'sonner';
import { TableEditor } from './components/TableEditor';
import { TABLE_TEMPLATES, type TableTemplate } from './config/templates';
import { getGameTypeColor } from './config/gameTypes';
import { decodeShare, encodeShare, readShareToken, shareUrl } from './lib/share';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Toaster } from '@/components/ui/sonner';

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
  | { kind: 'save'; saveId: string }
  | { kind: 'shared' };

const REGISTRY_KEY = 'tableforge:registry';
// Working copy for a table opened from a share link. The link itself stays
// the source of truth (TableEditor is seeded from it, not from this key), so
// this only matters for Save — which copies it into a regular save.
const SHARED_KEY = 'tableforge:shared';

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
  if (diff < min) return 'nyss';
  if (diff < hr) return `${Math.floor(diff / min)} min sedan`;
  if (diff < day) return `${Math.floor(diff / hr)} tim sedan`;
  if (diff < day * 7) return `${Math.floor(diff / day)} d sedan`;
  return new Date(ts).toLocaleDateString('sv-SE');
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
  // Destructive actions wait for confirmation in an AlertDialog.
  const [resetOpen, setResetOpen] = useState(false);
  // Kept after the dialog closes so its text doesn't blank mid-animation.
  const [pendingDelete, setPendingDelete] = useState<SavedTable | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [sharedSnapshot, setSharedSnapshot] = useState<Record<string, unknown> | null>(null);
  const [sharePending, setSharePending] = useState(() => readShareToken() !== null);
  const [shareError, setShareError] = useState(false);
  const snapshotRef = useRef<Record<string, unknown> | null>(null);

  // Open a shared table from the URL fragment — on first load, and again if
  // another share link is pasted into the same tab (only the hash changes,
  // so the page doesn't reload).
  useEffect(() => {
    let cancelled = false;
    function openFromHash() {
      const token = readShareToken();
      if (!token) return;
      setSharePending(true);
      decodeShare(token)
        .then(({ templateId, snapshot }) => {
          if (cancelled) return;
          const t = TABLE_TEMPLATES.find(t => t.id === templateId) ?? TABLE_TEMPLATES[0];
          setActiveTemplate(t);
          setActiveSlot({ kind: 'shared' });
          setSharedSnapshot(snapshot);
          setShareError(false);
          setStarted(true);
          setResetCount(c => c + 1); // remount even if a shared table is already open
        })
        .catch(() => { if (!cancelled) setShareError(true); })
        .finally(() => { if (!cancelled) setSharePending(false); });
    }
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => {
      cancelled = true;
      window.removeEventListener('hashchange', openFromHash);
    };
  }, []);

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

  // Deleting a save works from both the startup screen and the toolbar, so
  // it (and its confirmation dialog) can't depend on a table being open.
  function deleteSave(entry: SavedTable) {
    localStorage.removeItem(entry.dataKey);
    localStorage.removeItem(draftKeyForSave(entry.id));
    setSavedTables(prev => prev.filter(s => s.id !== entry.id));
    if (activeSlot.kind === 'save' && activeSlot.saveId === entry.id) {
      const fallback = TABLE_TEMPLATES.find(t => t.id === entry.templateId)
        ?? activeTemplate ?? TABLE_TEMPLATES[0];
      setActiveTemplate(fallback);
      setActiveSlot({ kind: 'draft', templateId: fallback.id });
    }
    toast.success(`"${entry.name}" raderad`);
  }

  function askDeleteSave(entry: SavedTable) {
    setPendingDelete(entry);
    setDeleteOpen(true);
  }

  const overlays = (
    <>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Radera "{pendingDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Den sparade tabellen tas bort. Det går inte att ångra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) deleteSave(pendingDelete);
                setDeleteOpen(false);
              }}
            >
              Radera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster theme={isDark ? 'dark' : 'light'} position="bottom-center" />
    </>
  );

  // Avoids flashing the startup screen while a share link decodes.
  if (sharePending) return null;

  // Every table belongs to a game type, so the very first thing a session
  // does is pick one — there's no "blank" table anymore.
  if (!started || !activeTemplate) {
    return (
      <>
        <StartupScreen
          savedTables={savedTables}
          shareError={shareError}
          onChoose={t => {
            clearShareHash();
            setActiveTemplate(t);
            setActiveSlot({ kind: 'draft', templateId: t.id });
            setStarted(true);
          }}
          onOpenSave={loadSave}
          onDeleteSave={askDeleteSave}
        />
        {overlays}
      </>
    );
  }

  // Aliased so the functions below (hoisted declarations, so TS can't narrow
  // `activeTemplate` inside them) see the non-null type too.
  const template = activeTemplate;

  const activeSave = activeSlot.kind === 'save'
    ? savedTables.find(s => s.id === activeSlot.saveId) ?? null
    : null;
  const draftKey = `tableforge-${template.id}`;
  const storageKey = activeSave
    ? draftKeyForSave(activeSave.id)
    : activeSlot.kind === 'shared' ? SHARED_KEY : draftKey;

  // Leaving a shared table drops its link from the address bar, so a reload
  // doesn't pull it back up over whatever was opened instead.
  function clearShareHash() {
    if (readShareToken() !== null)
      history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  async function shareTable() {
    if (!snapshotRef.current) return;
    try {
      const url = shareUrl(await encodeShare(template.id, snapshotRef.current));
      // Touch devices get the native share sheet; elsewhere, the clipboard.
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        try { await navigator.share({ title: template.label, url }); }
        catch (e) { if ((e as DOMException).name !== 'AbortError') throw e; }
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Länken kopierad');
    } catch {
      toast.error('Det gick inte att skapa en delningslänk');
    }
  }

  function defaultName() {
    return `${template.label} — ${new Date().toLocaleDateString('sv-SE')}`;
  }

  // Update the already-loaded save in place — no naming step, since there's
  // nothing to choose: it just writes back to the save that's active.
  function updateCurrentSave() {
    if (!activeSave) return;
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        localStorage.setItem(activeSave.dataKey, raw);
        toast.success(`"${activeSave.name}" uppdaterad`);
      } catch {
        toast.error('Uppdateringen misslyckades — är lagringen full?');
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
        toast.success(`Sparad som "${name}"`);
      } catch {
        toast.error('Det gick inte att spara — är lagringen full?');
      }
    }
    const entry: SavedTable = {
      id, name, templateId: template.id, dataKey, savedAt: Date.now(),
    };
    setSavedTables(prev => [entry, ...prev]);
    clearShareHash();
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
    clearShareHash();
    setActiveTemplate(t);
    setActiveSlot({ kind: 'save', saveId: entry.id });
    setLoadOpen(false);
    setStarted(true); // also used to jump straight in from the startup screen
    setResetCount(c => c + 1); // force remount even if this save was already active
  }

  function resetTable() {
    localStorage.removeItem(storageKey);
    setResetCount(c => c + 1);
  }

  // Print just the table (toolbar hidden via print:hidden) using the browser's
  // native "Save as PDF" — no extra dependencies needed. The current light/dark
  // theme carries over as-is, since print-color-adjust keeps background colors.
  function exportPdf() {
    window.print();
  }

  return (
    <div className="min-h-screen bg-muted/40 tf-glow flex flex-col transition-colors">
      {/* Toolbar. On mobile this is two fixed rows — brand (with the theme
          toggle, so it's reachable without scrolling) and a horizontally-
          scrollable actions row — instead of one `flex-wrap` row. Wrapping
          on a narrow screen split the toolbar across an unpredictable
          number of lines and stranded `ml-auto` mid-row, leaving orphaned
          separators and a lone button dangling on its own line. `sm:contents`
          on both rows dissolves them back into one flat, wrapping row at the
          `sm` breakpoint, so desktop is pixel-identical to before. */}
      <header className="print:hidden relative bg-card border-b border-border px-3 sm:px-5 py-2.5 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-primary">
        <div className="flex items-center justify-between gap-2 sm:contents">
          <Brand />

          {/* Mobile-only theme toggle, kept beside the brand so it's always
              visible; the desktop instance further down covers `sm:` and up. */}
          <Button variant="ghost" size="icon" className="size-9 sm:hidden" onClick={() => setIsDark(d => !d)} title={isDark ? 'Byt till ljust läge' : 'Byt till mörkt läge'} aria-label={isDark ? 'Byt till ljust läge' : 'Byt till mörkt läge'}>
            {isDark ? <Sun /> : <Moon />}
          </Button>
        </div>

        <Separator orientation="vertical" className="hidden sm:block h-5" />

        {/* Actions row */}
        <div data-scroll-hide className="flex items-center gap-2 overflow-x-auto sm:contents">
          {/* Template picker */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline font-display text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Mall
            </span>
            <Select
              items={Object.fromEntries(TABLE_TEMPLATES.map(t => [t.id, t.label]))}
              value={template.id}
              onValueChange={v => {
                const t = TABLE_TEMPLATES.find(t => t.id === v);
                if (!t) return;
                clearShareHash();
                setActiveTemplate(t);
                setActiveSlot({ kind: 'draft', templateId: t.id });
              }}
            >
              <SelectTrigger size="sm" className="data-[size=sm]:h-9 sm:data-[size=sm]:h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TABLE_TEMPLATES.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator orientation="vertical" className="hidden sm:block h-5" />

          {/* Save / Update */}
          <div className="shrink-0">
            {activeSave ? (
              <Button variant="outline" size="icon" className="size-9 sm:size-8" onClick={updateCurrentSave} title={`Uppdatera "${activeSave.name}"`} aria-label={`Uppdatera "${activeSave.name}"`}>
                <Save />
              </Button>
            ) : (
              <Popover
                open={saveOpen}
                onOpenChange={o => {
                  setSaveOpen(o);
                  if (o) { setSaveName(defaultName()); setLoadOpen(false); }
                }}
              >
                <PopoverTrigger render={<Button variant="outline" size="icon" className="size-9 sm:size-8" title="Spara tabell" aria-label="Spara tabell" />}>
                  <Save />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 max-w-[calc(100vw-1.5rem)]">
                  <p className="font-display text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Spara tabell som
                  </p>
                  <Input
                    autoFocus
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') confirmSave();
                      if (e.key === 'Escape') setSaveOpen(false);
                    }}
                    placeholder="Tabellnamn"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
                      Avbryt
                    </Button>
                    <Button size="sm" onClick={confirmSave}>
                      Spara
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Load */}
          <Popover open={loadOpen} onOpenChange={o => { setLoadOpen(o); if (o) setSaveOpen(false); }}>
            <PopoverTrigger render={<Button variant="outline" size="icon" className="size-9 sm:size-8 shrink-0" title="Öppna en sparad tabell" aria-label={`Öppna en sparad tabell${savedTables.length > 0 ? ` (${savedTables.length} sparade)` : ''}`} />}>
              <FolderOpen />
            </PopoverTrigger>
            <PopoverContent data-scroll-hide align="start" className="w-72 max-w-[calc(100vw-1.5rem)] max-h-80 overflow-y-auto p-1.5 gap-0">
              <p className="font-display px-2 pt-1 pb-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Sparade tabeller
              </p>
              {savedTables.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  Inga sparade tabeller än. Använd Spara för att skapa en.
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
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatRelative(entry.savedAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={e => {
                        e.stopPropagation();
                        askDeleteSave(entry);
                      }}
                      title="Radera"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              )}
            </PopoverContent>
          </Popover>

          {/* Share */}
          <Button variant="outline" size="icon" className="size-9 sm:size-8 shrink-0" onClick={shareTable} title="Kopiera en delningslänk till tabellen" aria-label="Kopiera en delningslänk till tabellen">
            <Link />
          </Button>

          {/* Export */}
          <Button variant="outline" size="icon" className="size-9 sm:size-8 shrink-0" onClick={exportPdf} title="Exportera tabellen som PDF" aria-label="Exportera tabellen som PDF">
            <FileText />
          </Button>

          <Badge variant="outline" className="hidden lg:inline-flex ml-1 text-muted-foreground font-normal shrink-0">
            Tryck på en cell för alternativ · Tryck på en rubrik för att byta namn
          </Badge>

          {/* Reset button */}
          <Button
            variant="destructive"
            size="icon"
            className="size-9 sm:size-8 shrink-0 sm:ml-auto"
            onClick={() => setResetOpen(true)}
            title="Rensa all data och återställ tabellen"
            aria-label="Rensa all data och återställ tabellen"
          >
            <RotateCcw />
          </Button>
        </div>

        {/* Desktop-only theme toggle — mirrors its original end-of-toolbar position; the mobile instance lives in the brand row above. */}
        <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={() => setIsDark(d => !d)} title={isDark ? 'Byt till ljust läge' : 'Byt till mörkt läge'} aria-label={isDark ? 'Byt till ljust läge' : 'Byt till mörkt läge'}>
          {isDark ? <Sun /> : <Moon />}
        </Button>
      </header>

      {/* Canvas */}
      <main data-scroll-hide className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 md:p-12 flex items-start justify-center print:p-0 print:overflow-visible print:h-auto">
        <TableEditor
          key={`${storageKey}-${resetCount}`}
          template={template}
          storageKey={storageKey}
          initialSnapshot={activeSlot.kind === 'shared' ? sharedSnapshot : null}
          snapshotRef={snapshotRef}
          accentColor={getGameTypeColor(template.id)}
          accentSoft={getGameTypeColor(template.id, 3)}
          accentBorder={getGameTypeColor(template.id, 7)}
        />
      </main>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Återställ tabellen?</AlertDialogTitle>
            <AlertDialogDescription>
              All data i tabellen rensas. Det går inte att ångra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                resetTable();
                setResetOpen(false);
              }}
            >
              Återställ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {overlays}
    </div>
  );
}

// Brand mark — a tote-board-style monogram tile paired with a condensed,
// tightly-tracked wordmark. Reused at toolbar scale in the header and at
// display scale on the startup screen.
function Brand({ large = false }: { large?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={[
          "flex items-center justify-center shrink-0 rounded-md bg-primary text-primary-foreground font-display font-bold shadow-sm",
          large ? "size-11 text-xl" : "size-7 text-sm",
        ].join(" ")}
      >
        TT
      </span>
      <span
        className={[
          "font-display font-semibold text-foreground tracking-tight leading-none",
          large ? "text-4xl" : "text-xl",
        ].join(" ")}
      >
        Travtavlan
      </span>
    </div>
  );
}

function StartupScreen({
  savedTables, shareError, onChoose, onOpenSave, onDeleteSave,
}: {
  savedTables: SavedTable[];
  shareError: boolean;
  onChoose: (template: TableTemplate) => void;
  onOpenSave: (entry: SavedTable) => void;
  onDeleteSave: (entry: SavedTable) => void;
}) {
  const recentSaves = [...savedTables].sort((a, b) => b.savedAt - a.savedAt);

  return (
    <div className="min-h-screen bg-muted/40 tf-glow flex flex-col items-center justify-center gap-9 p-6 overflow-hidden">
      <div className="animate-in fade-in slide-in-from-top-3 duration-500">
        <Brand large />
      </div>
      {shareError && (
        <p role="alert" className="text-sm text-destructive text-center max-w-md">
          Delningslänken kunde inte öppnas — den kan vara ofullständig eller trasig.
        </p>
      )}
      <div className="flex flex-col items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100 fill-mode-both">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Välj ett spel för att komma igång
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full max-w-md">
          {TABLE_TEMPLATES.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChoose(t)}
              style={{
                borderTopColor: getGameTypeColor(t.id),
                animationDelay: `${120 + i * 40}ms`,
              }}
              className="animate-in fade-in zoom-in-95 fill-mode-both group flex items-center justify-center rounded-xl border border-border border-t-[3px] bg-card px-4 py-6 font-display text-xl font-bold tracking-tight text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:bg-accent active:translate-y-0"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {recentSaves.length > 0 && (
        <div className="flex flex-col items-center gap-3 w-full max-w-md animate-in fade-in duration-500 delay-300 fill-mode-both">
          <div className="flex items-center gap-3 w-full">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground font-medium shrink-0">eller öppna en sparad tabell</span>
            <Separator className="flex-1" />
          </div>
          <div data-scroll-hide className="flex flex-col gap-1.5 w-full max-h-64 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-sm">
            {/* The open and delete buttons sit side by side in one row,
                since a button can't contain another button. */}
            {recentSaves.map(entry => (
              <div
                key={entry.id}
                className="flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={() => onOpenSave(entry)}
                  className="flex flex-1 min-w-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: getGameTypeColor(entry.templateId ?? '') }}
                  />
                  <span className="flex-1 min-w-0 text-sm font-medium text-foreground truncate">
                    {entry.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatRelative(entry.savedAt)}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onDeleteSave(entry)}
                  title={`Radera "${entry.name}"`}
                  aria-label={`Radera "${entry.name}"`}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
