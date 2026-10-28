import type { CommitInfo } from "../types/models";

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
 * Assign lanes (columns) for a newest-first commit list and build parent edges.
 * The current branch (commit decorated with HEAD) is kept in lane 0.
 */
export function layoutCommitGraph(commits: CommitInfo[]): GraphLayout {
  const headId = commits.find((c) => c.refs.includes("HEAD"))?.id ?? null;

  // Reserve lane 0 for HEAD so other tips open to the right.
  const active: (string | null)[] = headId ? [headId] : [];
  const rows: GraphRow[] = [];
  let laneCount = 1;

  for (const commit of commits) {
    let lane = active.indexOf(commit.id);
    if (lane === -1) {
      // Never place a new tip in lane 0 while HEAD still owns it.
      lane = findFreeLane(active, headId);
      if (lane === active.length) {
        active.push(commit.id);
      } else {
        active[lane] = commit.id;
      }
    }

    rows.push({ commit, lane });
    laneCount = Math.max(laneCount, active.length, lane + 1);

    active[lane] = null;

    commit.parents.forEach((parent, parentIndex) => {
      if (active.includes(parent)) return;
      if (parentIndex === 0) {
        active[lane] = parent;
        return;
      }
      const spot = findFreeLane(active, headId);
      if (spot === active.length) {
        active.push(parent);
      } else {
        active[spot] = parent;
      }
    });

    laneCount = Math.max(laneCount, active.length);
  }

  remapLaneToLeft(rows, headId);

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

  for (const row of rows) {
    laneCount = Math.max(laneCount, row.lane + 1);
  }

  return { rows, edges, laneCount };
}

/** Prefer empty slots to the right of lane 0 when HEAD still occupies / reserved it. */
function findFreeLane(active: (string | null)[], headId: string | null): number {
  for (let i = 0; i < active.length; i++) {
    if (active[i] !== null) continue;
    // Keep lane 0 free only for the HEAD chain while HEAD tip is still pending.
    if (i === 0 && headId && active.includes(headId)) continue;
    return i;
  }
  return active.length;
}

/** Ensure the HEAD commit's lane is 0 by swapping if needed. */
function remapLaneToLeft(rows: GraphRow[], headId: string | null) {
  if (!headId) return;
  const headRow = rows.find((r) => r.commit.id === headId);
  if (!headRow || headRow.lane === 0) return;
  const from = headRow.lane;
  for (const row of rows) {
    if (row.lane === from) row.lane = 0;
    else if (row.lane === 0) row.lane = from;
  }
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

export function formatCommitTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
