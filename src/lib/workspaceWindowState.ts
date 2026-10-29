import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import type { WorkspaceId } from "../types/models";

export interface WorkspaceWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

const STORAGE_KEY = "gitlibre.workspaceWindowGeometry";
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;

function readAll(): Record<string, WorkspaceWindowGeometry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<WorkspaceWindowGeometry>>;
    const out: Record<string, WorkspaceWindowGeometry> = {};
    for (const [id, value] of Object.entries(parsed)) {
      const normalized = normalizeGeometry(value);
      if (normalized) out[id] = normalized;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, WorkspaceWindowGeometry>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function normalizeGeometry(
  raw: Partial<WorkspaceWindowGeometry> | null | undefined,
): WorkspaceWindowGeometry | null {
  if (!raw) return null;
  const width = Number(raw.width);
  const height = Number(raw.height);
  const x = Number(raw.x);
  const y = Number(raw.y);
  if (![width, height, x, y].every(Number.isFinite)) return null;
  return {
    x,
    y,
    width: Math.max(MIN_WIDTH, width),
    height: Math.max(MIN_HEIGHT, height),
    maximized: Boolean(raw.maximized),
  };
}

export function loadWorkspaceWindowGeometry(
  workspaceId: WorkspaceId,
): WorkspaceWindowGeometry | null {
  return readAll()[workspaceId] ?? null;
}

export function persistWorkspaceWindowGeometry(
  workspaceId: WorkspaceId,
  geometry: WorkspaceWindowGeometry,
): void {
  const normalized = normalizeGeometry(geometry);
  if (!normalized) return;
  const all = readAll();
  all[workspaceId] = normalized;
  writeAll(all);
}

/** Apply saved geometry for a workspace to the current window. */
export async function restoreWorkspaceWindowGeometry(
  workspaceId: WorkspaceId,
): Promise<void> {
  const saved = loadWorkspaceWindowGeometry(workspaceId);
  if (!saved) return;

  try {
    const win = getCurrentWindow();
    const width = Math.max(MIN_WIDTH, saved.width);
    const height = Math.max(MIN_HEIGHT, saved.height);

    if (saved.maximized) {
      await win.setSize(new LogicalSize(width, height));
      await win.setPosition(new LogicalPosition(saved.x, saved.y));
      await win.maximize();
      return;
    }

    if (await win.isMaximized()) {
      await win.unmaximize();
    }
    await win.setSize(new LogicalSize(width, height));
    await win.setPosition(new LogicalPosition(saved.x, saved.y));
  } catch {
    // Browser preview / missing permissions — ignore.
  }
}

/** Read the current window geometry in logical pixels. */
export async function captureWorkspaceWindowGeometry(): Promise<WorkspaceWindowGeometry | null> {
  try {
    const win = getCurrentWindow();
    const maximized = await win.isMaximized();
    const factor = await win.scaleFactor();
    const size = (await win.innerSize()).toLogical(factor);
    const pos = (await win.outerPosition()).toLogical(factor);
    return {
      x: pos.x,
      y: pos.y,
      width: Math.max(MIN_WIDTH, size.width || DEFAULT_WIDTH),
      height: Math.max(MIN_HEIGHT, size.height || DEFAULT_HEIGHT),
      maximized,
    };
  } catch {
    return null;
  }
}

/**
 * Persist current geometry. When maximized, keep the last restored/normal
 * size and position so un-maximize returns to the previous frame.
 */
export async function saveWorkspaceWindowGeometry(
  workspaceId: WorkspaceId,
): Promise<void> {
  const current = await captureWorkspaceWindowGeometry();
  if (!current) return;

  if (current.maximized) {
    const previous = loadWorkspaceWindowGeometry(workspaceId);
    persistWorkspaceWindowGeometry(workspaceId, {
      x: previous?.x ?? current.x,
      y: previous?.y ?? current.y,
      width: previous?.width ?? current.width,
      height: previous?.height ?? current.height,
      maximized: true,
    });
    return;
  }

  persistWorkspaceWindowGeometry(workspaceId, current);
}

/** Clamp helpers shared with defaults. */
export function defaultWindowSize(): { width: number; height: number } {
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}
