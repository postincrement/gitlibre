import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Workspace, WorkspaceId } from "../types/models";
import { formatError } from "../lib/formatError";

interface WorkspaceOpenModalProps {
  workspaces: Workspace[];
  initialSelectedId: WorkspaceId | null;
  /** When "create", open directly on the new-workspace form. */
  initialMode?: "home" | "create";
  onOpen: (id: WorkspaceId) => void | Promise<void>;
  onCreate: (name: string) => void | Promise<void>;
}

type Mode = "home" | "create";

export function WorkspaceOpenModal({
  workspaces,
  initialSelectedId,
  initialMode,
  onOpen,
  onCreate,
}: WorkspaceOpenModalProps) {
  const hasWorkspaces = workspaces.length > 0;
  const [mode, setMode] = useState<Mode>(
    initialMode === "create" || !hasWorkspaces ? "create" : "home",
  );
  const [selectedId, setSelectedId] = useState<WorkspaceId | null>(
    initialSelectedId ?? workspaces[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "create") {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [mode]);

  async function openWorkspace(id: WorkspaceId) {
    if (busy) return;
    try {
      setBusy(true);
      setError(null);
      setSelectedId(id);
      await onOpen(id);
    } catch (e) {
      setError(formatError(e));
      setBusy(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = nameRef.current?.value.trim() ?? "";
    if (!name || busy) return;
    try {
      setBusy(true);
      setError(null);
      await onCreate(name);
    } catch (err) {
      setError(formatError(err));
      setBusy(false);
    }
  }

  return (
    <div
      className="splash fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Open workspace"
    >
      <div className="splash-glow splash-glow-a" aria-hidden />
      <div className="splash-glow splash-glow-b" aria-hidden />

      <div className="relative z-10 grid w-full max-w-4xl grid-cols-1 gap-10 px-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-16 md:px-12">
        <section className="flex flex-col justify-center">
          <div className="splash-mark mb-6" aria-hidden>
            <svg viewBox="0 0 40 40" className="h-11 w-11" fill="none">
              <rect width="40" height="40" rx="10" className="fill-accent/20" />
              <path
                d="M12 28V12h5.2c3.4 0 5.5 1.9 5.5 4.7 0 1.9-1 3.3-2.7 4l3.5 7.3h-4.2l-3.1-6.7H16V28H12Zm4-10.2h1.3c1.5 0 2.3-.7 2.3-1.9s-.8-1.8-2.3-1.8H16v3.7Z"
                className="fill-accent"
              />
              <path
                d="M26.5 28.2c-2.9 0-4.8-1.9-4.8-4.7V12h3.8v11.2c0 1.2.7 1.9 1.8 1.9.5 0 1-.1 1.4-.3l.6 3c-.7.3-1.6.4-2.8.4Z"
                className="fill-ink"
              />
            </svg>
          </div>

          <h1 className="splash-brand text-4xl font-semibold tracking-tight text-ink md:text-5xl">
            GitLibre
          </h1>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-ink-muted">
            Open a workspace to manage local Git repositories, or create a new one.
          </p>

          {error && (
            <div className="mt-5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          {mode === "home" ? (
            <div className="mt-8 flex flex-col items-start gap-3">
              <SplashAction
                label="Create workspace"
                hint="Start a new group of repositories"
                disabled={busy}
                onClick={() => setMode("create")}
              />
              {selectedId && (
                <SplashAction
                  label={busy ? "Opening…" : "Open selected"}
                  hint="Continue with the highlighted workspace"
                  primary
                  disabled={busy}
                  onClick={() => void openWorkspace(selectedId)}
                />
              )}
            </div>
          ) : (
            <form className="mt-8 w-full max-w-sm" onSubmit={(e) => void handleCreate(e)}>
              <label className="mb-1.5 block text-sm text-ink-muted" htmlFor="workspace-name">
                Workspace name
              </label>
              <input
                id="workspace-name"
                ref={nameRef}
                defaultValue=""
                disabled={busy}
                className="field-input mb-4"
                placeholder="e.g. ScryPOS"
              />
              <div className="flex gap-2">
                {hasWorkspaces && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => setMode("home")}
                  >
                    Back
                  </button>
                )}
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? "Creating…" : "Create workspace"}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="flex min-h-0 flex-col justify-center">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
              Workspaces
            </h2>
            {hasWorkspaces && (
              <span className="text-xs text-ink-muted">{workspaces.length}</span>
            )}
          </div>

          {hasWorkspaces ? (
            <ul
              className="splash-list max-h-[min(22rem,50vh)] overflow-y-auto"
              role="listbox"
              aria-label="Workspaces"
            >
              {workspaces.map((ws) => {
                const selected = ws.id === selectedId;
                return (
                  <li key={ws.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={busy}
                      onClick={() => setSelectedId(ws.id)}
                      onDoubleClick={() => void openWorkspace(ws.id)}
                      className={
                        selected
                          ? "splash-row splash-row-active"
                          : "splash-row"
                      }
                    >
                      <span className="min-w-0 flex-1 truncate text-left text-[0.95rem] text-ink">
                        {ws.name}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {ws.repositoryIds.length === 1
                          ? "1 repo"
                          : `${ws.repositoryIds.length} repos`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-border/80 px-4 py-10 text-center text-sm text-ink-muted">
              No workspaces yet. Create one to get started.
            </div>
          )}

          {hasWorkspaces && (
            <p className="mt-3 text-xs text-ink-muted">
              Double-click a workspace to open it.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function SplashAction({
  label,
  hint,
  primary,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        primary
          ? "splash-action splash-action-primary"
          : "splash-action"
      }
    >
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="text-xs text-ink-muted">{hint}</span>
    </button>
  );
}

