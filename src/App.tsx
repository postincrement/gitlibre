import { useCallback, useEffect, useMemo, useState } from "react";
import { TopNav } from "./components/TopNav";
import { RepoSidebar } from "./components/RepoSidebar";
import { RepoDetail } from "./components/RepoDetail";
import { ConfirmModal, PromptModal } from "./components/Modal";
import { AccountsPanel } from "./components/AccountsPanel";
import * as api from "./lib/api";
import {
  onRepoFetchFinished,
  onRepoFetchProgress,
  onWorkspaceFetchFinished,
} from "./lib/events";
import type {
  AccountId,
  AppSnapshot,
  RepositoryId,
  RepoStatus,
  WorkspaceId,
} from "./types/models";

function emptySnapshot(): AppSnapshot {
  return { workspaces: [], activeWorkspaceId: null, repositories: [], accounts: [] };
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [statuses, setStatuses] = useState<RepoStatus[]>([]);
  const [selectedId, setSelectedId] = useState<RepositoryId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);

  const refreshStatuses = useCallback(async () => {
    try {
      const list = await api.listWorkspaceStatuses();
      setStatuses(list);
      setSelectedId((prev) => {
        if (prev && list.some((s) => s.repositoryId === prev)) return prev;
        return list[0]?.repositoryId ?? null;
      });
    } catch (e) {
      setError(formatError(e));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const snap = await api.getSnapshot();
      setSnapshot(snap);
      setLoadState("ready");
      if (snap.activeWorkspaceId) {
        await refreshStatuses();
      } else {
        setStatuses([]);
        setSelectedId(null);
      }
    } catch (e) {
      setLoadState("error");
      setError(formatError(e));
    }
  }, [refreshStatuses]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    async function bind() {
      unlisteners.push(
        await onRepoFetchProgress((event) => {
          if (cancelled) return;
          setStatuses((prev) =>
            prev.map((s) =>
              s.repositoryId === event.repositoryId
                ? { ...s, isFetching: true }
                : s,
            ),
          );
        }),
      );
      unlisteners.push(
        await onRepoFetchFinished((event) => {
          if (cancelled) return;
          setStatuses((prev) =>
            prev.map((s) =>
              s.repositoryId === event.repositoryId
                ? {
                    ...s,
                    isFetching: false,
                    lastFetchSummary: event.summary,
                    lastError: event.error?.message ?? null,
                  }
                : s,
            ),
          );
          // Refresh Git status for the finished repo without assuming selection.
          void api.getRepositoryStatus(event.repositoryId).then((fresh) => {
            if (cancelled) return;
            setStatuses((prev) =>
              prev.map((s) => (s.repositoryId === fresh.repositoryId ? fresh : s)),
            );
          });
        }),
      );
      unlisteners.push(
        await onWorkspaceFetchFinished(() => {
          if (cancelled) return;
          setBusy(false);
          void refreshStatuses();
        }),
      );
    }

    void bind();
    return () => {
      cancelled = true;
      for (const off of unlisteners) off();
    };
  }, [refreshStatuses]);

  const selected = useMemo(
    () => statuses.find((s) => s.repositoryId === selectedId) ?? null,
    [statuses, selectedId],
  );

  async function handleCreateWorkspace(name: string) {
    try {
      setError(null);
      setShowCreateWorkspace(false);
      await api.createWorkspace(name);
      await refreshAll();
    } catch (e) {
      setError(formatError(e));
    }
  }

  async function handleSelectWorkspace(id: WorkspaceId) {
    try {
      setError(null);
      const snap = await api.setActiveWorkspace(id);
      setSnapshot(snap);
      await refreshStatuses();
    } catch (e) {
      setError(formatError(e));
    }
  }

  async function handleAddRepository() {
    try {
      setError(null);
      const path = await api.pickDirectory();
      if (!path) return;
      await api.addRepository(path);
      await refreshAll();
    } catch (e) {
      setError(formatError(e));
    }
  }

  async function handleRemoveRepository() {
    if (!selectedId) return;
    try {
      setError(null);
      setShowRemoveConfirm(false);
      const snap = await api.removeRepository(selectedId);
      setSnapshot(snap);
      await refreshStatuses();
    } catch (e) {
      setError(formatError(e));
    }
  }

  async function handleFetchOne() {
    if (!selectedId) return;
    try {
      setError(null);
      setBusy(true);
      await api.fetchRepository(selectedId);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleFetchAll() {
    try {
      setError(null);
      setBusy(true);
      await api.fetchWorkspace();
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  }

  async function handleAssignAccount(accountId: AccountId | null) {
    if (!selectedId) return;
    try {
      setError(null);
      await api.setRepositoryAccount(selectedId, accountId);
      await refreshAll();
    } catch (e) {
      setError(formatError(e));
    }
  }

  if (loadState === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        Loading GitLibre…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopNav
        workspaces={snapshot.workspaces}
        activeWorkspaceId={snapshot.activeWorkspaceId}
        busy={busy}
        onSelectWorkspace={handleSelectWorkspace}
        onAddWorkspace={() => setShowCreateWorkspace(true)}
        onAddRepository={handleAddRepository}
        onManageAccounts={() => setShowAccounts(true)}
        onFetchAll={handleFetchAll}
      />
      {error && (
        <div className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <RepoSidebar
          statuses={statuses}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <RepoDetail
          status={selected}
          accounts={snapshot.accounts}
          onFetch={handleFetchOne}
          onRemove={() => setShowRemoveConfirm(true)}
          onAssignAccount={handleAssignAccount}
          busy={busy}
        />
      </div>
      {showAccounts && (
        <AccountsPanel
          accounts={snapshot.accounts}
          onClose={() => setShowAccounts(false)}
          onChanged={refreshAll}
        />
      )}
      {showCreateWorkspace && (
        <PromptModal
          title="New workspace"
          label="Workspace name"
          initialValue="ScryPOS"
          confirmLabel="Create"
          onCancel={() => setShowCreateWorkspace(false)}
          onSubmit={handleCreateWorkspace}
        />
      )}
      {showRemoveConfirm && (
        <ConfirmModal
          title="Remove repository"
          message="Remove this repository from the workspace? Files on disk will not be deleted."
          confirmLabel="Remove"
          danger
          onCancel={() => setShowRemoveConfirm(false)}
          onConfirm={handleRemoveRepository}
        />
      )}
    </div>
  );
}

function formatError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return "Unexpected error";
}
