import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchInfo,
  RepositoryId,
  RepoStatus,
  WorkspaceId,
} from "../types/models";
import * as api from "../lib/api";
import {
  clampRepoListHeight,
  loadRepoListHeight,
  persistRepoListHeight,
} from "../lib/workspaceLayout";
import { VerticalSplitHandle } from "./VerticalSplitHandle";

interface RepoSidebarProps {
  workspaceId: WorkspaceId;
  statuses: RepoStatus[];
  selectedId: RepositoryId | null;
  branches: BranchInfo[];
  width: number;
  busy?: boolean;
  onSelect: (id: RepositoryId) => void;
  onAddRepository: () => void;
  onManageAccounts: (id: RepositoryId) => void;
  onRemoveRepository: (id: RepositoryId) => void;
}

interface ContextMenuState {
  repositoryId: RepositoryId;
  x: number;
  y: number;
}

type BranchTreeNode =
  | { kind: "folder"; name: string; path: string; children: BranchTreeNode[] }
  | { kind: "branch"; name: string; fullName: string };

export function RepoSidebar({
  workspaceId,
  statuses,
  selectedId,
  branches,
  width,
  busy,
  onSelect,
  onAddRepository,
  onManageAccounts,
  onRemoveRepository,
}: RepoSidebarProps) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [expandedRemote, setExpandedRemote] = useState<string | null>(null);
  const [remoteBranches, setRemoteBranches] = useState<string[]>([]);
  const [remoteBranchesLoading, setRemoteBranchesLoading] = useState(false);
  const [remoteBranchesError, setRemoteBranchesError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [repoListHeight, setRepoListHeight] = useState(() =>
    loadRepoListHeight(workspaceId),
  );
  const sidebarBodyRef = useRef<HTMLDivElement>(null);
  const selectedRepoItemRef = useRef<HTMLLIElement | null>(null);
  const repoListHeightRef = useRef(repoListHeight);
  const workspaceIdRef = useRef(workspaceId);
  const selected = statuses.find((s) => s.repositoryId === selectedId) ?? null;
  const asideStyle = { width, minWidth: width, maxWidth: width };

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
    setRepoListHeight(loadRepoListHeight(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    repoListHeightRef.current = repoListHeight;
  }, [repoListHeight]);

  const scrollSelectedRepoIntoView = useCallback(() => {
    const item = selectedRepoItemRef.current;
    if (!item) return;
    item.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  useEffect(() => {
    scrollSelectedRepoIntoView();
  }, [repoListHeight, selectedId, scrollSelectedRepoIntoView]);

  const onRepoListDrag = useCallback(
    (deltaY: number) => {
      const container = sidebarBodyRef.current?.clientHeight ?? 0;
      setRepoListHeight((prev) => clampRepoListHeight(prev + deltaY, container));
      // Keep the selection visible while the list shrinks during drag.
      requestAnimationFrame(() => scrollSelectedRepoIntoView());
    },
    [scrollSelectedRepoIntoView],
  );

  const onRepoListDragEnd = useCallback(() => {
    persistRepoListHeight(workspaceIdRef.current, repoListHeightRef.current);
    scrollSelectedRepoIntoView();
  }, [scrollSelectedRepoIntoView]);

  useEffect(() => {
    setExpandedRemote(null);
    setRemoteBranches([]);
    setRemoteBranchesError(null);
    setExpandedFolders(new Set());
  }, [selectedId]);

  const remoteTree = useMemo(
    () => buildBranchTree(remoteBranches),
    [remoteBranches],
  );

  const toggleRemote = useCallback(
    async (remoteName: string) => {
      if (!selectedId) return;
      if (expandedRemote === remoteName) {
        setExpandedRemote(null);
        setRemoteBranches([]);
        setRemoteBranchesError(null);
        return;
      }
      setExpandedRemote(remoteName);
      setRemoteBranches([]);
      setRemoteBranchesError(null);
      setExpandedFolders(new Set());
      setRemoteBranchesLoading(true);
      try {
        const names = await api.listRemoteBranches(selectedId, remoteName);
        setRemoteBranches(names);
        // Expand all folder prefixes so nested branches are reachable immediately.
        const folders = new Set<string>();
        for (const name of names) {
          const parts = name.split("/");
          let path = "";
          for (let i = 0; i < parts.length - 1; i++) {
            path = path ? `${path}/${parts[i]}` : parts[i];
            folders.add(path);
          }
        }
        setExpandedFolders(folders);
      } catch (e) {
        setRemoteBranchesError(
          typeof e === "string"
            ? e
            : e && typeof e === "object" && "message" in e
              ? String((e as { message: unknown }).message)
              : "Failed to load remote branches",
        );
      } finally {
        setRemoteBranchesLoading(false);
      }
    },
    [expandedRemote, selectedId],
  );

  function toggleFolder(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  if (statuses.length === 0) {
    return (
      <aside
        className="flex shrink-0 flex-col bg-surface-raised/60 text-[12px]"
        style={asideStyle}
      >
        <div className="border-b border-border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
          Repositories
        </div>
        <div className="flex flex-1 flex-col items-start gap-3 p-3">
          <p className="leading-relaxed text-ink-muted">
            Add a local Git repository to this workspace to get started.
          </p>
          <button
            type="button"
            className="btn-primary text-[12px]"
            disabled={busy}
            onClick={onAddRepository}
          >
            Add repository
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col bg-surface-raised/60 text-[12px]"
      style={asideStyle}
    >
      <div
        ref={sidebarBodyRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-1.5">
          <div className="min-w-0 flex-1 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            Repositories ({statuses.length})
          </div>
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-surface-overlay text-[11px] leading-none text-ink-muted transition hover:border-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            title="Add repository"
            aria-label="Add repository"
            disabled={busy}
            onClick={onAddRepository}
          >
            +
          </button>
        </div>
        <ul
          className="shrink-0 overflow-y-auto p-1.5"
          style={{ height: repoListHeight }}
        >
          {statuses.map((repo) => {
            const isSelected = repo.repositoryId === selectedId;
            const dirtyCount = repo.workingTree
              ? repo.workingTree.modified +
                repo.workingTree.added +
                repo.workingTree.deleted +
                repo.workingTree.untracked +
                repo.workingTree.renamed +
                repo.workingTree.conflicted
              : 0;
            const clean = repo.available && dirtyCount === 0;

            return (
              <li
                key={repo.repositoryId}
                ref={(el) => {
                  if (isSelected) selectedRepoItemRef.current = el;
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(repo.repositoryId)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      repositoryId: repo.repositoryId,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  className={[
                    "mb-0.5 w-full rounded px-2 py-1.5 text-left transition",
                    isSelected
                      ? "bg-accent/20 ring-1 ring-accent/50"
                      : "hover:bg-surface-overlay",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate font-medium text-ink">
                      {repo.displayName}
                    </span>
                    <span className="flex items-center gap-1">
                      {repo.isFetching && (
                        <span
                          className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                          title="Fetching"
                        />
                      )}
                      {repo.lastError && (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-danger"
                          title={repo.lastError}
                        />
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-1.5 text-[10px] text-ink-muted">
                    <span className="truncate">
                      {repo.detachedHead
                        ? "detached HEAD"
                        : (repo.currentBranch ??
                          (repo.available ? "(no branch)" : "unavailable"))}
                    </span>
                    <span
                      className={
                        !repo.available
                          ? "text-danger"
                          : clean
                            ? "text-success"
                            : "text-warning"
                      }
                    >
                      {!repo.available
                        ? "missing"
                        : clean
                          ? "clean"
                          : `${dirtyCount} chg`}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <VerticalSplitHandle
          label="Resize repositories list"
          onDrag={onRepoListDrag}
          onDragEnd={onRepoListDragEnd}
        />

        <div className="flex max-h-[35%] shrink-0 flex-col border-t border-border">
          <div className="shrink-0 border-b border-border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            Branches
            {selected ? ` — ${selected.displayName}` : ""}
          </div>
          {!selected ? (
            <p className="shrink-0 p-2.5 text-ink-muted">Select a repository.</p>
          ) : !selected.available ? (
            <p className="shrink-0 p-2.5 text-ink-muted">Repository unavailable.</p>
          ) : branches.length === 0 ? (
            <p className="shrink-0 p-2.5 text-ink-muted">No local branches.</p>
          ) : (
            <ul className="min-h-0 overflow-y-auto p-1.5">
              {branches.map((branch) => (
                <li key={branch.name}>
                  <div
                    className={[
                      "mb-0.5 flex w-full items-center gap-1.5 rounded px-2 py-1",
                      branch.isCurrent
                        ? "bg-accent/20 font-medium text-ink ring-1 ring-accent/40"
                        : "text-ink-muted",
                    ].join(" ")}
                    title={branchDivergenceTitle(branch)}
                  >
                    <span
                      className={[
                        "inline-block w-2 shrink-0 text-center text-[10px]",
                        branch.isCurrent ? "text-accent" : "text-transparent",
                      ].join(" ")}
                      aria-hidden
                    >
                      ●
                    </span>
                    <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                    <BranchDivergence branch={branch} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border">
          <div className="shrink-0 border-b border-border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            Remotes
            {selected ? ` — ${selected.displayName}` : ""}
          </div>
          {!selected ? (
            <p className="shrink-0 p-2.5 text-ink-muted">Select a repository.</p>
          ) : !selected.available ? (
            <p className="shrink-0 p-2.5 text-ink-muted">Repository unavailable.</p>
          ) : selected.remotes.length === 0 ? (
            <p className="shrink-0 p-2.5 text-ink-muted">No remotes configured.</p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {[...selected.remotes]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
                .map((remote) => {
                  const open = expandedRemote === remote.name;
                  return (
                    <li key={remote.name}>
                      <button
                        type="button"
                        className={[
                          "mb-0.5 flex w-full items-center gap-1 truncate rounded px-2 py-1 text-left transition",
                          open
                            ? "bg-accent/15 font-medium text-ink ring-1 ring-accent/40"
                            : "text-ink hover:bg-surface-overlay",
                        ].join(" ")}
                        title={`${remote.name}\nfetch: ${remote.fetchUrl}\npush: ${remote.pushUrl}`}
                        onClick={() => void toggleRemote(remote.name)}
                      >
                        <span className="w-2 shrink-0 text-[10px] text-ink-muted" aria-hidden>
                          {open ? "▼" : "▶"}
                        </span>
                        <span className="truncate">{remote.name}</span>
                      </button>
                      {open && (
                        <div className="mb-1 ml-2 border-l border-border pl-1.5">
                          {remoteBranchesLoading ? (
                            <p className="px-2 py-1 text-ink-muted">Loading…</p>
                          ) : remoteBranchesError ? (
                            <p className="px-2 py-1 text-danger">{remoteBranchesError}</p>
                          ) : remoteTree.length === 0 ? (
                            <p className="px-2 py-1 text-ink-muted">No remote branches.</p>
                          ) : (
                            <RemoteBranchTree
                              nodes={remoteTree}
                              expandedFolders={expandedFolders}
                              onToggleFolder={toggleFolder}
                              depth={0}
                            />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          )}
        </div>
      </div>

      {menu && (
        <RepoContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onAccounts={() => {
            const id = menu.repositoryId;
            setMenu(null);
            onManageAccounts(id);
          }}
          onRemove={() => {
            const id = menu.repositoryId;
            setMenu(null);
            onRemoveRepository(id);
          }}
        />
      )}
    </aside>
  );
}

function buildBranchTree(names: string[]): BranchTreeNode[] {
  type MutableNode =
    | { kind: "folder"; name: string; path: string; children: Map<string, MutableNode> }
    | { kind: "branch"; name: string; fullName: string };

  const root = new Map<string, MutableNode>();

  for (const fullName of names) {
    const parts = fullName.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let level = root;
    let path = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      path = path ? `${path}/${part}` : part;
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        level.set(part, { kind: "branch", name: part, fullName });
        continue;
      }
      const existing = level.get(part);
      if (!existing || existing.kind !== "folder") {
        const folder: MutableNode = {
          kind: "folder",
          name: part,
          path,
          children: new Map(),
        };
        level.set(part, folder);
        level = folder.children;
      } else {
        level = existing.children;
      }
    }
  }

  function freeze(map: Map<string, MutableNode>): BranchTreeNode[] {
    return [...map.values()]
      .map((node): BranchTreeNode => {
        if (node.kind === "branch") return node;
        return {
          kind: "folder",
          name: node.name,
          path: node.path,
          children: freeze(node.children),
        };
      })
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
  }

  return freeze(root);
}

function RemoteBranchTree({
  nodes,
  expandedFolders,
  onToggleFolder,
  depth,
}: {
  nodes: BranchTreeNode[];
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  depth: number;
}) {
  return (
    <ul>
      {nodes.map((node) => {
        if (node.kind === "branch") {
          return (
            <li key={node.fullName}>
              <div
                className="truncate rounded px-2 py-0.5 text-ink-muted"
                style={{ paddingLeft: `${0.5 + depth * 0.65}rem` }}
                title={node.fullName}
              >
                {node.name}
              </div>
            </li>
          );
        }
        const open = expandedFolders.has(node.path);
        return (
          <li key={node.path}>
            <button
              type="button"
              className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-left text-ink hover:bg-surface-overlay"
              style={{ paddingLeft: `${0.5 + depth * 0.65}rem` }}
              onClick={() => onToggleFolder(node.path)}
            >
              <span className="w-2 shrink-0 text-[10px] text-ink-muted" aria-hidden>
                {open ? "▼" : "▶"}
              </span>
              <span className="truncate font-medium">{node.name}</span>
            </button>
            {open && (
              <RemoteBranchTree
                nodes={node.children}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function branchDivergenceTitle(branch: BranchInfo): string {
  const parts: string[] = [branch.name];
  if (branch.behind != null && branch.behind > 0) {
    parts.push(`${branch.behind} behind remote`);
  }
  if (branch.ahead != null && branch.ahead > 0) {
    parts.push(`${branch.ahead} ahead of remote`);
  }
  return parts.join(" — ");
}

function BranchDivergence({ branch }: { branch: BranchInfo }) {
  const behind = branch.behind != null && branch.behind > 0 ? branch.behind : null;
  const ahead = branch.ahead != null && branch.ahead > 0 ? branch.ahead : null;
  if (behind == null && ahead == null) return null;

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums text-[10px]">
      {behind != null && (
        <span className="text-warning" aria-label={`${behind} behind`}>
          {behind}↓
        </span>
      )}
      {ahead != null && (
        <span className="text-success" aria-label={`${ahead} ahead`}>
          {ahead}↑
        </span>
      )}
    </span>
  );
}

function RepoContextMenu({
  x,
  y,
  onClose,
  onAccounts,
  onRemove,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onAccounts: () => void;
  onRemove: () => void;
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
      aria-label="Repository actions"
      className="fixed z-50 min-w-44 rounded-md border border-border bg-surface-raised py-1 text-[12px] shadow-xl shadow-black/40"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        role="menuitem"
        className="block w-full px-2.5 py-1 text-left text-ink hover:bg-surface-overlay"
        onClick={onAccounts}
      >
        Account…
      </button>
      <div className="my-1 border-t border-border" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="block w-full px-2.5 py-1 text-left text-danger hover:bg-danger/10"
        onClick={onRemove}
      >
        Remove from workspace
      </button>
    </div>
  );
}
