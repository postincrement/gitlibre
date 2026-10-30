import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BranchInfo,
  RepositoryId,
  RepoStatus,
  WorkingTreeStatus,
  WorkspaceId,
} from "../types/models";
import * as api from "../lib/api";
import type { ContentViewMode } from "../lib/contentView";
import {
  clampRepoListHeight,
  loadRepoListHeight,
  loadReposPanelStyle,
  persistRepoListHeight,
  persistReposPanelStyle,
  type ReposPanelStyle,
} from "../lib/workspaceLayout";
import { VerticalSplitHandle } from "./VerticalSplitHandle";

interface RepoSidebarProps {
  workspaceId: WorkspaceId;
  statuses: RepoStatus[];
  selectedId: RepositoryId | null;
  branches: BranchInfo[];
  width: number;
  contentView: ContentViewMode;
  busy?: boolean;
  onSelect: (id: RepositoryId) => void;
  onContentViewChange: (mode: ContentViewMode) => void;
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
  contentView,
  busy,
  onSelect,
  onContentViewChange,
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
  const [reposPanelStyle, setReposPanelStyle] = useState<ReposPanelStyle>(() =>
    loadReposPanelStyle(workspaceId),
  );
  const [repoListHeight, setRepoListHeight] = useState(() =>
    loadRepoListHeight(workspaceId),
  );
  const sidebarBodyRef = useRef<HTMLDivElement>(null);
  const selectedRepoItemRef = useRef<HTMLLIElement | null>(null);
  const repoListHeightRef = useRef(repoListHeight);
  const workspaceIdRef = useRef(workspaceId);
  const selected = statuses.find((s) => s.repositoryId === selectedId) ?? null;
  const asideStyle = { width, minWidth: width, maxWidth: width };
  const selectedDirtyCount = selected?.workingTree
    ? dirtyFileCount(selected.workingTree)
    : 0;

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
    setRepoListHeight(loadRepoListHeight(workspaceId));
    setReposPanelStyle(loadReposPanelStyle(workspaceId));
  }, [workspaceId]);

  function toggleReposPanelStyle() {
    const next: ReposPanelStyle =
      reposPanelStyle === "list" ? "dropdown" : "list";
    setReposPanelStyle(next);
    persistReposPanelStyle(workspaceId, next);
  }

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
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-surface-overlay text-ink-muted transition hover:border-ink-muted hover:text-ink"
            title={
              reposPanelStyle === "list"
                ? "Switch to dropdown"
                : "Switch to scrolling list"
            }
            aria-label={
              reposPanelStyle === "list"
                ? "Switch to dropdown"
                : "Switch to scrolling list"
            }
            onClick={toggleReposPanelStyle}
          >
            {reposPanelStyle === "list" ? (
              <DropdownModeIcon />
            ) : (
              <ListModeIcon />
            )}
          </button>
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

        {reposPanelStyle === "dropdown" ? (
          <div
            className="shrink-0 border-b border-border px-2 py-1.5"
            onContextMenu={(e) => {
              if (!selectedId) return;
              e.preventDefault();
              setMenu({
                repositoryId: selectedId,
                x: e.clientX,
                y: e.clientY,
              });
            }}
          >
            <div className="relative">
              <select
                className="field-input w-full py-1 pr-10 text-[12px]"
                value={selectedId ?? ""}
                aria-label="Repository"
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) onSelect(id as RepositoryId);
                }}
              >
                {statuses.map((repo) => (
                  <option key={repo.repositoryId} value={repo.repositoryId}>
                    {repo.displayName}
                    {!repo.available ? " (missing)" : ""}
                  </option>
                ))}
              </select>
              {selected?.available && selectedDirtyCount > 0 && (
                <DirtyCountBadge
                  count={selectedDirtyCount}
                  className="pointer-events-none absolute right-6 top-1/2 z-[1] -translate-y-1/2"
                />
              )}
            </div>
          </div>
        ) : (
          <>
            <ul
              className="shrink-0 overflow-y-auto px-1.5 pb-1.5 pt-2"
              style={{ height: repoListHeight }}
            >
              {statuses.map((repo) => {
                const isSelected = repo.repositoryId === selectedId;
                const dirtyCount = repo.workingTree
                  ? dirtyFileCount(repo.workingTree)
                  : 0;

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
                        <div className="flex min-w-0 flex-1 items-center gap-1 pr-1">
                          <div
                            className="truncate font-medium text-ink"
                            title={repoHoverTitle(repo)}
                          >
                            {repo.displayName}
                          </div>
                          {repo.available && dirtyCount > 0 && (
                            <DirtyCountBadge count={dirtyCount} />
                          )}
                          {!repo.available && (
                            <span className="shrink-0 text-[10px] text-danger">
                              missing
                            </span>
                          )}
                        </div>
                        <span className="flex shrink-0 items-center gap-1">
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
          </>
        )}

        <ContentViewToolbar
          active={contentView}
          onChange={onContentViewChange}
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

function ContentViewToolbar({
  active,
  onChange,
}: {
  active: ContentViewMode;
  onChange: (mode: ContentViewMode) => void;
}) {
  const items: {
    mode: ContentViewMode;
    label: string;
    icon: ReactNode;
  }[] = [
    {
      mode: "fileStatus",
      label: "File Status",
      icon: (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path
            fill="currentColor"
            d="M3 2.5A1.5 1.5 0 0 1 4.5 1h5.086a1.5 1.5 0 0 1 1.06.44l2.914 2.914A1.5 1.5 0 0 1 14 5.414V13.5A1.5 1.5 0 0 1 12.5 15h-8A1.5 1.5 0 0 1 3 13.5v-11Zm1.5-.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V5.414a.5.5 0 0 0-.146-.353L10.44 2.146A.5.5 0 0 0 10.086 2H4.5Zm1 5.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5.5 7.75Zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z"
          />
        </svg>
      ),
    },
    {
      mode: "history",
      label: "History",
      icon: (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path
            fill="currentColor"
            d="M8 1.5a6.5 6.5 0 1 0 3.248 12.07.75.75 0 0 0-.75-1.298A5 5 0 1 1 13 8a.75.75 0 0 0 1.5 0A6.5 6.5 0 0 0 8 1.5Zm.75 3a.75.75 0 0 0-1.5 0v3.19l-1.72 1.72a.75.75 0 1 0 1.06 1.06l2.03-2.03A.75.75 0 0 0 8.75 8V4.5Z"
          />
        </svg>
      ),
    },
    {
      mode: "search",
      label: "Search",
      icon: (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path
            fill="currentColor"
            d="M6.5 2a4.5 4.5 0 1 0 2.845 7.97l3.342 3.343a.75.75 0 1 0 1.06-1.06l-3.342-3.343A4.5 4.5 0 0 0 6.5 2Zm-3 4.5a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z"
          />
        </svg>
      ),
    },
  ];

  return (
    <div
      className="flex shrink-0 items-center justify-center gap-0.5 border-y border-border bg-surface/40 px-1.5 py-1"
      role="toolbar"
      aria-label="Content view"
    >
      {items.map((item) => {
        const isActive = active === item.mode;
        return (
          <button
            key={item.mode}
            type="button"
            title={item.label}
            aria-label={item.label}
            aria-pressed={isActive}
            onClick={() => onChange(item.mode)}
            className={[
              "inline-flex h-7 w-8 items-center justify-center rounded transition",
              isActive
                ? "bg-accent/20 text-accent ring-1 ring-accent/40"
                : "text-ink-muted hover:bg-surface-overlay hover:text-ink",
            ].join(" ")}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
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

function dirtyFileCount(wt: WorkingTreeStatus): number {
  return (
    wt.modified +
    wt.added +
    wt.deleted +
    wt.untracked +
    wt.renamed +
    wt.conflicted
  );
}

function repoHoverTitle(repo: RepoStatus): string {
  const branch = repo.detachedHead
    ? "detached HEAD"
    : (repo.currentBranch ??
      (repo.available ? "(no branch)" : "unavailable"));
  return `branch: ${branch}`;
}

function DirtyCountBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  const label = `${count} changed files`;
  return (
    <span
      className={[
        "inline-flex h-[17px] min-w-[17px] shrink-0 items-center justify-center rounded-[3px] px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-1 ring-surface-raised",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ backgroundColor: "var(--status-repo-changes)" }}
      title={label}
      aria-label={label}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function DropdownModeIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className="block"
    >
      <rect
        x="1.5"
        y="2"
        width="9"
        height="8"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M4 5.5 L6 7.5 L8 5.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ListModeIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className="block"
    >
      <path
        d="M2 3.5h8M2 6h8M2 8.5h8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
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
    <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums text-[10px]">
      {ahead != null && (
        <span
          className="inline-flex items-center rounded-[3px] px-1 text-[9px] font-bold leading-none"
          style={{
            backgroundColor: "var(--status-branch-divergence)",
            color: "var(--status-branch-divergence-fg)",
          }}
          aria-label={`${ahead} ahead`}
        >
          {ahead}↑
        </span>
      )}
      {behind != null && (
        <span
          className="inline-flex items-center rounded-[3px] px-1 text-[9px] font-bold leading-none"
          style={{
            backgroundColor: "var(--status-branch-divergence)",
            color: "var(--status-branch-divergence-fg)",
          }}
          aria-label={`${behind} behind`}
        >
          {behind}↓
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
