import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TopNav } from "./components/TopNav";
import { RepoSidebar } from "./components/RepoSidebar";
import { RepoDetail } from "./components/RepoDetail";
import { ConfirmModal } from "./components/Modal";
import { AccountsPanel, AddAccountForm } from "./components/AccountsPanel";
import { RepoAccountDialog } from "./components/RepoAccountDialog";
import {
  loadSidebarWidth,
  SidebarResizeHandle,
} from "./components/SidebarResizeHandle";
import { WorkspaceOpenModal } from "./components/WorkspaceOpenModal";
import * as api from "./lib/api";
import {
  onMenuAccounts,
  onMenuNewWorkspace,
  onMenuOpenWorkspace,
  onRepoFetchFinished,
  onRepoFetchProgress,
  onWorkspaceFetchFinished,
} from "./lib/events";
import type {
  AccountId,
  AppSnapshot,
  BranchInfo,
  DetectedAccount,
  RepositoryId,
  RepoStatus,
  WorkspaceId,
} from "./types/models";

function emptySnapshot(): AppSnapshot {
  return { workspaces: [], activeWorkspaceId: null, repositories: [], accounts: [] };
}

function readStartupIntent(): "open" | "create" {
  const fromQuery = new URLSearchParams(window.location.search).get("intent");
  if (fromQuery === "create") return "create";
  if (fromQuery === "open") return "open";
  try {
    const label = getCurrentWindow().label;
    if (label.includes("-create-")) return "create";
  } catch {
    // Browser preview has no Tauri window.
  }
  return "open";
}

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  /** Workspace bound to this window (one workspace per window). */
  const [windowWorkspaceId, setWindowWorkspaceId] = useState<WorkspaceId | null>(null);
  const [statuses, setStatuses] = useState<RepoStatus[]>([]);
  const [selectedId, setSelectedId] = useState<RepositoryId | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarWidth());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [showSplash, setShowSplash] = useState(true);
  const [splashMode, setSplashMode] = useState<"home" | "create">(
    readStartupIntent() === "create" ? "create" : "home",
  );
  const [splashKey, setSplashKey] = useState(0);
  const [pendingRemoveId, setPendingRemoveId] = useState<RepositoryId | null>(null);
  /** Global accounts manager (menu bar). */
  const [showAccounts, setShowAccounts] = useState(false);
  /** Repository whose per-repo account dialog is open (context menu). */
  const [accountsRepoId, setAccountsRepoId] = useState<RepositoryId | null>(null);
  const [detection, setDetection] = useState<DetectedAccount | null>(null);
  const [detectionRepoId, setDetectionRepoId] = useState<RepositoryId | null>(null);
  const [showCreateFromDetection, setShowCreateFromDetection] = useState(false);
  const detectedForRepos = useRef(new Set<RepositoryId>());
  const windowWorkspaceIdRef = useRef<WorkspaceId | null>(null);
  const selectedIdRef = useRef<RepositoryId | null>(null);

  useEffect(() => {
    windowWorkspaceIdRef.current = windowWorkspaceId;
  }, [windowWorkspaceId]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const windowWorkspace = useMemo(
    () => snapshot.workspaces.find((w) => w.id === windowWorkspaceId) ?? null,
    [snapshot.workspaces, windowWorkspaceId],
  );

  const refreshBranches = useCallback(
    async (repositoryId: RepositoryId | null, remotes?: RepoStatus["remotes"]) => {
      if (!repositoryId) {
        setBranches([]);
        return;
      }
      const remoteName =
        remotes?.find((r) => r.name === "origin")?.name ?? remotes?.[0]?.name ?? null;
      try {
        const list = await api.listRepositoryBranches(repositoryId, remoteName);
        setBranches(list);
      } catch {
        setBranches([]);
      }
    },
    [],
  );

  const refreshStatuses = useCallback(
    async (workspaceId: WorkspaceId) => {
      try {
        const list = await api.listWorkspaceStatuses(workspaceId);
        setStatuses(list);
        setSelectedId((prev) => {
          const next =
            prev && list.some((s) => s.repositoryId === prev)
              ? prev
              : (list[0]?.repositoryId ?? null);
          const remotes = list.find((s) => s.repositoryId === next)?.remotes;
          void refreshBranches(next, remotes);
          return next;
        });
      } catch (e) {
        setError(formatError(e));
      }
    },
    [refreshBranches],
  );

  useEffect(() => {
    const remotes = statuses.find((s) => s.repositoryId === selectedId)?.remotes;
    void refreshBranches(selectedId, remotes);
    // Only when the selected repository changes; status refreshes call refreshBranches themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, refreshBranches]);

  const refreshSnapshot = useCallback(async () => {
    const snap = await api.getSnapshot();
    setSnapshot(snap);
    return snap;
  }, []);

  const bindWorkspace = useCallback(
    async (id: WorkspaceId) => {
      await api.setActiveWorkspace(id);
      await refreshSnapshot();
      setWindowWorkspaceId(id);
      setShowSplash(false);
      await refreshStatuses(id);
    },
    [refreshSnapshot, refreshStatuses],
  );

  useEffect(() => {
    void (async () => {
      try {
        await refreshSnapshot();
        setLoadState("ready");
      } catch (e) {
        setLoadState("error");
        setError(formatError(e));
      }
    })();
  }, [refreshSnapshot]);

  // When opening a repo with no assigned account, extract hints from remotes/config.
  useEffect(() => {
    if (!selectedId || loadState !== "ready" || !windowWorkspaceId) return;
    const repo = snapshot.repositories.find((r) => r.id === selectedId);
    if (!repo || repo.accountId) return;
    if (detectedForRepos.current.has(selectedId)) return;
    detectedForRepos.current.add(selectedId);

    let cancelled = false;
    void (async () => {
      try {
        const detected = await api.detectRepositoryAccount(selectedId);
        if (cancelled) return;
        if (detected.matchedAccountId) {
          await refreshSnapshot();
          setDetection(null);
          setDetectionRepoId(null);
          return;
        }
        if (
          detected.primaryRemoteUrl ||
          detected.suggestedUsername ||
          detected.commitName ||
          detected.commitEmail
        ) {
          setDetection(detected);
          setDetectionRepoId(selectedId);
        }
      } catch {
        // Detection is best-effort; ignore failures while browsing.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId, loadState, snapshot.repositories, windowWorkspaceId, refreshSnapshot]);

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
          void api.getRepositoryStatus(event.repositoryId).then((fresh) => {
            if (cancelled) return;
            setStatuses((prev) =>
              prev.map((s) => (s.repositoryId === fresh.repositoryId ? fresh : s)),
            );
            if (fresh.repositoryId === selectedIdRef.current) {
              void refreshBranches(fresh.repositoryId, fresh.remotes);
            }
          });
        }),
      );
      unlisteners.push(
        await onWorkspaceFetchFinished(() => {
          if (cancelled) return;
          setBusy(false);
          const id = windowWorkspaceIdRef.current;
          if (id) {
            void refreshStatuses(id);
            if (selectedIdRef.current) void refreshBranches(selectedIdRef.current);
          }
        }),
      );
      unlisteners.push(
        await onMenuOpenWorkspace(() => {
          if (cancelled) return;
          if (windowWorkspaceIdRef.current) {
            void api.openWorkspaceWindow("open");
            return;
          }
          setSplashMode("home");
          setSplashKey((k) => k + 1);
          setShowSplash(true);
        }),
      );
      unlisteners.push(
        await onMenuNewWorkspace(() => {
          if (cancelled) return;
          if (windowWorkspaceIdRef.current) {
            void api.openWorkspaceWindow("create");
            return;
          }
          setSplashMode("create");
          setSplashKey((k) => k + 1);
          setShowSplash(true);
        }),
      );
      unlisteners.push(
        await onMenuAccounts(() => {
          if (cancelled) return;
          setShowAccounts(true);
        }),
      );
    }

    void bind();
    return () => {
      cancelled = true;
      for (const off of unlisteners) off();
    };
  }, [refreshStatuses, refreshBranches]);

  const selected = useMemo(
    () => statuses.find((s) => s.repositoryId === selectedId) ?? null,
    [statuses, selectedId],
  );

  useEffect(() => {
    if (!windowWorkspace) return;
    const title = selected
      ? `${windowWorkspace.name} / ${selected.displayName}`
      : windowWorkspace.name;
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => {
        // Title updates are best-effort (e.g. browser-only preview).
      });
  }, [windowWorkspace, selected]);

  async function handleCreateWorkspace(name: string) {
    setError(null);
    try {
      const workspace = await api.createWorkspace(name);
      await bindWorkspace(workspace.id);
    } catch (e) {
      setError(formatError(e));
      throw e;
    }
  }

  async function handleOpenWorkspace(id: WorkspaceId) {
    try {
      setError(null);
      await bindWorkspace(id);
    } catch (e) {
      setError(formatError(e));
      throw e;
    }
  }

  async function handleAddRepository() {
    if (!windowWorkspaceId) return;
    try {
      setError(null);
      const path = await api.pickDirectory();
      if (!path) return;
      const result = await api.addRepository(windowWorkspaceId, path);
      await refreshSnapshot();
      await refreshStatuses(windowWorkspaceId);
      setSelectedId(result.repository.id);
      if (result.detection && !result.autoAssignedAccountId) {
        setDetection(result.detection);
        setDetectionRepoId(result.repository.id);
        setShowCreateFromDetection(false);
      } else {
        setDetection(null);
        setDetectionRepoId(null);
      }
    } catch (e) {
      setError(formatError(e));
    }
  }

  async function handlePopulateFromRemote(
    repoId: RepositoryId,
    remoteName: string,
  ) {
    setError(null);
    setBusy(true);
    try {
      detectedForRepos.current.delete(repoId);
      const detected = await api.detectRepositoryAccount(repoId, remoteName);
      detectedForRepos.current.add(repoId);
      await refreshSnapshot();
      if (windowWorkspaceId) await refreshStatuses(windowWorkspaceId);
      if (detected.matchedAccountId) {
        setDetection(null);
        setDetectionRepoId(null);
        return;
      }
      setDetection(detected);
      setDetectionRepoId(repoId);
      setShowCreateFromDetection(true);
    } catch (e) {
      setError(formatError(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveRepository() {
    if (!pendingRemoveId || !windowWorkspaceId) return;
    try {
      setError(null);
      const id = pendingRemoveId;
      setPendingRemoveId(null);
      const snap = await api.removeRepository(windowWorkspaceId, id);
      setSnapshot(snap);
      await refreshStatuses(windowWorkspaceId);
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
    if (!windowWorkspaceId) return;
    try {
      setError(null);
      setBusy(true);
      await api.fetchWorkspace(windowWorkspaceId);
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  }

  async function handleAssignAccount(
    repoId: RepositoryId,
    accountId: AccountId | null,
  ) {
    try {
      setError(null);
      await api.setRepositoryAccount(repoId, accountId);
      await refreshSnapshot();
      if (windowWorkspaceId) await refreshStatuses(windowWorkspaceId);
      if (accountId) {
        setDetection(null);
        setDetectionRepoId(null);
      }
    } catch (e) {
      setError(formatError(e));
    }
  }

  const accountsRepoContext = useMemo(() => {
    if (!accountsRepoId) return null;
    const fromStatus = statuses.find((s) => s.repositoryId === accountsRepoId);
    if (fromStatus) {
      return {
        id: fromStatus.repositoryId,
        displayName: fromStatus.displayName,
        accountId: fromStatus.accountId,
      };
    }
    const fromRegistry = snapshot.repositories.find((r) => r.id === accountsRepoId);
    if (fromRegistry) {
      return {
        id: fromRegistry.id,
        displayName: fromRegistry.displayName,
        accountId: fromRegistry.accountId,
      };
    }
    return null;
  }, [accountsRepoId, statuses, snapshot.repositories]);

  if (loadState === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-ink-muted">
        Loading GitLibre…
      </div>
    );
  }

  const accountsDialog = showAccounts ? (
    <AccountsPanel
      accounts={snapshot.accounts}
      onClose={() => setShowAccounts(false)}
      onChanged={async () => {
        await refreshSnapshot();
        if (windowWorkspaceId) await refreshStatuses(windowWorkspaceId);
      }}
    />
  ) : null;

  if (showSplash || !windowWorkspaceId) {
    return (
      <>
        <WorkspaceOpenModal
          key={splashKey}
          workspaces={snapshot.workspaces}
          initialSelectedId={snapshot.activeWorkspaceId}
          initialMode={splashMode}
          onOpen={handleOpenWorkspace}
          onCreate={handleCreateWorkspace}
        />
        {accountsDialog}
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopNav
        workspaceName={windowWorkspace?.name ?? null}
        repoName={selected?.displayName ?? null}
        canFetchRepo={Boolean(selected?.available)}
        repoFetching={Boolean(selected?.isFetching)}
        busy={busy}
        onFetchRepo={handleFetchOne}
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
          branches={branches}
          width={sidebarWidth}
          busy={busy}
          onSelect={setSelectedId}
          onAddRepository={handleAddRepository}
          onManageAccounts={(id) => setAccountsRepoId(id)}
          onRemoveRepository={(id) => setPendingRemoveId(id)}
        />
        <SidebarResizeHandle width={sidebarWidth} onResize={setSidebarWidth} />
        <RepoDetail workspaceId={windowWorkspaceId} status={selected} />
      </div>
      {accountsRepoContext && (
        <RepoAccountDialog
          repository={accountsRepoContext}
          accounts={snapshot.accounts}
          remotes={
            statuses.find((s) => s.repositoryId === accountsRepoContext.id)
              ?.remotes ?? []
          }
          busy={busy}
          onAssignAccount={(accountId) =>
            handleAssignAccount(accountsRepoContext.id, accountId)
          }
          onPopulateFromRemote={(remoteName) =>
            handlePopulateFromRemote(accountsRepoContext.id, remoteName)
          }
          onClose={() => {
            setAccountsRepoId(null);
            setDetection(null);
            setDetectionRepoId(null);
          }}
        />
      )}
      {accountsDialog}
      {showCreateFromDetection && detection && (
        <AddAccountForm
          draft={detection}
          title="Create account from repository"
          onCancel={() => setShowCreateFromDetection(false)}
          onCreated={async (account) => {
            setShowCreateFromDetection(false);
            const repoId = detectionRepoId ?? accountsRepoId;
            if (repoId) {
              await api.setRepositoryAccount(repoId, account.id);
            }
            setDetection(null);
            setDetectionRepoId(null);
            await refreshSnapshot();
            if (windowWorkspaceId) await refreshStatuses(windowWorkspaceId);
          }}
        />
      )}
      {pendingRemoveId && (
        <ConfirmModal
          title="Remove repository"
          message="Remove this repository from the workspace? Files on disk will not be deleted."
          confirmLabel="Remove"
          danger
          onCancel={() => setPendingRemoveId(null)}
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
