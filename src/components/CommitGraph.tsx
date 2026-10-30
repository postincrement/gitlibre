import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { BranchInfo, CommitInfo, WorkspaceId } from "../types/models";
import {
  COMMIT_GRAPH_COLUMNS,
  clampColumnWidth,
  loadCommitGraphColumnWidths,
  persistCommitGraphColumnWidths,
  type CommitGraphColumnId,
  type CommitGraphColumnWidths,
} from "../lib/commitGraphColumns";
import {
  formatCommitTime,
  isUncommittedCommit,
  laneColor,
  layoutCommitGraph,
} from "../lib/commitGraphLayout";

const ROW_H = 22;
const LANE_W = 14;
const DOT_R = 4;
const GRAPH_PAD_X = 10;
const GRAPH_PAD_Y = ROW_H / 2;
const HEADER_H = 28;

export type CommitContextAction = "checkout" | "tag" | "branch";

interface CommitGraphProps {
  workspaceId: WorkspaceId;
  commits: CommitInfo[];
  branches: BranchInfo[];
  selectedCommitId: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  actionBusy?: boolean;
  onLoadMore: () => void;
  onSelectCommit: (commit: CommitInfo) => void;
  onCommitAction?: (action: CommitContextAction, commit: CommitInfo) => void;
}

interface CommitMenuState {
  x: number;
  y: number;
  commit: CommitInfo;
}

