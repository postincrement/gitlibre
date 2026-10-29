export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "gitlibre.theme";

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* ignore */
  }
  return "system";
}

export function saveThemePreference(theme: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
}

/** Apply resolved light/dark classes and native color-scheme. */
export function applyResolvedTheme(resolved: "light" | "dark"): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute("content", resolved);
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  saveThemePreference(preference);
  applyResolvedTheme(resolveTheme(preference));
}

/**
 * Boot theme before React mounts, follow OS changes when preference is
 * "system", and sync when another window updates localStorage.
 */
export async function initTheme(): Promise<() => void> {
  applyThemePreference(loadThemePreference());

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    if (loadThemePreference() === "system") {
      applyResolvedTheme(resolveTheme("system"));
    }
  };
  media.addEventListener("change", onMedia);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || event.newValue == null) return;
    const next = event.newValue;
    if (next === "light" || next === "dark" || next === "system") {
      applyResolvedTheme(resolveTheme(next));
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    media.removeEventListener("change", onMedia);
    window.removeEventListener("storage", onStorage);
  };
}
