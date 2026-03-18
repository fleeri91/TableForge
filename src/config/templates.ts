// ── Table template config ───────────────────────────────────────────────────
// Each template defines the initial number of columns and rows, and the
// prefix used to name columns (e.g. "V64" → V64:1, V64:2, …).
// Add new templates here and they will appear in the toolbar picker.

export interface TableTemplate {
  id: string;
  label: string;
  columns: number;
  rows: number;
  columnPrefix: string;
}

export const TABLE_TEMPLATES: TableTemplate[] = [
  { id: "v85", label: "V85", columns: 8, rows: 15, columnPrefix: "V85" },
  { id: "v86", label: "V86", columns: 8, rows: 15, columnPrefix: "V86" },
  { id: "gs75", label: "GS75", columns: 7, rows: 15, columnPrefix: "GS75" },
  { id: "v64", label: "V64", columns: 6, rows: 15, columnPrefix: "V64" },
  { id: "v4", label: "V4", columns: 4, rows: 15, columnPrefix: "V4" },
  { id: "v5", label: "V5", columns: 5, rows: 15, columnPrefix: "V5" },
];
