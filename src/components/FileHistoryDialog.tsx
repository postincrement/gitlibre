import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommitInfo, RepositoryId, WorkspaceId } from "../types/models";
import * as api from "../lib/api";
import { formatCommitTime } from "../lib/commitGraphLayout";
import {
  clampFileLogColumnWidth,
  FILE_LOG_COLUMNS,
  loadFileLogColumnWidths,
  persistFileLogColumnWidths,
  type FileLogColumnId,
  type FileLogColumnWidths,
} from "../lib/dialogColumnWidths";
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { Modal } from "./Modal";

interface FileHistoryDialogProps {
  workspaceId: WorkspaceId;
  repositoryId: RepositoryId;
  path: string;
  /** Limit history to this commit and ancestors when set. */
  startCommit?: string | null;
  onClose: () => void;
}

export function FileHistoryDialog({
  workspaceId,
  repositoryId,
  path,
  startCommit,
  onClose,
}: FileHistoryDialogProps) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [widths, setWidths] = useState<FileLogColumnWidths>(() =>
    loadFileLogColumnWidths(workspaceId),
  );

  useEffect(() => {
    setWidths(loadFileLogColumnWidths(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await api.listFileCommits(repositoryId, path, {
          startCommit: startCommit ?? null,
          limit: 500,
        });
        if (!cancelled) {
          setCommits(list);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setCommits([]);
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repositoryId, path, startCommit]);

  const gridTemplate = useMemo(
    () =>
      FILE_LOG_COLUMNS.map((col) => `${widths[col.id]}px`).join(" "),
    [widths],
  );

  const totalWidth = useMemo(
    () => FILE_LOG_COLUMNS.reduce((sum, col) => sum + widths[col.id], 0),
    [widths],
  );

  const resizeHandles = useMemo(() => {
    let left = 0;
    return FILE_LOG_COLUMNS.map((col) => {
      left += widths[col.id];
      return { id: col.id, left, width: widths[col.id] };
    });
  }, [widths]);

  const onResizeColumn = useCallback(
    (id: FileLogColumnId, width: number) => {
      setWidths((prev) => {
        const next = { ...prev, [id]: clampFileLogColumnWidth(id, width) };
        persistFileLogColumnWidths(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  return (
    <Modal
      title={`Log — ${path}`}
      onClose={onClose}
      panelClassName="h-[min(85vh,52rem)] max-w-4xl"
      bodyClassName="flex min-h-0 flex-col !p-0"
    >
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-4 py-3 text-sm text-ink-muted">Loading history…</p>
        ) : error ? (
          <p className="px-4 py-3 text-sm text-danger">{error}</p>
        ) : commits.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-muted">
            No commits found for this file.
          </p>
        ) : (
          <div className="min-w-0" style={{ width: totalWidth }}>
            <div className="sticky top-0 z-[1] bg-surface-raised">
              <div
                className="relative grid border-b border-border text-[10px] font-medium uppercase tracking-wide text-ink-muted"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {FILE_LOG_COLUMNS.map((col) => (
                  <div key={col.id} className="truncate px-3 py-2">
                    {col.title}
                  </div>
                ))}
                {resizeHandles.map((handle) => (
                  <ColumnResizeHandle
                    key={handle.id}
                    left={handle.left}
                    width={handle.width}
                    label={`Resize ${handle.id} column`}
                    onResize={(width) => onResizeColumn(handle.id, width)}
                  />
                ))}
              </div>
            </div>
            {commits.map((commit) => (
              <div
                key={commit.id}
                className="grid border-b border-border/60 text-[12px] hover:bg-surface-overlay/50"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="truncate px-3 py-1.5 font-mono tabular-nums text-ink-muted">
                  {commit.shortId}
                </div>
                <div
                  className="truncate px-3 py-1.5 text-ink"
                  title={commit.subject}
                >
                  {commit.subject}
                </div>
                <div className="truncate px-3 py-1.5 text-ink-muted">
                  {commit.authorName}
                </div>
                <div className="truncate px-3 py-1.5 tabular-nums text-ink-muted">
                  {formatCommitTime(commit.authoredAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 justify-end border-t border-border px-4 py-3">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
