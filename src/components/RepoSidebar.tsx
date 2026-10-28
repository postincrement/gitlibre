import { useEffect, useRef, useState } from "react";
import type { RepositoryId, RepoStatus } from "../types/models";

interface RepoSidebarProps {
  statuses: RepoStatus[];
  selectedId: RepositoryId | null;
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
  busy,
  onSelect,
  onAddRepository,
  onManageAccounts,
  onRemoveRepository,
}: RepoSidebarProps) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  if (statuses.length === 0) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface-raised/60">
        <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
          Repositories
        </div>
        <div className="flex flex-1 flex-col items-start gap-4 p-4">
          <p className="text-sm leading-relaxed text-ink-muted">
            Add a local Git repository to this workspace to get started.
          </p>
          <button
            type="button"
            className="btn-primary"
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
    <aside className="relative flex w-72 shrink-0 flex-col border-r border-border bg-surface-raised/60">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
          Repositories ({statuses.length})
        </div>
        <button
          type="button"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-surface-overlay text-sm leading-none text-ink-muted transition hover:border-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          title="Add repository"
          aria-label="Add repository"
          disabled={busy}
          onClick={onAddRepository}
        >
          +
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto p-2">
        {statuses.map((repo) => {
          const selected = repo.repositoryId === selectedId;
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
                  "mb-1 w-full rounded-md px-3 py-2 text-left transition",
                  selected
                    ? "bg-accent/20 ring-1 ring-accent/50"
                    : "hover:bg-surface-overlay",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-ink">{repo.displayName}</span>
                  <span className="flex items-center gap-1">
                    {repo.isFetching && (
                      <span
                        className="h-2 w-2 animate-pulse rounded-full bg-accent"
                        title="Fetching"
                      />
                    )}
                    {repo.lastError && (
                      <span
                        className="h-2 w-2 rounded-full bg-danger"
                        title={repo.lastError}
                      />
                    )}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-ink-muted">
                  <span className="truncate">
                    {repo.detachedHead
                      ? "detached HEAD"
                      : (repo.currentBranch ?? (repo.available ? "(no branch)" : "unavailable"))}
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
                        : `${dirtyCount} changed`}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
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
      className="fixed z-50 min-w-48 rounded-md border border-border bg-surface-raised py-1 shadow-xl shadow-black/40"
      style={{ left: x, top: y }}
    >
      <button
        type="button"
        role="menuitem"
        className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-overlay"
        onClick={onAccounts}
      >
        Account…
      </button>
      <div className="my-1 border-t border-border" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="block w-full px-3 py-1.5 text-left text-sm text-danger hover:bg-danger/10"
        onClick={onRemove}
      >
        Remove from workspace
      </button>
    </div>
  );
}
