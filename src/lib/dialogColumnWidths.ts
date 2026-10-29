import type { WorkspaceId } from "../types/models";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readMap<T extends Record<string, number>>(
  key: string,
  defaults: T,
  mins: T,
  max: number,
): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<T>>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, T> = {};
    for (const [id, widths] of Object.entries(parsed)) {
      out[id] = normalize(widths, defaults, mins, max);
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap<T extends Record<string, number>>(key: string, all: Record<string, T>) {
  try {
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function normalize<T extends Record<string, number>>(
  raw: Partial<T> | null | undefined,
  defaults: T,
  mins: T,
  max: number,
): T {
  const next = { ...defaults };
  if (!raw) return next;
  for (const id of Object.keys(defaults) as (keyof T & string)[]) {
    const value = raw[id];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[id] = clamp(value, mins[id], max) as T[keyof T & string];
    }
  }
  return next;
}

export type FileLogColumnId = "commit" | "message" | "author" | "date";

export type FileLogColumnWidths = Record<FileLogColumnId, number>;

export const FILE_LOG_COLUMNS: { id: FileLogColumnId; title: string }[] = [
  { id: "commit", title: "Commit" },
  { id: "message", title: "Message" },
  { id: "author", title: "Author" },
  { id: "date", title: "Date" },
];

export const DEFAULT_FILE_LOG_WIDTHS: FileLogColumnWidths = {
  commit: 88,
  message: 360,
  author: 140,
  date: 168,
};

export const MIN_FILE_LOG_WIDTHS: FileLogColumnWidths = {
  commit: 56,
  message: 100,
  author: 64,
  date: 96,
};

const FILE_LOG_KEY = "gitlibre.fileLogColumnWidths.byWorkspace";
const FILE_LOG_MAX = 720;

export function loadFileLogColumnWidths(
  workspaceId: WorkspaceId,
): FileLogColumnWidths {
  return (
    readMap(
      FILE_LOG_KEY,
      DEFAULT_FILE_LOG_WIDTHS,
      MIN_FILE_LOG_WIDTHS,
      FILE_LOG_MAX,
    )[workspaceId] ?? { ...DEFAULT_FILE_LOG_WIDTHS }
  );
}

export function persistFileLogColumnWidths(
  workspaceId: WorkspaceId,
  widths: FileLogColumnWidths,
) {
  const all = readMap(
    FILE_LOG_KEY,
    DEFAULT_FILE_LOG_WIDTHS,
    MIN_FILE_LOG_WIDTHS,
    FILE_LOG_MAX,
  );
  all[workspaceId] = normalize(
    widths,
    DEFAULT_FILE_LOG_WIDTHS,
    MIN_FILE_LOG_WIDTHS,
    FILE_LOG_MAX,
  );
  writeMap(FILE_LOG_KEY, all);
}

export function clampFileLogColumnWidth(
  id: FileLogColumnId,
  width: number,
): number {
  return clamp(width, MIN_FILE_LOG_WIDTHS[id], FILE_LOG_MAX);
}

export type FileAnnotateColumnId =
  | "commit"
  | "author"
  | "date"
  | "line"
  | "content";

export type FileAnnotateColumnWidths = Record<FileAnnotateColumnId, number>;

export const FILE_ANNOTATE_COLUMNS: {
  id: FileAnnotateColumnId;
  title: string;
}[] = [
  { id: "commit", title: "Commit" },
  { id: "author", title: "Author" },
  { id: "date", title: "Date" },
  { id: "line", title: "Line" },
  { id: "content", title: "Content" },
];

export const DEFAULT_FILE_ANNOTATE_WIDTHS: FileAnnotateColumnWidths = {
  commit: 80,
  author: 120,
  date: 160,
  line: 56,
  content: 480,
};

export const MIN_FILE_ANNOTATE_WIDTHS: FileAnnotateColumnWidths = {
  commit: 56,
  author: 64,
  date: 96,
  line: 40,
  content: 120,
};

const FILE_ANNOTATE_KEY = "gitlibre.fileAnnotateColumnWidths.byWorkspace";
const FILE_ANNOTATE_MAX = 1200;

export function loadFileAnnotateColumnWidths(
  workspaceId: WorkspaceId,
): FileAnnotateColumnWidths {
  return (
    readMap(
      FILE_ANNOTATE_KEY,
      DEFAULT_FILE_ANNOTATE_WIDTHS,
      MIN_FILE_ANNOTATE_WIDTHS,
      FILE_ANNOTATE_MAX,
    )[workspaceId] ?? { ...DEFAULT_FILE_ANNOTATE_WIDTHS }
  );
}

export function persistFileAnnotateColumnWidths(
  workspaceId: WorkspaceId,
  widths: FileAnnotateColumnWidths,
) {
  const all = readMap(
    FILE_ANNOTATE_KEY,
    DEFAULT_FILE_ANNOTATE_WIDTHS,
    MIN_FILE_ANNOTATE_WIDTHS,
    FILE_ANNOTATE_MAX,
  );
  all[workspaceId] = normalize(
    widths,
    DEFAULT_FILE_ANNOTATE_WIDTHS,
    MIN_FILE_ANNOTATE_WIDTHS,
    FILE_ANNOTATE_MAX,
  );
  writeMap(FILE_ANNOTATE_KEY, all);
}

export function clampFileAnnotateColumnWidth(
  id: FileAnnotateColumnId,
  width: number,
): number {
  return clamp(width, MIN_FILE_ANNOTATE_WIDTHS[id], FILE_ANNOTATE_MAX);
}
