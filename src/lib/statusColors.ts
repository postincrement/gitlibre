export type StatusColorKey = "modified" | "added" | "new";

export interface StatusColors {
  modified: string;
  added: string;
  new: string;
}

export const DEFAULT_STATUS_COLORS: StatusColors = {
  modified: "#f6c342",
  /** Added files in commit history. */
  added: "#14892c",
  /** New / untracked files in the working tree. */
  new: "#654982",
};

const STORAGE_KEY = "gitlibre.statusColors";

const HEX_RE = /^#([0-9a-fA-F]{6})$/;

function normalizeHex(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (HEX_RE.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`;
  return fallback;
}

export function loadStatusColors(): StatusColors {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATUS_COLORS };
    const parsed = JSON.parse(raw) as Partial<StatusColors>;
    return {
      modified: normalizeHex(
        parsed.modified ?? "",
        DEFAULT_STATUS_COLORS.modified,
      ),
      added: normalizeHex(parsed.added ?? "", DEFAULT_STATUS_COLORS.added),
      new: normalizeHex(parsed.new ?? "", DEFAULT_STATUS_COLORS.new),
    };
  } catch {
    return { ...DEFAULT_STATUS_COLORS };
  }
}

export function saveStatusColors(colors: StatusColors): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    /* ignore */
  }
}

/** Write CSS variables used by file-list status badges. */
export function applyStatusColors(colors: StatusColors): void {
  saveStatusColors(colors);
  const root = document.documentElement;
  root.style.setProperty("--status-modified", colors.modified);
  root.style.setProperty("--status-added", colors.added);
  root.style.setProperty("--status-new", colors.new);
}

export function resetStatusColors(): StatusColors {
  const colors = { ...DEFAULT_STATUS_COLORS };
  applyStatusColors(colors);
  return colors;
}

export function initStatusColors(): void {
  applyStatusColors(loadStatusColors());
}
