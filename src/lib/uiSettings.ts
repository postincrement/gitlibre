const MONO_FILENAMES_KEY = "gitlibre.monospaceFilenames";
const SEPARATE_UNTRACKED_KEY = "gitlibre.separateUntrackedList";

/** Fired in the same window when a UI setting is saved. */
export const UI_SETTINGS_CHANGED_EVENT = "gitlibre-ui-settings-changed";

/** Default matches the previous always-monospace file lists. */
export const DEFAULT_MONOSPACE_FILENAMES = true;

/** Default matches the previous Staged / Unstaged / Untracked sections. */
export const DEFAULT_SEPARATE_UNTRACKED_LIST = true;

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

function notifyUiSettingsChanged(): void {
  window.dispatchEvent(new Event(UI_SETTINGS_CHANGED_EVENT));
}

export function loadMonospaceFilenames(): boolean {
  return readBool(MONO_FILENAMES_KEY, DEFAULT_MONOSPACE_FILENAMES);
}

export function applyMonospaceFilenames(enabled: boolean): void {
  writeBool(MONO_FILENAMES_KEY, enabled);
  document.documentElement.classList.toggle("filenames-mono", enabled);
  notifyUiSettingsChanged();
}

export function loadSeparateUntrackedList(): boolean {
  return readBool(SEPARATE_UNTRACKED_KEY, DEFAULT_SEPARATE_UNTRACKED_LIST);
}

export function applySeparateUntrackedList(enabled: boolean): void {
  writeBool(SEPARATE_UNTRACKED_KEY, enabled);
  notifyUiSettingsChanged();
}

export function initUiSettings(): () => void {
  document.documentElement.classList.toggle(
    "filenames-mono",
    loadMonospaceFilenames(),
  );

  const onStorage = (event: StorageEvent) => {
    if (event.key === MONO_FILENAMES_KEY && event.newValue != null) {
      document.documentElement.classList.toggle(
        "filenames-mono",
        event.newValue === "true",
      );
      notifyUiSettingsChanged();
    }
    if (event.key === SEPARATE_UNTRACKED_KEY) {
      notifyUiSettingsChanged();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
