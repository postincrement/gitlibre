export type StatusColorKey =
  | "modified"
  | "added"
  | "new"
  | "deleted"
  | "repoChanges"
  | "branch"
  | "branchDivergence"
  | "tag";

export interface StatusColors {
  modified: string;
  added: string;
  new: string;
  deleted: string;
  /** Badge on dirty repositories in the sidebar. */
  repoChanges: string;
  /** Local branch name chips in the commit graph. */
  branch: string;
  /** Ahead/behind-of-remote count badges. */
  branchDivergence: string;
  /** Tag chips on commits in history. */
  tag: string;
}

export const DEFAULT_STATUS_COLORS: StatusColors = {
  modified: "#f6c342",
  /** Added files in commit history. */
  added: "#14892c",
  /** New / untracked files in the working tree. */
  new: "#654982",
  /** Deleted files. */
  deleted: "#999999",
  /** Changed-file count badge on repository rows. */
  repoChanges: "#3472b0",
  /** Local branch chips. */
  branch: "#d5e7ff",
  /** Ahead/behind-of-remote count. */
  branchDivergence: "#003a79",
  /** Tag chips on commits in history. */
  tag: "#ffded5",
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
      deleted: normalizeHex(
        parsed.deleted ?? "",
        DEFAULT_STATUS_COLORS.deleted,
      ),
      repoChanges: normalizeHex(
        parsed.repoChanges ?? "",
        DEFAULT_STATUS_COLORS.repoChanges,
      ),
      branch: normalizeHex(parsed.branch ?? "", DEFAULT_STATUS_COLORS.branch),
      branchDivergence: normalizeHex(
        // Prefer the unified key; migrate older ahead/behind prefs if present.
        parsed.branchDivergence ??
          (parsed as { branchAhead?: string }).branchAhead ??
          (parsed as { branchBehind?: string }).branchBehind ??
          "",
        DEFAULT_STATUS_COLORS.branchDivergence,
      ),
      tag: normalizeHex(
        // The first shipped default was gold; treat that as unset.
        parsed.tag === "#f5c451" ? "" : (parsed.tag ?? ""),
        DEFAULT_STATUS_COLORS.tag,
      ),
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

/**
 * Pick black or white ink for readable text on `hex` (WCAG relative luminance).
 */
export function contrastingInk(hex: string): "#ffffff" | "#1a1200" {
  const normalized = normalizeHex(hex, "#000000");
  const r = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const g = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const b = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.55 ? "#1a1200" : "#ffffff";
}

/** Write CSS variables used by file-list status badges. */
export function applyStatusColors(colors: StatusColors): void {
  saveStatusColors(colors);
  const root = document.documentElement;
  root.style.setProperty("--status-modified", colors.modified);
  root.style.setProperty("--status-added", colors.added);
  root.style.setProperty("--status-new", colors.new);
  root.style.setProperty("--status-deleted", colors.deleted);
  root.style.setProperty("--status-repo-changes", colors.repoChanges);
  root.style.setProperty("--status-branch", colors.branch);
  root.style.setProperty(
    "--status-branch-fg",
    contrastingInk(colors.branch),
  );
  root.style.setProperty("--status-branch-divergence", colors.branchDivergence);
  root.style.setProperty(
    "--status-branch-divergence-fg",
    contrastingInk(colors.branchDivergence),
  );
  root.style.setProperty("--status-tag", colors.tag);
  root.style.setProperty("--status-tag-fg", contrastingInk(colors.tag));
}

export function resetStatusColors(): StatusColors {
  const colors = { ...DEFAULT_STATUS_COLORS };
  applyStatusColors(colors);
  return colors;
}

export function initStatusColors(): void {
  applyStatusColors(loadStatusColors());
}
