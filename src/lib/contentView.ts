import type { WorkspaceId } from "../types/models";

export type ContentViewMode = "fileStatus" | "history" | "search";

const STORAGE_KEY = "gitlibre.contentView.byWorkspace";
export const DEFAULT_CONTENT_VIEW: ContentViewMode = "history";

function readAll(): Record<string, ContentViewMode> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, ContentViewMode> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (value === "fileStatus" || value === "history" || value === "search") {
        out[id] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function loadContentView(
  workspaceId: WorkspaceId,
  fallback: ContentViewMode = DEFAULT_CONTENT_VIEW,
): ContentViewMode {
  return readAll()[workspaceId] ?? fallback;
}

export function persistContentView(
  workspaceId: WorkspaceId,
  mode: ContentViewMode,
): void {
  try {
    const all = readAll();
    all[workspaceId] = mode;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
