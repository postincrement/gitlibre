import type { ReactNode } from "react";

interface TopNavProps {
  workspaceName: string | null;
  repoName: string | null;
  canFetchRepo: boolean;
  repoFetching: boolean;
  busy: boolean;
  onFetchRepo: () => void;
  onFetchAll: () => void;
}

export function TopNav({
  workspaceName,
  repoName,
  canFetchRepo,
  repoFetching,
  busy,
  onFetchRepo,
  onFetchAll,
}: TopNavProps) {
  const title =
    workspaceName && repoName
      ? `${workspaceName} / ${repoName}`
      : (workspaceName ?? undefined);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface-raised/90 px-4 backdrop-blur">
      {workspaceName && (
        <div
          className="min-w-0 truncate text-lg font-semibold tracking-tight text-ink"
          title={title}
        >
          <span>{workspaceName}</span>
          {repoName && (
            <>
              <span className="mx-1.5 font-normal text-ink-muted" aria-hidden>
                /
              </span>
              <span className="font-medium">{repoName}</span>
            </>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        <NavButton
          onClick={onFetchRepo}
          disabled={!canFetchRepo || busy || repoFetching}
          accent
        >
          {repoFetching ? "Fetching…" : "Fetch"}
        </NavButton>
        <NavButton onClick={onFetchAll} disabled={!workspaceName || busy}>
          {busy && !repoFetching ? "Fetching…" : "Fetch all"}
        </NavButton>
      </div>
    </header>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
  accent,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={accent ? "btn-primary" : "btn-secondary"}
    >
      {children}
    </button>
  );
}
