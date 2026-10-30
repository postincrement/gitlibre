import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchInfo,
  CommitFileChange,
  CommitInfo,
  RepositoryId,
  RepoStatus,
  WorkspaceId,
} from "../types/models";
import * as api from "../lib/api";
import { formatError } from "../lib/formatError";
import type { ContentViewMode } from "../lib/contentView";
import {
  UNCOMMITTED_COMMIT_ID,
  isUncommittedCommit,
  withUncommittedPseudoCommit,
} from "../lib/commitGraphLayout";
import {
  loadSelectedCommit,
  persistSelectedCommit,
} from "../lib/commitSelection";
import {
  clampDetailPaneHeight,
  loadDetailPaneHeight,
  persistDetailPaneHeight,
} from "../lib/detailSplit";
import { CommitGraph, type CommitContextAction } from "./CommitGraph";
import { CommitFilesPane } from "./CommitFilesPane";
import { PromptModal } from "./Modal";
import { VerticalSplitHandle } from "./VerticalSplitHandle";

const COMMIT_PAGE_SIZE = 100;

const UNCOMMITTED_COMMIT: CommitInfo = {
  id: UNCOMMITTED_COMMIT_ID,
  shortId: "•••••••",
  parents: [],
  subject: "Uncommitted changes",
  authorName: "",
  authorEmail: "",
  authoredAt: "",
  refs: [],
};

interface RepoDetailProps {
  workspaceId: WorkspaceId;
  status: RepoStatus | null;
  branches: BranchInfo[];
  contentView: ContentViewMode;
  /** Refresh status (and sidebar dirty indicators) after local mutations. */
  onWorkingTreeChanged?: () => void;
}

