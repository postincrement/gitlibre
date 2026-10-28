import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  CommitFileChange,
  CommitInfo,
  RepositoryId,
  WorkspaceId,
} from "../types/models";
import * as api from "../lib/api";
import {
  formatCommitTime,
  isUncommittedCommit,
} from "../lib/commitGraphLayout";
import {
  clampCommitInfoHeight,
  clampFilesListWidth,
  loadCommitInfoHeight,
  loadFilesListWidth,
  persistCommitInfoHeight,
  persistFilesListWidth,
} from "../lib/detailSplit";
import { DiffView } from "./DiffView";
import { VerticalSplitHandle } from "./VerticalSplitHandle";

interface CommitFilesPaneProps {
  workspaceId: WorkspaceId;
  repositoryId: RepositoryId;
  commit: CommitInfo | null;
  files: CommitFileChange[];
  loading: boolean;
  error: string | null;
}

export function CommitFilesPane({
  workspaceId,
  repositoryId,
  commit,
  files,
  loading,
  error,
}: CommitFilesPaneProps) {
  const [selectedFile, setSelectedFile] = useState<CommitFileChange | null>(null);
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [filesWidth, setFilesWidth] = useState(() =>
    loadFilesListWidth(workspaceId),
  );
  const [infoHeight, setInfoHeight] = useState(() =>
    loadCommitInfoHeight(workspaceId),
  );
  const filesWidthRef = useRef(filesWidth);
  const infoHeightRef = useRef(infoHeight);

  useEffect(() => {
    filesWidthRef.current = filesWidth;
  }, [filesWidth]);
  useEffect(() => {
    infoHeightRef.current = infoHeight;
  }, [infoHeight]);

  useEffect(() => {
    setFilesWidth(loadFilesListWidth(workspaceId));
    setInfoHeight(loadCommitInfoHeight(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    setSelectedFile(null);
    setDiff("");
    setDiffError(null);
  }, [commit?.id]);

  useEffect(() => {
    if (!selectedFile) return;
    if (files.some((f) => f.path === selectedFile.path)) return;
    setSelectedFile(null);
    setDiff("");
    setDiffError(null);
  }, [files, selectedFile]);

  useEffect(() => {
    if (!commit || !selectedFile) {
      setDiff("");
      setDiffError(null);
      setDiffLoading(false);
      return;
    }

    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);

    void (async () => {
      try {
        const text = await api.getCommitFileDiff(
          repositoryId,
          commit.id,
          selectedFile.path,
          selectedFile.oldPath,
        );
        if (!cancelled) {
          setDiff(text);
          setDiffLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setDiff("");
          setDiffError(e instanceof Error ? e.message : String(e));
          setDiffLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [commit, repositoryId, selectedFile]);

  const onFilesWidthDrag = useCallback((deltaX: number) => {
    setFilesWidth((prev) => clampFilesListWidth(prev + deltaX));
  }, []);

  const onFilesWidthDragEnd = useCallback(() => {
    persistFilesListWidth(workspaceId, filesWidthRef.current);
  }, [workspaceId]);

  const onInfoHeightDrag = useCallback((deltaY: number) => {
    // Handle sits above the info pane; dragging down shrinks files / grows info.
    setInfoHeight((prev) => clampCommitInfoHeight(prev - deltaY));
  }, []);

  const onInfoHeightDragEnd = useCallback(() => {
    persistCommitInfoHeight(workspaceId, infoHeightRef.current);
  }, [workspaceId]);

  if (!commit) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-[12px] text-ink-muted">
        Select a commit to view changed files.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-surface-raised/40">
      <div
        className="flex min-h-0 shrink-0 flex-col border-r border-border"
        style={{ width: filesWidth }}
      >
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="sticky top-0 z-[1] border-b border-border bg-surface-raised/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted backdrop-blur">
            Files
          </div>
          {loading ? (
            <p className="px-3 py-2 text-[12px] text-ink-muted">Loading files…</p>
          ) : error ? (
            <p className="px-3 py-2 text-[12px] text-danger">{error}</p>
          ) : files.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-ink-muted">No files changed.</p>
          ) : (
            <ul className="py-1 text-[12px]">
              {files.map((file) => {
                const selected = file.path === selectedFile?.path;
                return (
                  <li key={`${file.status}:${file.oldPath ?? ""}:${file.path}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedFile(file)}
                      className={[
                        "flex w-full items-center gap-2 px-3 py-0.5 text-left",
                        selected
                          ? "bg-accent/20"
                          : "hover:bg-surface-overlay/60",
                      ].join(" ")}
                      title={
                        file.oldPath
                          ? `${file.oldPath} → ${file.path}`
                          : file.path
                      }
                    >
                      <span
                        className={[
                          "w-4 shrink-0 text-center font-mono text-[11px] font-semibold",
                          statusClass(file.status),
                        ].join(" ")}
                      >
                        {statusLabel(file.status)}
                      </span>
                      <span className="min-w-0 truncate font-mono text-ink">
                        {file.oldPath ? (
                          <>
                            <span className="text-ink-muted">{file.oldPath}</span>
                            <span className="text-ink-muted"> → </span>
                            {file.path}
                          </>
                        ) : (
                          file.path
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <VerticalSplitHandle
          onDrag={onInfoHeightDrag}
          onDragEnd={onInfoHeightDragEnd}
        />

        <div
          className="shrink-0 overflow-auto border-t border-border bg-surface/40"
          style={{ height: infoHeight }}
        >
          <CommitInfoPanel commit={commit} />
        </div>
      </div>

      <FilesSplitHandle onDrag={onFilesWidthDrag} onDragEnd={onFilesWidthDragEnd} />

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {!selectedFile ? (
          <div className="flex h-full items-center justify-center px-4 text-[12px] text-ink-muted">
            Select a file to view its diff.
          </div>
        ) : diffLoading ? (
          <p className="px-3 py-2 text-[12px] text-ink-muted">Loading diff…</p>
        ) : diffError ? (
          <p className="px-3 py-2 text-[12px] text-danger">{diffError}</p>
        ) : (
          <div className="h-full overflow-auto">
            <DiffView diff={diff} />
          </div>
        )}
      </div>
    </div>
  );
}

function CommitInfoPanel({ commit }: { commit: CommitInfo }) {
  const uncommitted = isUncommittedCommit(commit);

  return (
    <div className="space-y-2 px-3 py-2 text-[12px]">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
        Commit
      </div>
      <div className="font-medium leading-snug text-ink">
        {uncommitted ? "Uncommitted changes" : commit.subject}
      </div>
      {!uncommitted && (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-ink-muted">Hash</dt>
            <dd className="min-w-0 truncate font-mono text-ink" title={commit.id}>
              {commit.id}
            </dd>
            <dt className="text-ink-muted">Author</dt>
            <dd className="min-w-0 truncate text-ink">{commit.authorName || "—"}</dd>
            <dt className="text-ink-muted">Date</dt>
            <dd className="min-w-0 truncate text-ink">
              {commit.authoredAt ? formatCommitTime(commit.authoredAt) : "—"}
            </dd>
            {commit.parents.length > 0 && (
              <>
                <dt className="text-ink-muted">
                  {commit.parents.length === 1 ? "Parent" : "Parents"}
                </dt>
                <dd className="min-w-0 font-mono text-ink">
                  {commit.parents.map((p) => p.slice(0, 7)).join(", ")}
                </dd>
              </>
            )}
          </dl>
          {commit.refs.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {commit.refs.map((ref) => (
                <span
                  key={ref}
                  className={[
                    "rounded px-1 py-px text-[10px] font-medium",
                    ref === "HEAD"
                      ? "bg-accent/25 text-accent"
                      : ref.startsWith("tag:")
                        ? "bg-warning/20 text-warning"
                        : ref.includes("/")
                          ? "bg-surface-overlay text-ink-muted"
                          : "bg-success/20 text-success",
                  ].join(" ")}
                >
                  {ref}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {uncommitted && (
        <p className="text-[11px] text-ink-muted">
          Local working-tree changes that have not been committed yet.
        </p>
      )}
    </div>
  );
}

function FilesSplitHandle({
  onDrag,
  onDragEnd,
}: {
  onDrag: (deltaX: number) => void;
  onDragEnd: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const onDragRef = useRef(onDrag);
  const onDragEndRef = useRef(onDragEnd);

  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);
  useEffect(() => {
    onDragEndRef.current = onDragEnd;
  }, [onDragEnd]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startX.current = e.clientX;
    setDragging(true);

    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      onDragRef.current(ev.clientX - startX.current);
      startX.current = ev.clientX;
    };
    const onUp = () => {
      setDragging(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      onDragEndRef.current();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file list"
      onPointerDown={onPointerDown}
      className={[
        "z-20 w-1.5 shrink-0 cursor-col-resize touch-none",
        dragging ? "bg-accent/70" : "bg-border hover:bg-accent/50",
      ].join(" ")}
    />
  );
}

function statusLabel(status: string): string {
  const letter = status.charAt(0);
  if (letter === "?") return "U";
  return letter || "?";
}

function statusClass(status: string): string {
  const letter = status.charAt(0);
  switch (letter) {
    case "A":
      return "text-success";
    case "D":
      return "text-danger";
    case "R":
    case "C":
      return "text-accent";
    case "?":
      return "text-ink-muted";
    case "U":
      return "text-warning";
    default:
      return "text-warning";
  }
}
