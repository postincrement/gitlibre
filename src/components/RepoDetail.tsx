import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  BranchInfo,
  CommitFileChange,
  CommitInfo,
  RepoStatus,
  WorkspaceId,
} from "../types/models";
import * as api from "../lib/api";
import {
  withUncommittedPseudoCommit,
  workingTreeIsDirty,
} from "../lib/commitGraphLayout";
import {
  clampDetailPaneHeight,
  loadDetailPaneHeight,
  persistDetailPaneHeight,
} from "../lib/detailSplit";
import { CommitGraph } from "./CommitGraph";
import { CommitFilesPane } from "./CommitFilesPane";
import { VerticalSplitHandle } from "./VerticalSplitHandle";

const COMMIT_PAGE_SIZE = 100;

interface RepoDetailProps {
  workspaceId: WorkspaceId;
  status: RepoStatus | null;
  branches: BranchInfo[];
}

export function RepoDetail({ workspaceId, status, branches }: RepoDetailProps) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const [files, setFiles] = useState<CommitFileChange[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [detailHeight, setDetailHeight] = useState(() =>
    loadDetailPaneHeight(workspaceId),
  );
  const loadingMoreRef = useRef(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const detailHeightRef = useRef(detailHeight);

  useEffect(() => {
    detailHeightRef.current = detailHeight;
  }, [detailHeight]);

  useEffect(() => {
    setDetailHeight(loadDetailPaneHeight(workspaceId));
  }, [workspaceId]);

  const loadInitial = useCallback(async (repositoryId: RepoStatus["repositoryId"]) => {
    setLoading(true);
    setError(null);
    setHasMore(false);
    setSelectedCommit(null);
    setFiles([]);
    setFilesError(null);
    try {
      const page = await api.listRepositoryCommits(repositoryId, {
        limit: COMMIT_PAGE_SIZE + 1,
        skip: 0,
      });
      const more = page.length > COMMIT_PAGE_SIZE;
      setCommits(more ? page.slice(0, COMMIT_PAGE_SIZE) : page);
      setHasMore(more);
    } catch (e) {
      setCommits([]);
      setHasMore(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!status?.available || !hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await api.listRepositoryCommits(status.repositoryId, {
        limit: COMMIT_PAGE_SIZE + 1,
        skip: commits.length,
      });
      const more = page.length > COMMIT_PAGE_SIZE;
      const slice = more ? page.slice(0, COMMIT_PAGE_SIZE) : page;
      setCommits((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const appended = slice.filter((c) => !seen.has(c.id));
        return appended.length === 0 ? prev : [...prev, ...appended];
      });
      setHasMore(more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [status?.available, status?.repositoryId, hasMore, commits.length]);

  useEffect(() => {
    if (!status?.available) {
      setCommits([]);
      setError(null);
      setLoading(false);
      setLoadingMore(false);
      setHasMore(false);
      setSelectedCommit(null);
      setFiles([]);
      return;
    }

    void loadInitial(status.repositoryId);
  }, [status?.repositoryId, status?.available, status?.lastFetchSummary, loadInitial]);

  const dirty = workingTreeIsDirty(status?.workingTree);
  const graphCommits = useMemo(
    () => withUncommittedPseudoCommit(commits, dirty),
    [commits, dirty],
  );

  useEffect(() => {
    if (!selectedCommit) return;
    if (graphCommits.some((c) => c.id === selectedCommit.id)) return;
    setSelectedCommit(null);
    setFiles([]);
    setFilesError(null);
  }, [graphCommits, selectedCommit]);

  useEffect(() => {
    if (!status?.available || !selectedCommit) {
      setFiles([]);
      setFilesError(null);
      setFilesLoading(false);
      return;
    }

    let cancelled = false;
    setFilesLoading(true);
    setFilesError(null);

    void (async () => {
      try {
        const list = await api.listCommitFiles(
          status.repositoryId,
          selectedCommit.id,
        );
        if (!cancelled) {
          setFiles(list);
          setFilesLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setFiles([]);
          setFilesError(e instanceof Error ? e.message : String(e));
          setFilesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    status?.available,
    status?.repositoryId,
    selectedCommit?.id,
    // Refresh uncommitted file list when working tree counts change.
    status?.workingTree?.modified,
    status?.workingTree?.added,
    status?.workingTree?.deleted,
    status?.workingTree?.untracked,
    status?.workingTree?.renamed,
    status?.workingTree?.conflicted,
  ]);

  const onSplitDrag = useCallback((deltaY: number) => {
    const container = splitRef.current?.clientHeight ?? 0;
    setDetailHeight((prev) =>
      clampDetailPaneHeight(prev - deltaY, container),
    );
  }, []);

  const onSplitDragEnd = useCallback(() => {
    persistDetailPaneHeight(workspaceId, detailHeightRef.current);
  }, [workspaceId]);

  if (!status) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-ink-muted">
        Select a repository to inspect its status.
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-base font-semibold tracking-tight">{status.displayName}</h1>
          <span className="font-mono text-xs text-ink-muted">
            {status.detachedHead
              ? "detached HEAD"
              : (status.currentBranch ?? "—")}
          </span>
          {status.available && (
            <span
              className={[
                "text-xs",
                dirty ? "text-warning" : "text-success",
              ].join(" ")}
            >
              {dirty ? "Modified" : "Clean"}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-ink-muted" title={status.path}>
          {status.path}
        </p>
        {!status.available && (
          <Banner tone="danger">
            {status.lastError ?? "Repository is unavailable on disk."}
          </Banner>
        )}
      </div>

      {status.available ? (
        <div ref={splitRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <CommitGraph
              workspaceId={workspaceId}
              commits={graphCommits}
              branches={branches}
              selectedCommitId={selectedCommit?.id ?? null}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              error={error}
              onLoadMore={loadMore}
              onSelectCommit={setSelectedCommit}
            />
          </div>
          <VerticalSplitHandle onDrag={onSplitDrag} onDragEnd={onSplitDragEnd} />
          <div className="shrink-0 overflow-hidden border-t border-border" style={{ height: detailHeight }}>
            <CommitFilesPane
              workspaceId={workspaceId}
              repositoryId={status.repositoryId}
              commit={selectedCommit}
              files={files}
              loading={filesLoading}
              error={filesError}
            />
          </div>
        </div>
      ) : (
        <p className="p-4 text-sm text-ink-muted">Commit history unavailable.</p>
      )}
    </main>
  );
}

function Banner({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "danger" | "warning";
}) {
  return (
    <div
      className={[
        "mt-2 rounded-md border px-3 py-2 text-sm",
        tone === "danger"
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-warning/40 bg-warning/10 text-warning",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
