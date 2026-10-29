import type { ChangeArea, RepositoryId } from "../types/models";

export interface PersistedFileSelection {
  path: string;
  area: ChangeArea | null;
  status: string;
  oldPath?: string | null;
}

const STORAGE_KEY = "gitlibre.selectedFile.byRepoCommit";

function storageKey(repositoryId: RepositoryId, commitId: string): string {
  return `${repositoryId}:${commitId}`;
}

function readAll(): Record<string, PersistedFileSelection> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PersistedFileSelection>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function loadSelectedFile(
  repositoryId: RepositoryId,
  commitId: string,
): PersistedFileSelection | null {
  const value = readAll()[storageKey(repositoryId, commitId)];
  if (!value || typeof value.path !== "string" || !value.path) return null;
  return value;
}

export function persistSelectedFile(
  repositoryId: RepositoryId,
  commitId: string,
  file: PersistedFileSelection | null,
): void {
  try {
    const all = readAll();
    const key = storageKey(repositoryId, commitId);
    if (file) {
      all[key] = file;
    } else {
      delete all[key];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