export function RepoDetail({
  workspaceId,
  status,
  branches,
  contentView,
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
  const [statusFiles, setStatusFiles] = useState<CommitFileChange[]>([]);
  const [statusFilesLoading, setStatusFilesLoading] = useState(false);
  const [statusFilesError, setStatusFilesError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const detailHeightRef = useRef(detailHeight);
  /** Repo id whose saved commit selection still needs applying. */
  const pendingRestoreRepoRef = useRef<RepositoryId | null>(null);
  const [workingTreeReady, setWorkingTreeReady] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [prompt, setPrompt] = useState<{
    kind: "tag" | "branch";
    commit: CommitInfo;
  } | null>(null);

  useEffect(() => {
    detailHeightRef.current = detailHeight;
  }, [detailHeight]);

  useEffect(() => {
    setDetailHeight(loadDetailPaneHeight(workspaceId));
  }, [workspaceId]);

  const selectCommit = useCallback(
    (commit: CommitInfo | null) => {
      setSelectedCommit(commit);
      if (status?.repositoryId) {
        persistSelectedCommit(status.repositoryId, commit?.id ?? null);
      }
    },
    [status?.repositoryId],
  );

  const loadInitial = useCallback(async (repositoryId: RepoStatus["repositoryId"]) => {
    setLoading(true);
    setError(null);
    setHasMore(false);
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
      setError(formatError(e));
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
      setError(formatError(e));
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
      setWorkingTreeReady(false);
      pendingRestoreRepoRef.current = null;
      return;
    }

    pendingRestoreRepoRef.current = status.repositoryId;
    setWorkingTreeReady(false);
    setSelectedCommit(null);
    setFiles([]);
    void loadInitial(status.repositoryId);
  }, [status?.repositoryId, status?.available, status?.lastFetchSummary, loadInitial]);

  useEffect(() => {
    if (!status?.available) {
      setHasUncommittedFiles(false);
      setStatusFiles([]);
      setStatusFilesError(null);
      setStatusFilesLoading(false);
      setWorkingTreeReady(false);
      return;
    }

    let cancelled = false;
    if (contentView === "fileStatus") {
      setStatusFilesLoading(true);
      setStatusFilesError(null);
    }

    void (async () => {
      try {
        const list = await api.listCommitFiles(
          status.repositoryId,
          UNCOMMITTED_COMMIT_ID,
        );
        if (!cancelled) {
          setHasUncommittedFiles(list.length > 0);
          setStatusFiles(list);
          setStatusFilesLoading(false);
          setWorkingTreeReady(true);
        }
      } catch (e) {
        if (!cancelled) {
          setHasUncommittedFiles(false);
          setStatusFiles([]);
          setStatusFilesError(formatError(e));
          setStatusFilesLoading(false);
          setWorkingTreeReady(true);
        }
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
    contentView,
  ]);

  const graphCommits = useMemo(
    () => withUncommittedPseudoCommit(commits, hasUncommittedFiles),
    [commits, hasUncommittedFiles],
  );

  // Restore persisted commit selection after history + working tree are ready.
  useEffect(() => {
    if (!status?.available || loading || !workingTreeReady) return;
    if (pendingRestoreRepoRef.current !== status.repositoryId) return;

    pendingRestoreRepoRef.current = null;
    const savedId = loadSelectedCommit(status.repositoryId);

    if (savedId === UNCOMMITTED_COMMIT_ID) {
      const uncommitted = graphCommits.find(isUncommittedCommit);
      if (uncommitted) {
        setSelectedCommit(uncommitted);
        return;
      }
    } else if (savedId) {
      const found = graphCommits.find(
        (c) => c.id === savedId || c.id.startsWith(savedId),
      );
      if (found) {
        setSelectedCommit(found);
        return;
      }
      setSelectedCommit({
        id: savedId,
        shortId: savedId.slice(0, 7),
        parents: [],
        subject: savedId.slice(0, 7),
        authorName: "",
        authorEmail: "",
        authoredAt: "",
        refs: [],
      });
      return;
    }

    if (contentView === "history") {
      const uncommitted = graphCommits.find(isUncommittedCommit);
      if (uncommitted) {
        setSelectedCommit(uncommitted);
        persistSelectedCommit(status.repositoryId, uncommitted.id);
      }
    }
  }, [
    status?.available,
    status?.repositoryId,
    loading,
    workingTreeReady,
    graphCommits,
    contentView,
  ]);

  // When entering History with nothing selected, prefer Uncommitted changes.
  useEffect(() => {
    if (contentView !== "history") return;
    if (selectedCommit) return;
    if (loading || !workingTreeReady) return;
    if (pendingRestoreRepoRef.current) return;
    const uncommitted = graphCommits.find(isUncommittedCommit);
    if (!uncommitted) return;
    selectCommit(uncommitted);
  }, [
    contentView,
    selectedCommit,
    loading,
    workingTreeReady,
    graphCommits,
    selectCommit,
  ]);

  useEffect(() => {
    // Only auto-clear the synthetic uncommitted row when it disappears from the graph.
    // Real commits (e.g. parent links outside the loaded page) may stay selected.
    if (!selectedCommit || !isUncommittedCommit(selectedCommit)) return;
    if (graphCommits.some((c) => c.id === selectedCommit.id)) return;
    setSelectedCommit(null);
    setFiles([]);
    setFilesError(null);
    if (status?.repositoryId) {
      persistSelectedCommit(status.repositoryId, null);
    }
  }, [graphCommits, selectedCommit, status?.repositoryId]);

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
          setFilesError(formatError(e));
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
      setStatusFiles(list);
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
    persistSelectedCommit(status.repositoryId, null);
    pendingRestoreRepoRef.current = status.repositoryId;
    setWorkingTreeReady(false);
    await loadInitial(status.repositoryId);
    setSelectedCommit(null);
    setFiles([]);
    await refreshWorkingTree();
    setWorkingTreeReady(true);
  }, [status?.available, status?.repositoryId, loadInitial, refreshWorkingTree]);

  const refreshAfterRefChange = useCallback(async () => {
    if (!status?.available) return;
    pendingRestoreRepoRef.current = status.repositoryId;
    setWorkingTreeReady(false);
    await loadInitial(status.repositoryId);
    await refreshWorkingTree();
    setWorkingTreeReady(true);
  }, [status?.available, status?.repositoryId, loadInitial, refreshWorkingTree]);

  const handleCommitAction = useCallback(
    (action: CommitContextAction, commit: CommitInfo) => {
      if (!status?.available || isUncommittedCommit(commit) || actionBusy) return;
      if (action === "checkout") {
        void (async () => {
          setActionBusy(true);
          setError(null);
          try {
            await api.checkoutRepositoryRevision(status.repositoryId, commit.id);
            await refreshAfterRefChange();
          } catch (e) {
            setError(formatActionError(e));
          } finally {
            setActionBusy(false);
          }
        })();
        return;
      }
      setPrompt({ kind: action, commit });
    },
    [status?.available, status?.repositoryId, actionBusy, refreshAfterRefChange],
  );

  const handlePromptSubmit = useCallback(
    (name: string) => {
      if (!status?.available || !prompt || actionBusy) return;
      const { kind, commit } = prompt;
      setPrompt(null);
      void (async () => {
        setActionBusy(true);
        setError(null);
        try {
          if (kind === "branch") {
            await api.createRepositoryBranch(
              status.repositoryId,
              name,
              commit.id,
            );
          } else {
            await api.createRepositoryTag(status.repositoryId, name, commit.id);
          }
          await refreshAfterRefChange();
        } catch (e) {
          setError(formatActionError(e));
        } finally {
          setActionBusy(false);
        }
      })();
    },
    [status?.available, status?.repositoryId, prompt, actionBusy, refreshAfterRefChange],
  );

  const selectCommitById = useCallback(
    (commitId: string) => {
      const found = graphCommits.find(
        (c) => c.id === commitId || c.id.startsWith(commitId),
      );
      if (found) {
        selectCommit(found);
        return;
      }
      // Parent may be outside the loaded page — still open it by id.
      selectCommit({
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
    [graphCommits, selectCommit],
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

  if (contentView === "fileStatus") {
    return (
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CommitFilesPane
          workspaceId={workspaceId}
          repositoryId={status.repositoryId}
          commit={UNCOMMITTED_COMMIT}
          files={statusFiles}
          loading={statusFilesLoading}
          error={statusFilesError}
          pushTargetLabel={pushTargetLabel(status)}
          onWorkingTreeChanged={() => void refreshWorkingTree()}
          onCommitted={() => void refreshAfterCommit()}
        />
      </main>
    );
  }

  if (contentView === "search") {
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm font-medium text-ink">Search</p>
        <p className="max-w-sm text-sm text-ink-muted">
          Commit and file search will appear here.
        </p>
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
            actionBusy={actionBusy}
            onLoadMore={loadMore}
            onSelectCommit={selectCommit}
            onCommitAction={handleCommitAction}
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
            hideCommitComposer
            onWorkingTreeChanged={() => void refreshWorkingTree()}
            onCommitted={() => void refreshAfterCommit()}
            onSelectCommitId={selectCommitById}
          />
        </div>
      </div>
      {prompt && (
        <PromptModal
          title={prompt.kind === "branch" ? "Create Branch" : "Create Tag"}
          label={
            prompt.kind === "branch"
              ? `Branch name at ${prompt.commit.shortId}`
              : `Tag name at ${prompt.commit.shortId}`
          }
          confirmLabel="Create"
          onSubmit={handlePromptSubmit}
          onCancel={() => setPrompt(null)}
        />
      )}
    </main>
  );
}

/** Label for SourceTree-style "Push changes immediately to …". */
function pushTargetLabel(status: RepoStatus): string | null {
  if (status.detachedHead || !status.currentBranch) return null;
  const remote = status.remotes[0]?.name ?? "origin";
  return `${remote}/${status.currentBranch}`;
}

function formatActionError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return "Unexpected error";
}