export function CommitGraph({
  workspaceId,
  commits,
  branches,
  selectedCommitId,
  loading,
  loadingMore,
  hasMore,
  error,
  actionBusy = false,
  onLoadMore,
  onSelectCommit,
  onCommitAction,
}: CommitGraphProps) {
  const layout = useMemo(() => layoutCommitGraph(commits), [commits]);
  const [widths, setWidths] = useState<CommitGraphColumnWidths>(() =>
    loadCommitGraphColumnWidths(workspaceId),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [viewportH, setViewportH] = useState(0);
  const [menu, setMenu] = useState<CommitMenuState | null>(null);

  const openCommitMenu = useCallback(
    (e: ReactMouseEvent, commit: CommitInfo) => {
      e.preventDefault();
      e.stopPropagation();
      if (isUncommittedCommit(commit) || !onCommitAction) return;
      onSelectCommit(commit);
      setMenu({ x: e.clientX, y: e.clientY, commit });
    },
    [onCommitAction, onSelectCommit],
  );

  useEffect(() => {
    setWidths(loadCommitGraphColumnWidths(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, commits.length === 0]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { root, rootMargin: "120px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, commits.length]);

  const graphInkWidth = GRAPH_PAD_X * 2 + layout.laneCount * LANE_W;

  const gridTemplate = useMemo(
    () =>
      [
        `${widths.graph}px`,
        `${widths.description}px`,
        `${widths.commit}px`,
        `${widths.author}px`,
        `${widths.date}px`,
      ].join(" "),
    [widths],
  );

  const columnWidthsPx = useMemo(
    () => [
      widths.graph,
      widths.description,
      widths.commit,
      widths.author,
      widths.date,
    ],
    [widths],
  );

  const totalWidth = columnWidthsPx.reduce((sum, w) => sum + w, 0);

  const resizeHandles = useMemo(() => {
    let left = 0;
    return COMMIT_GRAPH_COLUMNS.map((col, index) => {
      left += columnWidthsPx[index];
      return { columnId: col.id, left, width: columnWidthsPx[index] };
    });
  }, [columnWidthsPx]);

  const onResizeColumn = useCallback(
    (id: CommitGraphColumnId, width: number) => {
      setWidths((prev) => {
        const next = { ...prev, [id]: clampColumnWidth(id, width) };
        persistCommitGraphColumnWidths(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  /** Ahead/behind counts keyed by local branch name (vs upstream). */
  const divergenceByBranch = useMemo(() => {
    const map = new Map<string, { ahead: number; behind: number }>();
    for (const branch of branches) {
      const ahead = branch.ahead != null && branch.ahead > 0 ? branch.ahead : 0;
      const behind =
        branch.behind != null && branch.behind > 0 ? branch.behind : 0;
      if (ahead > 0 || behind > 0) {
        map.set(branch.name, { ahead, behind });
      }
    }
    return map;
  }, [branches]);

  const laneRibbons = useMemo(() => {
    const segments: { lane: number; startRow: number; endRow: number }[] = [];

    for (let lane = 0; lane < layout.laneCount; lane++) {
      const nodeRows = layout.rows
        .map((row, index) => (row.lane === lane ? index : -1))
        .filter((index) => index >= 0);
      if (nodeRows.length === 0) continue;

      const parent = new Map<number, number>();
      for (const row of nodeRows) parent.set(row, row);
      const find = (row: number): number => {
        let cur = row;
        while (parent.get(cur) !== cur) cur = parent.get(cur)!;
        return cur;
      };
      const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
      };

      for (const edge of layout.edges) {
        if (edge.stub) continue;
        if (edge.fromLane !== lane || edge.toLane !== lane) continue;
        if (parent.has(edge.fromRow) && parent.has(edge.toRow)) {
          union(edge.fromRow, edge.toRow);
        }
      }

      const groups = new Map<number, number[]>();
      for (const row of nodeRows) {
        const root = find(row);
        const list = groups.get(root);
        if (list) list.push(row);
        else groups.set(root, [row]);
      }

      for (const rows of groups.values()) {
        segments.push({
          lane,
          startRow: Math.min(...rows),
          endRow: Math.max(...rows),
        });
      }
    }

    return segments;
  }, [layout]);

  if (loading) {
    return <p className="p-4 text-sm text-ink-muted">Loading history…</p>;
  }
  if (error && commits.length === 0) {
    return <p className="p-4 text-sm text-danger">{error}</p>;
  }
  if (commits.length === 0) {
    return <p className="p-4 text-sm text-ink-muted">No commits yet.</p>;
  }

  const rowsHeight = layout.rows.length * ROW_H;
  const bodyHeight = Math.max(rowsHeight, Math.max(0, viewportH - HEADER_H));

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain">
        <div style={{ minWidth: totalWidth }}>
          <div
            className="sticky top-0 z-10 border-b border-border bg-surface-raised/95 text-[11px] font-medium uppercase tracking-wide text-ink-muted backdrop-blur"
            style={{ height: HEADER_H }}
          >
            <div
              className="relative grid h-full"
              style={{ gridTemplateColumns: gridTemplate }}
            >
              {COMMIT_GRAPH_COLUMNS.map((col) => (
                <div key={col.id} className="flex min-w-0 items-center overflow-hidden px-2">
                  <span className="truncate">{col.title}</span>
                </div>
              ))}
              {resizeHandles.map((handle) => (
                <ColumnResizeHandle
                  key={`resize-${handle.columnId}`}
                  columnId={handle.columnId}
                  left={handle.left}
                  width={handle.width}
                  onResize={onResizeColumn}
                />
              ))}
            </div>
          </div>

          <div className="relative" style={{ height: bodyHeight }}>
            <div
              className="pointer-events-none absolute top-0 bottom-0 left-0 overflow-hidden"
              style={{ width: widths.graph }}
              aria-hidden
            >
              <svg width={Math.max(graphInkWidth, widths.graph)} height={bodyHeight}>
                {laneRibbons.map((segment) => {
                  const x = GRAPH_PAD_X + segment.lane * LANE_W + LANE_W / 2;
                  const y0 = GRAPH_PAD_Y + segment.startRow * ROW_H;
                  const y1 = GRAPH_PAD_Y + segment.endRow * ROW_H;
                  if (y1 <= y0) return null;
                  return (
                    <line
                      key={`ribbon-${segment.lane}-${segment.startRow}-${segment.endRow}`}
                      x1={x}
                      y1={y0}
                      x2={x}
                      y2={y1}
                      stroke={laneColor(segment.lane)}
                      strokeWidth={1.5}
                      opacity={0.45}
                    />
                  );
                })}
                {layout.edges.map((edge, i) => {
                  const x1 = GRAPH_PAD_X + edge.fromLane * LANE_W + LANE_W / 2;
                  const y1 = GRAPH_PAD_Y + edge.fromRow * ROW_H;
                  const x2 = GRAPH_PAD_X + edge.toLane * LANE_W + LANE_W / 2;
                  const y2 = edge.stub
                    ? y1 + ROW_H * 0.85
                    : GRAPH_PAD_Y + edge.toRow * ROW_H;
                  const stroke = laneColor(
                    edge.fromLane === edge.toLane
                      ? edge.fromLane
                      : Math.min(edge.fromLane, edge.toLane),
                  );
                  const yGap = Math.min(y1 + ROW_H / 2, y2);
                  const d =
                    x1 === x2
                      ? `M ${x1} ${y1} L ${x2} ${y2}`
                      : yGap <= y1
                        ? `M ${x1} ${y1} L ${x2} ${y2}`
                        : `M ${x1} ${y1} L ${x2} ${yGap} L ${x2} ${y2}`;
                  return (
                    <path
                      key={`${edge.fromRow}-${edge.toRow}-${edge.fromLane}-${edge.toLane}-${i}`}
                      d={d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={1.5}
                      opacity={edge.stub ? 0.35 : 0.85}
                    />
                  );
                })}
                {layout.rows.map((row, index) => {
                  const cx = GRAPH_PAD_X + row.lane * LANE_W + LANE_W / 2;
                  const cy = GRAPH_PAD_Y + index * ROW_H;
                  const uncommitted = isUncommittedCommit(row.commit);
                  const color = uncommitted ? "var(--color-warning)" : laneColor(row.lane);
                  const isHead = row.commit.refs.includes("HEAD");
                  return (
                    <circle
                      key={row.commit.id}
                      cx={cx}
                      cy={cy}
                      r={isHead || uncommitted ? DOT_R + 1 : DOT_R}
                      fill={uncommitted ? "var(--color-surface)" : color}
                      stroke={color}
                      strokeWidth={uncommitted || isHead ? 2 : 1}
                    />
                  );
                })}
              </svg>
            </div>

            {layout.rows.map((row) => {
              const uncommitted = isUncommittedCommit(row.commit);
              const selected = row.commit.id === selectedCommitId;
              return (
              <div
                key={row.commit.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectCommit(row.commit)}
                onContextMenu={(e) => openCommitMenu(e, row.commit)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectCommit(row.commit);
                  }
                }}
                className={[
                  "grid cursor-pointer items-center text-[12px]",
                  selected
                    ? "bg-accent/20"
                    : uncommitted
                      ? "bg-warning/5 hover:bg-surface-overlay/60"
                      : "hover:bg-surface-overlay/60",
                ].join(" ")}
                style={{ gridTemplateColumns: gridTemplate, height: ROW_H }}
                title={
                  uncommitted
                    ? row.commit.subject
                    : `${row.commit.id}\n${row.commit.subject}`
                }
              >
                <div aria-hidden />
                <div className="flex min-w-0 items-center gap-1.5 overflow-hidden px-2">
                  <RefChips
                    refs={row.commit.refs}
                    divergenceByBranch={divergenceByBranch}
                  />
                  <span
                    className={[
                      "min-w-0 truncate text-ink",
                      uncommitted ? "font-bold" : "",
                    ].join(" ")}
                  >
                    {row.commit.subject}
                  </span>
                </div>
                <div className="truncate px-2 font-mono tabular-nums text-ink-muted">
                  {uncommitted ? "—" : row.commit.shortId}
                </div>
                <div className="truncate px-2 text-ink-muted">
                  {uncommitted ? "" : row.commit.authorName}
                </div>
                <div className="truncate px-2 tabular-nums text-ink-muted">
                  {uncommitted ? "" : formatCommitTime(row.commit.authoredAt)}
                </div>
              </div>
              );
            })}

            <div
              ref={sentinelRef}
              className="absolute right-0 bottom-0 left-0 h-1"
              aria-hidden
            />
          </div>

          {(loadingMore || hasMore) && (
            <div className="px-3 py-2 text-[11px] text-ink-muted">
              {loadingMore ? "Loading more commits…" : "Scroll for more history"}
            </div>
          )}
          {error && commits.length > 0 && (
            <div className="px-3 py-2 text-[11px] text-danger">{error}</div>
          )}
        </div>
      </div>

      {menu && onCommitAction && (
        <CommitContextMenu
          x={menu.x}
          y={menu.y}
          busy={actionBusy}
          onClose={() => setMenu(null)}
          onCheckout={() => {
            const commit = menu.commit;
            setMenu(null);
            onCommitAction("checkout", commit);
          }}
          onTag={() => {
            const commit = menu.commit;
            setMenu(null);
            onCommitAction("tag", commit);
          }}
          onBranch={() => {
            const commit = menu.commit;
            setMenu(null);
            onCommitAction("branch", commit);
          }}
        />
      )}
    </div>
  );
}

function CommitContextMenu({
  x,
  y,
  busy,
  onClose,
  onCheckout,
  onTag,
  onBranch,
}: {
  x: number;
  y: number;
  busy: boolean;
  onClose: () => void;
  onCheckout: () => void;
  onTag: () => void;
  onBranch: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Commit actions"
      className="fixed z-50 min-w-40 rounded-md border border-border bg-surface-raised py-1 text-[12px] shadow-xl shadow-black/40"
      style={{ left: x, top: y }}
    >
      <CommitMenuItem disabled={busy} onClick={onCheckout}>
        Checkout
      </CommitMenuItem>
      <CommitMenuItem disabled={busy} onClick={onTag}>
        Tag
      </CommitMenuItem>
      <CommitMenuItem disabled={busy} onClick={onBranch}>
        Branch
      </CommitMenuItem>
    </div>
  );
}

function CommitMenuItem({
  children,
  onClick,
  disabled,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className="block w-full px-2.5 py-1 text-left text-ink hover:bg-surface-overlay disabled:opacity-50"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ColumnResizeHandle({
  columnId,
  left,
  width,
  onResize,
}: {
  columnId: CommitGraphColumnId;
  left: number;
  width: number;
  onResize: (id: CommitGraphColumnId, width: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(width);
  const onResizeRef = useRef(onResize);
  const columnIdRef = useRef(columnId);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);
  useEffect(() => {
    columnIdRef.current = columnId;
  }, [columnId]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      startX.current = e.clientX;
      startWidth.current = width;
      setDragging(true);

      const previousCursor = document.body.style.cursor;
      const previousSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX.current;
        onResizeRef.current(columnIdRef.current, startWidth.current + delta);
      };
      const onUp = () => {
        setDragging(false);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [width],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${columnId} column`}
      onPointerDown={onPointerDown}
      style={{ left: left - 4 }}
      className={[
        "absolute top-0 z-30 h-full w-2 cursor-col-resize touch-none",
        dragging ? "bg-accent/70" : "bg-transparent hover:bg-accent/50",
      ].join(" ")}
    />
  );
}

function RefChips({
  refs,
  divergenceByBranch,
}: {
  refs: string[];
  divergenceByBranch: Map<string, { ahead: number; behind: number }>;
}) {
  if (refs.length === 0) return null;
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      {refs.map((ref) => {
        const isHead = ref === "HEAD";
        const isTag = ref.startsWith("tag:");
        const isRemote = ref.includes("/");
        const isBranch = !isHead && !isTag;
        // Ahead/behind only on local branch names, not origin/* chips.
        const divergence =
          isBranch && !isRemote ? divergenceByBranch.get(ref) : undefined;
        const ahead = divergence?.ahead ?? 0;
        const behind = divergence?.behind ?? 0;

        return (
          <span key={ref} className="inline-flex items-center gap-1">
            <span
              className={[
                "inline-flex items-center rounded px-1 py-px font-medium leading-tight",
                isHead
                  ? "bg-accent/25 text-accent"
                  : isTag
                    ? "bg-warning/20 text-warning"
                    : "",
              ].join(" ")}
              style={
                isBranch
                  ? {
                      backgroundColor: "var(--status-branch)",
                      color: "var(--status-branch-fg)",
                    }
                  : undefined
              }
            >
              {ref}
            </span>
            {ahead > 0 && (
              <span
                className="inline-flex items-center rounded-[3px] px-1 text-[9px] font-bold leading-none"
                style={{
                  backgroundColor: "var(--status-branch-divergence)",
                  color: "var(--status-branch-divergence-fg)",
                }}
                title={`${ahead} ahead of remote`}
                aria-label={`${ahead} ahead`}
              >
                {ahead}↑
              </span>
            )}
            {behind > 0 && (
              <span
                className="inline-flex items-center rounded-[3px] px-1 text-[9px] font-bold leading-none"
                style={{
                  backgroundColor: "var(--status-branch-divergence)",
                  color: "var(--status-branch-divergence-fg)",
                }}
                title={`${behind} behind remote`}
                aria-label={`${behind} behind`}
              >
                {behind}↓
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}
