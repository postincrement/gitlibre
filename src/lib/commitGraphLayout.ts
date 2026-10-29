import type { CommitInfo, WorkingTreeStatus } from "../types/models";

/** Synthetic id for the dirty working-tree pseudo-commit row. */
export const UNCOMMITTED_COMMIT_ID = "__gitlibre_uncommitted__";

export function isUncommittedCommit(commit: CommitInfo): boolean {
  return commit.id === UNCOMMITTED_COMMIT_ID;
}

export function workingTreeIsDirty(wt: WorkingTreeStatus | null | undefined): boolean {
  if (!wt) return false;
  return (
    wt.modified + wt.added + wt.deleted + wt.untracked + wt.renamed + wt.conflicted > 0
  );
}

/**
 * When the working tree is dirty, prepend a pseudo-commit on the current
 * branch lane, parented to the HEAD tip (or alone if history is empty).
 */
export function withUncommittedPseudoCommit(
  commits: CommitInfo[],
  dirty: boolean,
): CommitInfo[] {
  if (!dirty) return commits;
  if (commits.some(isUncommittedCommit)) return commits;

  const head = commits.find((commit) => commit.refs.includes("HEAD"));
  const parentId = head?.id ?? commits[0]?.id ?? null;

  const pseudo: CommitInfo = {
    id: UNCOMMITTED_COMMIT_ID,
    shortId: "•••••••",
    parents: parentId ? [parentId] : [],
    subject: "Uncommitted changes",
    authorName: "",
    authorEmail: "",
    authoredAt: "",
    refs: [],
  };
  return [pseudo, ...commits];
}

export interface GraphRow {
  commit: CommitInfo;
  /** Lane index for this commit's node. */
  lane: number;
}

export interface GraphEdge {
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  /** True when the parent is not in the loaded window (stub downward). */
  stub: boolean;
}

export interface GraphLayout {
  rows: GraphRow[];
  edges: GraphEdge[];
  laneCount: number;
}

/**
 * Assign lanes for a newest-first commit list.
 *
 * - Each first-parent chain keeps one column for its whole lifetime (no mid-graph jumping).
 * - HEAD's first-parent history always uses lane 0.
 * - New chains reuse the lowest lane whose rows are still free, so finished
 *   branches do not push later ones endlessly to the right.
 */
export function layoutCommitGraph(commits: CommitInfo[]): GraphLayout {
  const byId = new Map(commits.map((commit) => [commit.id, commit]));
  const rowOf = new Map(commits.map((commit, index) => [commit.id, index]));
  const laneOf = new Map<string, number>();
  /** Row indices already occupied by a commit node in each lane. */
  const laneRows: Array<Set<number>> = [];

  const collectUnassignedChain = (startId: string): string[] => {
    const ids: string[] = [];
    let id: string | undefined = startId;
    while (id && byId.has(id) && !laneOf.has(id)) {
      ids.push(id);
      id = byId.get(id)!.parents[0];
    }
    return ids;
  };

  /** Inclusive row span covered by a chain's nodes and vertical first-parent edges. */
  const spannedRowsFor = (chainIds: string[]): number[] => {
    if (chainIds.length === 0) return [];
    const rows = chainIds.map((id) => rowOf.get(id)!);
    const min = Math.min(...rows);
    const max = Math.max(...rows);
    const spanned: number[] = [];
    for (let row = min; row <= max; row++) spanned.push(row);
    return spanned;
  };

  const laneFreeForRows = (lane: number, rows: number[]): boolean => {
    const occupied = laneRows[lane];
    if (!occupied) return true;
    return rows.every((row) => !occupied.has(row));
  };

  const paintChain = (chainIds: string[], lane: number) => {
    while (laneRows.length <= lane) {
      laneRows.push(new Set());
    }
    for (const id of chainIds) {
      laneOf.set(id, lane);
    }
    for (const row of spannedRowsFor(chainIds)) {
      laneRows[lane].add(row);
    }
  };

  /**
   * Lowest lane whose corridor does not collide with `rows`.
   * Lane 0 is reserved for HEAD when present.
   */
  const allocateLane = (rows: number[], reservedLane0: boolean): number => {
    const start = reservedLane0 ? 1 : 0;
    for (let lane = start; lane < laneRows.length; lane++) {
      if (laneFreeForRows(lane, rows)) return lane;
    }
    return Math.max(laneRows.length, start);
  };

  // Pin the dirty working-tree node on lane 0 so it sits on the current branch.
  if (commits[0] && isUncommittedCommit(commits[0])) {
    paintChain([commits[0].id], 0);
  }

  const head = commits.find(
    (commit) => !isUncommittedCommit(commit) && commit.refs.includes("HEAD"),
  );
  if (head) {
    paintChain(collectUnassignedChain(head.id), 0);
  }

  const reservedLane0 = Boolean(head) || (commits[0] && isUncommittedCommit(commits[0]));

  for (const commit of commits) {
    if (laneOf.has(commit.id)) continue;
    const chain = collectUnassignedChain(commit.id);
    if (chain.length === 0) continue;
    const lane = allocateLane(spannedRowsFor(chain), reservedLane0);
    paintChain(chain, lane);
  }

  const rows: GraphRow[] = commits.map((commit) => ({
    commit,
    lane: laneOf.get(commit.id) ?? 0,
  }));

  let laneCount = 1;
  for (const row of rows) {
    laneCount = Math.max(laneCount, row.lane + 1);
  }

  const idToRow = new Map(rows.map((row, index) => [row.commit.id, index]));
  const edges: GraphEdge[] = [];

  for (let fromRow = 0; fromRow < rows.length; fromRow++) {
    const { commit, lane: fromLane } = rows[fromRow];
    for (const parentId of commit.parents) {
      const toRow = idToRow.get(parentId);
      if (toRow === undefined) {
        edges.push({
          fromRow,
          fromLane,
          toRow: fromRow + 1,
          toLane: fromLane,
          stub: true,
        });
        continue;
      }
      edges.push({
        fromRow,
        fromLane,
        toRow,
        toLane: rows[toRow].lane,
        stub: false,
      });
    }
  }

  return { rows, edges, laneCount };
}

const LANE_COLORS = [
  "#3d8bfd",
  "#3ecf8e",
  "#e6b84d",
  "#f07178",
  "#c792ea",
  "#89ddff",
  "#ffcb6b",
  "#82aaff",
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

/** Format a Git ISO author date in the viewer's local timezone. */
export function formatCommitTime(iso: string): string {
  const date = parseCommitDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function parseCommitDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) return date;

  // Fallback for "%ai"-style: "2024-01-02 03:04:05 +0000"
  const normalized = trimmed
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, "$1T$2")
    .replace(/ ([+-])(\d{2})(\d{2})$/, "$1$2:$3");
  date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
