import { useState, useEffect } from 'react';
import { TableEditor } from './components/TableEditor';
import { TABLE_TEMPLATES, type TableTemplate } from './config/templates';

export function App() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const [isDark, setIsDark] = useState(mq.matches);
  const [activeTemplate, setActiveTemplate] = useState<TableTemplate | null>(null);
  const [resetCount, setResetCount] = useState(0);

  const storageKey = `tableforge-${activeTemplate?.id ?? 'blank'}`;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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
            }}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="">Blank</option>
            {TABLE_TEMPLATES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
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
