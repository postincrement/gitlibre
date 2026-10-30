import { useCallback, useEffect, useMemo, useState } from "react";
import type { BlameLine, RepositoryId, WorkspaceId } from "../types/models";
import * as api from "../lib/api";
import { formatError } from "../lib/formatError";
import { formatCommitTime } from "../lib/commitGraphLayout";
import {
  clampFileAnnotateColumnWidth,
  FILE_ANNOTATE_COLUMNS,
  loadFileAnnotateColumnWidths,
  persistFileAnnotateColumnWidths,
  type FileAnnotateColumnId,
  type FileAnnotateColumnWidths,
} from "../lib/dialogColumnWidths";
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { Modal } from "./Modal";

interface FileAnnotateDialogProps {
  workspaceId: WorkspaceId;
  repositoryId: RepositoryId;
  path: string;
  /** Blame at this revision; omit / null for the working tree. */
  commit?: string | null;
  onClose: () => void;
}

export function FileAnnotateDialog({
  workspaceId,
  repositoryId,
  path,
  commit,
  onClose,
}: FileAnnotateDialogProps) {
  const [lines, setLines] = useState<BlameLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [widths, setWidths] = useState<FileAnnotateColumnWidths>(() =>
    loadFileAnnotateColumnWidths(workspaceId),
  );

  useEffect(() => {
    setWidths(loadFileAnnotateColumnWidths(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const list = await api.blameFile(repositoryId, path, commit ?? null);
        if (!cancelled) {
          setLines(list);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setLines([]);
          setError(formatError(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repositoryId, path, commit]);

  const gridTemplate = useMemo(
    () =>
      FILE_ANNOTATE_COLUMNS.map((col) => `${widths[col.id]}px`).join(" "),
    [widths],
  );

  const totalWidth = useMemo(
    () =>
      FILE_ANNOTATE_COLUMNS.reduce((sum, col) => sum + widths[col.id], 0),
    [widths],
  );

  const resizeHandles = useMemo(() => {
    let left = 0;
    return FILE_ANNOTATE_COLUMNS.map((col) => {
      left += widths[col.id];
      return { id: col.id, left, width: widths[col.id] };
    });
  }, [widths]);

  const onResizeColumn = useCallback(
    (id: FileAnnotateColumnId, width: number) => {
      setWidths((prev) => {
        const next = {
          ...prev,
          [id]: clampFileAnnotateColumnWidth(id, width),
        };
        persistFileAnnotateColumnWidths(workspaceId, next);
        return next;
      });
    },
    [workspaceId],
  );

  return (
    <Modal
      title={`Annotate — ${path}`}
      onClose={onClose}
      panelClassName="h-[min(85vh,52rem)] max-w-6xl"
      bodyClassName="flex min-h-0 flex-col !p-0"
    >
      <div className="min-h-0 flex-1 overflow-auto font-mono text-[12px]">
        {loading ? (
          <p className="px-4 py-3 font-sans text-sm text-ink-muted">
            Loading annotation…
          </p>
        ) : error ? (
          <p className="px-4 py-3 font-sans text-sm text-danger">{error}</p>
        ) : lines.length === 0 ? (
          <p className="px-4 py-3 font-sans text-sm text-ink-muted">
            No blame information for this file.
          </p>
        ) : (
          <div className="min-w-0" style={{ width: totalWidth }}>
            <div className="sticky top-0 z-[1] bg-surface-raised">
              <div
                className="relative grid border-b border-border font-sans text-[10px] font-medium uppercase tracking-wide text-ink-muted"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {FILE_ANNOTATE_COLUMNS.map((col) => (
                  <div
                    key={col.id}
                    className={[
                      "truncate px-2 py-2",
                      col.id === "line" ? "text-right" : "",
                    ].join(" ")}
                  >
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
            {lines.map((line) => (
              <div
                key={`${line.lineNumber}:${line.commitId}`}
                className="grid border-b border-border/40 hover:bg-surface-overlay/40"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div
                  className="truncate px-2 py-0.5 tabular-nums text-ink-muted"
                  title={line.commitId}
                >
                  {line.shortId}
                </div>
                <div
                  className="truncate px-2 py-0.5 text-ink-muted"
                  title={line.authorEmail || line.authorName}
                >
                  {line.authorName}
                </div>
                <div className="truncate px-2 py-0.5 tabular-nums text-ink-muted">
                  {formatCommitTime(line.authoredAt)}
                </div>
                <div className="truncate px-2 py-0.5 text-right tabular-nums text-ink-muted">
                  {line.lineNumber}
                </div>
                <div className="overflow-hidden whitespace-pre px-2 py-0.5 text-ink">
                  {line.content}
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
