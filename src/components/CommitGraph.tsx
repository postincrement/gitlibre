import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CommitInfo, WorkspaceId } from "../types/models";
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
  laneColor,
  layoutCommitGraph,
} from "../lib/commitGraphLayout";

const ROW_H = 28;
const LANE_W = 14;
const DOT_R = 4;
const GRAPH_PAD_X = 10;
const GRAPH_PAD_Y = ROW_H / 2;
const HEADER_H = 28;

interface CommitGraphProps {
  workspaceId: WorkspaceId;
  commits: CommitInfo[];
  loading: boolean;
  error: string | null;
}

export function CommitGraph({
  workspaceId,
  commits,
  loading,
  error,
}: CommitGraphProps) {
  const layout = useMemo(() => layoutCommitGraph(commits), [commits]);
  const [widths, setWidths] = useState<CommitGraphColumnWidths>(() =>
    loadCommitGraphColumnWidths(workspaceId),
  );

  useEffect(() => {
    setWidths(loadCommitGraphColumnWidths(workspaceId));
  }, [workspaceId]);

  // Lane count must not change column widths — those are workspace preferences.
  // Wide graphs clip (or scroll) inside the graph column instead.
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

  if (loading) {
    return <p className="p-4 text-sm text-ink-muted">Loading history…</p>;
  }
  if (error) {
    return <p className="p-4 text-sm text-danger">{error}</p>;
  }
  if (commits.length === 0) {
    return <p className="p-4 text-sm text-ink-muted">No commits yet.</p>;
  }

  const bodyHeight = layout.rows.length * ROW_H;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
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
              {/* Handles sit above every header cell so neighboring columns cannot steal hits. */}
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
                  const midY = (y1 + y2) / 2;
                  const d =
                    x1 === x2
                      ? `M ${x1} ${y1} L ${x2} ${y2}`
                      : `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
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
                  const color = laneColor(row.lane);
                  const isHead = row.commit.refs.includes("HEAD");
                  return (
                    <circle
                      key={row.commit.id}
                      cx={cx}
                      cy={cy}
                      r={isHead ? DOT_R + 1 : DOT_R}
                      fill={color}
                      stroke={isHead ? "var(--color-ink)" : "var(--color-surface)"}
                      strokeWidth={isHead ? 2 : 1}
                    />
                  );
                })}
              </svg>
            </div>

            {layout.rows.map((row) => (
              <div
                key={row.commit.id}
                className="grid items-center border-b border-border/40 text-[12px] hover:bg-surface-overlay/60"
                style={{ gridTemplateColumns: gridTemplate, height: ROW_H }}
                title={`${row.commit.id}\n${row.commit.subject}`}
              >
                <div aria-hidden />
                <div className="flex min-w-0 items-center gap-1.5 overflow-hidden px-2">
                  <RefChips refs={row.commit.refs} />
                  <span className="min-w-0 truncate text-ink">{row.commit.subject}</span>
                </div>
                <div
                  className="truncate px-2 font-mono tabular-nums"
                  style={{ color: laneColor(row.lane) }}
                >
                  {row.commit.shortId}
                </div>
                <div className="truncate px-2 text-ink-muted">{row.commit.authorName}</div>
                <div className="truncate px-2 tabular-nums text-ink-muted">
                  {formatCommitTime(row.commit.authoredAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ColumnResizeHandle({
  columnId,
  left,
  width,
  onResize,
}: {
  columnId: CommitGraphColumnId;
  /** Right edge of the column, in px from the header origin. */
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

function RefChips({ refs }: { refs: string[] }) {
  if (refs.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {refs.map((ref) => {
        const isHead = ref === "HEAD";
        const isTag = ref.startsWith("tag:");
        const isRemote = ref.includes("/");
        return (
          <span
            key={ref}
            className={[
              "rounded px-1 py-px font-medium leading-tight",
              isHead
                ? "bg-accent/25 text-accent"
                : isTag
                  ? "bg-warning/20 text-warning"
                  : isRemote
                    ? "bg-surface-overlay text-ink-muted"
                    : "bg-success/20 text-success",
            ].join(" ")}
          >
            {ref}
          </span>
        );
      })}
    </span>
  );
}
