import type { RepositoryId, RepoStatus } from "../types/models";

interface RepoSidebarProps {
  statuses: RepoStatus[];
  selectedId: RepositoryId | null;
  onSelect: (id: RepositoryId) => void;
}

export function RepoSidebar({ statuses, selectedId, onSelect }: RepoSidebarProps) {
  if (statuses.length === 0) {
    return (
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface-raised/60">
        <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
          Repositories
        </div>
        <p className="p-4 text-sm text-ink-muted">
          Add a local Git repository to this workspace to get started.
        </p>
      </aside>
    );
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface-raised/60">
      <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
        Repositories ({statuses.length})
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
    </aside>
  );
}
