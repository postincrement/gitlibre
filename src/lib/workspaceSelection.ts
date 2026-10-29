import type { RepositoryId, WorkspaceId } from "../types/models";

const STORAGE_KEY = "gitlibre.selectedRepository.byWorkspace";

function readAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function loadSelectedRepository(
  workspaceId: WorkspaceId,
): RepositoryId | null {
  const value = readAll()[workspaceId];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function persistSelectedRepository(
  workspaceId: WorkspaceId,
  repositoryId: RepositoryId | null,
): void {
  try {
    const all = readAll();
    if (repositoryId) {
      all[workspaceId] = repositoryId;
    } else {
      delete all[workspaceId];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota / private mode */
  }
}
