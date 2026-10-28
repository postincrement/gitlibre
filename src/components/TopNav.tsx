import type { ReactNode } from "react";
import type { Workspace, WorkspaceId } from "../types/models";

interface TopNavProps {
  workspaces: Workspace[];
  activeWorkspaceId: WorkspaceId | null;
  busy: boolean;
  onSelectWorkspace: (id: WorkspaceId) => void;
  onAddWorkspace: () => void;
  onAddRepository: () => void;
  onManageAccounts: () => void;
  onFetchAll: () => void;
}

export function TopNav({
  workspaces,
  activeWorkspaceId,
  busy,
  onSelectWorkspace,
  onAddWorkspace,
  onAddRepository,
  onManageAccounts,
  onFetchAll,
}: TopNavProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface-raised/90 px-4 backdrop-blur">
      <div className="mr-2 text-lg font-semibold tracking-tight text-ink">
        GitLibre
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-muted">
        Workspace
        <select
          className="rounded-md border border-border bg-surface-overlay px-2 py-1.5 text-ink outline-none focus:border-accent"
          value={activeWorkspaceId ?? ""}
          onChange={(e) => {
            if (e.target.value) onSelectWorkspace(e.target.value);
          }}
          disabled={workspaces.length === 0}
        >
          {workspaces.length === 0 ? (
            <option value="">No workspaces</option>
          ) : (
            workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))
          )}
        </select>
      </label>

      <div className="ml-auto flex items-center gap-2">
        <NavButton onClick={onManageAccounts}>Accounts</NavButton>
        <NavButton onClick={onAddWorkspace}>Add workspace</NavButton>
        <NavButton onClick={onAddRepository} disabled={!activeWorkspaceId || busy}>
          Add repository
        </NavButton>
        <NavButton onClick={onFetchAll} disabled={!activeWorkspaceId || busy} accent>
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
      className={
        accent
          ? "btn-primary"
          : "btn-secondary"
      }
    >
      {children}
    </button>
  );
}
