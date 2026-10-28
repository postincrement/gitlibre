import { useEffect, useRef, useState } from "react";
import type { BranchInfo, RepositoryId, RepoStatus } from "../types/models";

interface RepoSidebarProps {
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

export function RepoSidebar({
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
  const selected = statuses.find((s) => s.repositoryId === selectedId) ?? null;
  const asideStyle = { width, minWidth: width, maxWidth: width };

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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
        <ul className="max-h-[40%] shrink-0 overflow-y-auto p-1.5">
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
              <li key={repo.repositoryId}>
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

        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border">
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
            <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
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
