import type { ReactNode } from "react";

interface TopNavProps {
  workspaceName: string | null;
  busy: boolean;
  onFetchAll: () => void;
}

export function TopNav({ workspaceName, busy, onFetchAll }: TopNavProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface-raised/90 px-4 backdrop-blur">
      <div className="mr-1 text-lg font-semibold tracking-tight text-ink">
        GitLibre
      </div>
      {workspaceName && (
        <>
          <span className="text-ink-muted" aria-hidden>
            /
          </span>
          <div className="truncate text-sm font-medium text-ink" title={workspaceName}>
            {workspaceName}
          </div>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <NavButton onClick={onFetchAll} disabled={!workspaceName || busy} accent>
          {busy ? "Fetching…" : "Fetch all"}
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
