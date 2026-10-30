const STORAGE_KEY = "gitlibre.uiZoom";

/** Fired in the same window when zoom changes. */
export const UI_ZOOM_CHANGED_EVENT = "gitlibre-ui-zoom-changed";

export const DEFAULT_UI_ZOOM = 1;
export const MIN_UI_ZOOM = 0.7;
export const MAX_UI_ZOOM = 1.6;
export const UI_ZOOM_STEP = 0.1;

function clampZoom(value: number): number {
  const stepped = Math.round(value / UI_ZOOM_STEP) * UI_ZOOM_STEP;
  return Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, Number(stepped.toFixed(2))));
}

function notify(): void {
  window.dispatchEvent(new Event(UI_ZOOM_CHANGED_EVENT));
}

function applyZoom(zoom: number): void {
  document.documentElement.style.setProperty("--ui-zoom", String(zoom));
  // Chromium / WebKit: scales rem *and* fixed px UI consistently.
  document.documentElement.style.zoom = String(zoom);
}

export function loadUiZoom(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_UI_ZOOM;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_UI_ZOOM;
    return clampZoom(parsed);
  } catch {
    return DEFAULT_UI_ZOOM;
  }
}

export function persistUiZoom(zoom: number): void {
  const next = clampZoom(zoom);
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* ignore */
  }
  applyZoom(next);
  notify();
}

export function zoomIn(): number {
  const next = clampZoom(loadUiZoom() + UI_ZOOM_STEP);
  persistUiZoom(next);
  return next;
}

export function zoomOut(): number {
  const next = clampZoom(loadUiZoom() - UI_ZOOM_STEP);
  persistUiZoom(next);
  return next;
}

export function resetUiZoom(): number {
  persistUiZoom(DEFAULT_UI_ZOOM);
  return DEFAULT_UI_ZOOM;
}

export function initUiZoom(): () => void {
  applyZoom(loadUiZoom());

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    applyZoom(loadUiZoom());
    notify();
  };

  /** Extra accelerators browsers often bind (e.g. Cmd+= without Shift). */
  const onKeyDown = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey) return;
    const key = event.key;
    if (key === "=" || key === "+") {
      event.preventDefault();
      zoomIn();
      return;
    }
    if (key === "-" || key === "_") {
      event.preventDefault();
      zoomOut();
      return;
    }
    if (key === "0") {
      event.preventDefault();
      resetUiZoom();
    }
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener("keydown", onKeyDown);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("keydown", onKeyDown);
  };
}
