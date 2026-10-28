import type { WorkspaceId } from "../types/models";

export type CommitGraphColumnId =
  | "graph"
  | "description"
  | "commit"
  | "author"
  | "date";

export const COMMIT_GRAPH_COLUMNS: {
  id: CommitGraphColumnId;
  title: string;
}[] = [
  { id: "graph", title: "Graph" },
  { id: "description", title: "Description" },
  { id: "commit", title: "Commit" },
  { id: "author", title: "Author" },
  { id: "date", title: "Date" },
];

export type CommitGraphColumnWidths = Record<CommitGraphColumnId, number>;

const STORAGE_KEY = "gitlibre.commitGraphColumnWidths.byWorkspace";
/** Legacy global key — migrated into a workspace entry on first load. */
const LEGACY_STORAGE_KEY = "gitlibre.commitGraphColumnWidths";

export const DEFAULT_COLUMN_WIDTHS: CommitGraphColumnWidths = {
  graph: 88,
  description: 360,
  commit: 88,
  author: 140,
  date: 168,
};

export const MIN_COLUMN_WIDTHS: CommitGraphColumnWidths = {
  graph: 48,
  description: 80,
  commit: 56,
  author: 64,
  date: 96,
};

export const MAX_COLUMN_WIDTH = 720;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function normalizeWidths(
  raw: Partial<CommitGraphColumnWidths> | null | undefined,
): CommitGraphColumnWidths {
  const next = { ...DEFAULT_COLUMN_WIDTHS };
  if (!raw) return next;
  for (const col of COMMIT_GRAPH_COLUMNS) {
    const value = raw[col.id];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[col.id] = clamp(value, MIN_COLUMN_WIDTHS[col.id], MAX_COLUMN_WIDTH);
    }
  }
  return next;
}

function readAll(): Record<string, CommitGraphColumnWidths> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<CommitGraphColumnWidths>>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, CommitGraphColumnWidths> = {};
    for (const [id, widths] of Object.entries(parsed)) {
      out[id] = normalizeWidths(widths);
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, CommitGraphColumnWidths>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore quota / private mode failures.
  }
}

function readLegacyWidths(): CommitGraphColumnWidths | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    return normalizeWidths(JSON.parse(raw) as Partial<CommitGraphColumnWidths>);
  } catch {
    return null;
  }
}

export function loadCommitGraphColumnWidths(
  workspaceId: WorkspaceId,
): CommitGraphColumnWidths {
  const all = readAll();
  const existing = all[workspaceId];
  if (existing) return existing;

  // One-time migrate previous global widths into this workspace.
  const legacy = readLegacyWidths();
  if (legacy) {
    all[workspaceId] = legacy;
    writeAll(all);
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
    return legacy;
  }

  return { ...DEFAULT_COLUMN_WIDTHS };
}

export function persistCommitGraphColumnWidths(
  workspaceId: WorkspaceId,
  widths: CommitGraphColumnWidths,
) {
  const all = readAll();
  all[workspaceId] = normalizeWidths(widths);
  writeAll(all);
}

export function clampColumnWidth(
  id: CommitGraphColumnId,
  width: number,
): number {
  return clamp(width, MIN_COLUMN_WIDTHS[id], MAX_COLUMN_WIDTH);
}
