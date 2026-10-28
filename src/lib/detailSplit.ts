import type { WorkspaceId } from "../types/models";

const STORAGE_KEY = "gitlibre.commitDetailSplitHeight.byWorkspace";

export const DEFAULT_DETAIL_PANE_HEIGHT = 180;
export const MIN_DETAIL_PANE_HEIGHT = 96;
export const MIN_HISTORY_PANE_HEIGHT = 120;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readAll(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function loadDetailPaneHeight(
  workspaceId: WorkspaceId,
  fallback = DEFAULT_DETAIL_PANE_HEIGHT,
): number {
  const value = readAll()[workspaceId];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(value, MIN_DETAIL_PANE_HEIGHT, 800);
}

export function persistDetailPaneHeight(workspaceId: WorkspaceId, height: number) {
  try {
    const all = readAll();
    all[workspaceId] = clamp(height, MIN_DETAIL_PANE_HEIGHT, 800);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function clampDetailPaneHeight(
  height: number,
  containerHeight: number,
): number {
  const max = Math.max(
    MIN_DETAIL_PANE_HEIGHT,
    containerHeight - MIN_HISTORY_PANE_HEIGHT,
  );
  return clamp(height, MIN_DETAIL_PANE_HEIGHT, max);
}

const FILES_WIDTH_KEY = "gitlibre.commitFilesListWidth.byWorkspace";

export const DEFAULT_FILES_LIST_WIDTH = 260;
export const MIN_FILES_LIST_WIDTH = 140;
export const MAX_FILES_LIST_WIDTH = 560;

function readWidths(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FILES_WIDTH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function loadFilesListWidth(
  workspaceId: WorkspaceId,
  fallback = DEFAULT_FILES_LIST_WIDTH,
): number {
  const value = readWidths()[workspaceId];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(value, MIN_FILES_LIST_WIDTH, MAX_FILES_LIST_WIDTH);
}

export function persistFilesListWidth(workspaceId: WorkspaceId, width: number) {
  try {
    const all = readWidths();
    all[workspaceId] = clamp(width, MIN_FILES_LIST_WIDTH, MAX_FILES_LIST_WIDTH);
    localStorage.setItem(FILES_WIDTH_KEY, JSON.stringify(all));
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function clampFilesListWidth(width: number): number {
  return clamp(width, MIN_FILES_LIST_WIDTH, MAX_FILES_LIST_WIDTH);
}

const COMMIT_INFO_HEIGHT_KEY = "gitlibre.commitInfoPaneHeight.byWorkspace";

export const DEFAULT_COMMIT_INFO_HEIGHT = 140;
export const MIN_COMMIT_INFO_HEIGHT = 88;
export const MAX_COMMIT_INFO_HEIGHT = 360;

function readInfoHeights(): Record<string, number> {
  try {
    const raw = localStorage.getItem(COMMIT_INFO_HEIGHT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

export function loadCommitInfoHeight(
  workspaceId: WorkspaceId,
  fallback = DEFAULT_COMMIT_INFO_HEIGHT,
): number {
  const value = readInfoHeights()[workspaceId];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(value, MIN_COMMIT_INFO_HEIGHT, MAX_COMMIT_INFO_HEIGHT);
}

export function persistCommitInfoHeight(workspaceId: WorkspaceId, height: number) {
  try {
    const all = readInfoHeights();
    all[workspaceId] = clamp(height, MIN_COMMIT_INFO_HEIGHT, MAX_COMMIT_INFO_HEIGHT);
    localStorage.setItem(COMMIT_INFO_HEIGHT_KEY, JSON.stringify(all));
  } catch {
    // Ignore quota / private mode failures.
  }
}

export function clampCommitInfoHeight(height: number): number {
  return clamp(height, MIN_COMMIT_INFO_HEIGHT, MAX_COMMIT_INFO_HEIGHT);
}
