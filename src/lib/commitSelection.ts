import type { RepositoryId } from "../types/models";

const STORAGE_KEY = "gitlibre.selectedCommit.byRepository";

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

export function loadSelectedCommit(
  repositoryId: RepositoryId,
): string | null {
  const value = readAll()[repositoryId];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function persistSelectedCommit(
  repositoryId: RepositoryId,
  commitId: string | null,
): void {
  try {
    const all = readAll();
    if (commitId) {
      all[repositoryId] = commitId;
    } else {
      delete all[repositoryId];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota / private mode */
  }
}
