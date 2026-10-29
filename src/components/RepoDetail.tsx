import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchInfo,
  CommitFileChange,
  CommitInfo,
  RepoStatus,
  WorkspaceId,
} from "../types/models";
import * as api from "../lib/api";
import {
  UNCOMMITTED_COMMIT_ID,
  isUncommittedCommit,
  withUncommittedPseudoCommit,
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
  /** Refresh status (and sidebar dirty indicators) after local mutations. */
  onWorkingTreeChanged?: () => void;
}

export function RepoDetail({
  workspaceId,
  status,
  branches,
  onWorkingTreeChanged,
}: RepoDetailProps) {
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
  /** True only when porcelain reports at least one changed path. */
  const [hasUncommittedFiles, setHasUncommittedFiles] = useState(false);
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

  useEffect(() => {
    if (!status?.available) {
      setHasUncommittedFiles(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const list = await api.listCommitFiles(
          status.repositoryId,
          UNCOMMITTED_COMMIT_ID,
        );
        if (!cancelled) setHasUncommittedFiles(list.length > 0);
      } catch {
        if (!cancelled) setHasUncommittedFiles(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    status?.available,
    status?.repositoryId,
    status?.lastFetchSummary,
    status?.workingTree?.modified,
    status?.workingTree?.added,
    status?.workingTree?.deleted,
    status?.workingTree?.untracked,
    status?.workingTree?.renamed,
    status?.workingTree?.conflicted,
  ]);

  const graphCommits = useMemo(
    () => withUncommittedPseudoCommit(commits, hasUncommittedFiles),
    [commits, hasUncommittedFiles],
  );

  useEffect(() => {
    // Only auto-clear the synthetic uncommitted row when it disappears from the graph.
    // Real commits (e.g. parent links outside the loaded page) may stay selected.
    if (!selectedCommit || !isUncommittedCommit(selectedCommit)) return;
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

  const refreshWorkingTree = useCallback(async () => {
    if (!status?.available) return;
    try {
      const list = await api.listCommitFiles(
        status.repositoryId,
        UNCOMMITTED_COMMIT_ID,
      );
      setHasUncommittedFiles(list.length > 0);
      if (selectedCommit?.id === UNCOMMITTED_COMMIT_ID) {
        setFiles(list);
      }
    } catch {
      /* parent status refresh will recover */
    }
    onWorkingTreeChanged?.();
  }, [
    status?.available,
    status?.repositoryId,
    selectedCommit?.id,
    onWorkingTreeChanged,
  ]);

  const refreshAfterCommit = useCallback(async () => {
    if (!status?.available) return;
    await loadInitial(status.repositoryId);
    setSelectedCommit(null);
    setFiles([]);
    await refreshWorkingTree();
  }, [status?.available, status?.repositoryId, loadInitial, refreshWorkingTree]);

  const selectCommitById = useCallback(
    (commitId: string) => {
      const found = graphCommits.find(
        (c) => c.id === commitId || c.id.startsWith(commitId),
      );
      if (found) {
        setSelectedCommit(found);
        return;
      }
      // Parent may be outside the loaded page — still open it by id.
      setSelectedCommit({
        id: commitId,
        shortId: commitId.slice(0, 7),
        parents: [],
        subject: commitId.slice(0, 7),
        authorName: "",
        authorEmail: "",
        authoredAt: "",
        refs: [],
      });
    },
    [graphCommits],
  );

  if (!status) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-ink-muted">
        Select a repository to inspect its status.
      </main>
    );
  }

  if (!status.available) {
    return (
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {status.lastError ?? "Repository is unavailable on disk."}
        </div>
        <p className="mt-3 text-sm text-ink-muted">Commit history unavailable.</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
        <div
          className="shrink-0 overflow-hidden border-t border-border"
          style={{ height: detailHeight }}
        >
          <CommitFilesPane
            workspaceId={workspaceId}
            repositoryId={status.repositoryId}
            commit={selectedCommit}
            files={files}
            loading={filesLoading}
            error={filesError}
            onWorkingTreeChanged={() => void refreshWorkingTree()}
            onCommitted={() => void refreshAfterCommit()}
            onSelectCommitId={selectCommitById}
          />
        </div>
      </div>
    </main>
  );
}
