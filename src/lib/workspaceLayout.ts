import type { WorkspaceId } from "../types/models";

const SIDEBAR_WIDTH_KEY = "gitlibre.sidebarWidth.byWorkspace";
const SIDEBAR_WIDTH_LEGACY_KEY = "gitlibre.sidebarWidth";
const REPO_LIST_HEIGHT_KEY = "gitlibre.sidebarRepoListHeight.byWorkspace";
const REPO_LIST_HEIGHT_LEGACY_KEY = "gitlibre.sidebarRepoListHeight";

const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 560;
const DEFAULT_SIDEBAR_WIDTH = 256;

const MIN_REPO_LIST_HEIGHT = 72;
const DEFAULT_REPO_LIST_HEIGHT = 200;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readMap(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const n = Number(value);
      if (Number.isFinite(n)) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(key: string, all: Record<string, number>) {
  try {
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function readLegacyNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function loadSidebarWidth(
  workspaceId: WorkspaceId,
  fallback = DEFAULT_SIDEBAR_WIDTH,
): number {
  const all = readMap(SIDEBAR_WIDTH_KEY);
  const existing = all[workspaceId];
  if (existing != null) {
    return clamp(existing, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
  }
  const legacy = readLegacyNumber(SIDEBAR_WIDTH_LEGACY_KEY);
  if (legacy != null) {
    const value = clamp(legacy, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
    all[workspaceId] = value;
    writeMap(SIDEBAR_WIDTH_KEY, all);
    return value;
  }
  return fallback;
}

export function persistSidebarWidth(
  workspaceId: WorkspaceId,
  width: number,
): void {
  const all = readMap(SIDEBAR_WIDTH_KEY);
  all[workspaceId] = clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
  writeMap(SIDEBAR_WIDTH_KEY, all);
}

export function clampSidebarWidth(width: number): number {
  return clamp(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

export function loadRepoListHeight(
  workspaceId: WorkspaceId,
  fallback = DEFAULT_REPO_LIST_HEIGHT,
): number {
  const all = readMap(REPO_LIST_HEIGHT_KEY);
  const existing = all[workspaceId];
  if (existing != null) {
    return Math.max(MIN_REPO_LIST_HEIGHT, existing);
  }
  const legacy = readLegacyNumber(REPO_LIST_HEIGHT_LEGACY_KEY);
  if (legacy != null) {
    const value = Math.max(MIN_REPO_LIST_HEIGHT, legacy);
    all[workspaceId] = value;
    writeMap(REPO_LIST_HEIGHT_KEY, all);
    return value;
  }
  return fallback;
}

export function persistRepoListHeight(
  workspaceId: WorkspaceId,
  height: number,
): void {
  const all = readMap(REPO_LIST_HEIGHT_KEY);
  all[workspaceId] = Math.max(MIN_REPO_LIST_HEIGHT, height);
  writeMap(REPO_LIST_HEIGHT_KEY, all);
}

export function clampRepoListHeight(
  height: number,
  containerHeight: number,
): number {
  const max = Math.max(MIN_REPO_LIST_HEIGHT, containerHeight - 160);
  return Math.min(max, Math.max(MIN_REPO_LIST_HEIGHT, height));
}

export { MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_REPO_LIST_HEIGHT };
