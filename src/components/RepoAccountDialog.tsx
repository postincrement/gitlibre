import { useMemo, useState } from "react";
import type {
  Account,
  AccountId,
  DetectedAccount,
  RemoteInfo,
  RepositoryId,
} from "../types/models";
import { Modal } from "./Modal";

export interface RepositoryAccountContext {
  id: RepositoryId;
  displayName: string;
  accountId: AccountId | null;
}

type Phase =
  | { kind: "settings" }
  | { kind: "ask-one"; remote: RemoteInfo }
  | { kind: "ask-many"; remotes: RemoteInfo[]; selected: string };

function initialPhase(
  hasAccount: boolean,
  remotes: RemoteInfo[],
): Phase {
  if (hasAccount || remotes.length === 0) {
    return { kind: "settings" };
  }
  if (remotes.length === 1) {
    return { kind: "ask-one", remote: remotes[0] };
  }
  return {
    kind: "ask-many",
    remotes,
    selected: remotes.find((r) => r.name === "origin")?.name ?? remotes[0].name,
  };
}

interface RepoAccountDialogProps {
  repository: RepositoryAccountContext;
  accounts: Account[];
  remotes: RemoteInfo[];
  busy?: boolean;
  onAssignAccount: (accountId: AccountId | null) => void | Promise<void>;
  /** Populate from a remote: detect, auto-assign match, or open create form. */
  onPopulateFromRemote: (remoteName: string) => void | Promise<void>;
  onClose: () => void;
}

export function RepoAccountDialog({
  repository,
  accounts,
  remotes,
  busy,
  onAssignAccount,
  onPopulateFromRemote,
  onClose,
}: RepoAccountDialogProps) {
  const start = useMemo(
    () => initialPhase(Boolean(repository.accountId), remotes),
    // Only compute once when the dialog opens for this repository.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repository.id],
  );
  const [phase, setPhase] = useState<Phase>(start);
  const [working, setWorking] = useState(false);

  async function populate(remoteName: string) {
    try {
      setWorking(true);
      await onPopulateFromRemote(remoteName);
      setPhase({ kind: "settings" });
    } finally {
      setWorking(false);
    }
  }

  if (phase.kind === "ask-one") {
    const remote = phase.remote;
    return (
      <Modal title={`Account — ${repository.displayName}`} onClose={onClose}>
        <p className="mb-3 text-sm text-ink-muted">
          This repository has no account assigned. Populate account settings from the
          remote below?
        </p>
        <div className="mb-4 rounded-md border border-border bg-surface-overlay px-3 py-2">
          <div className="text-sm font-medium text-ink">{remote.name}</div>
          <div className="mt-1 break-all font-mono text-xs text-ink-muted">
            {remote.fetchUrl}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={working || busy}
            onClick={() => setPhase({ kind: "settings" })}
          >
            Skip
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={working || busy}
            onClick={() => void populate(remote.name)}
          >
            {working ? "Detecting…" : "Populate from remote"}
          </button>
        </div>
      </Modal>
    );
  }

  if (phase.kind === "ask-many") {
    return (
      <Modal title={`Account — ${repository.displayName}`} onClose={onClose}>
        <p className="mb-3 text-sm text-ink-muted">
          This repository has no account assigned. Choose a remote to populate
          settings from, or ignore and configure manually.
        </p>
        <ul className="mb-4 max-h-56 space-y-1.5 overflow-y-auto" role="listbox">
          {phase.remotes.map((remote) => {
            const selected = remote.name === phase.selected;
            return (
              <li key={remote.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={working || busy}
                  onClick={() =>
                    setPhase({ ...phase, selected: remote.name })
                  }
                  className={
                    selected
                      ? "flex w-full flex-col rounded-md border border-accent bg-accent/15 px-3 py-2 text-left"
                      : "flex w-full flex-col rounded-md border border-border bg-surface-overlay px-3 py-2 text-left hover:border-ink-muted"
                  }
                >
                  <span className="text-sm font-medium text-ink">{remote.name}</span>
                  <span className="mt-0.5 break-all font-mono text-xs text-ink-muted">
                    {remote.fetchUrl}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={working || busy}
            onClick={() => setPhase({ kind: "settings" })}
          >
            Ignore
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={working || busy || !phase.selected}
            onClick={() => void populate(phase.selected)}
          >
            {working ? "Detecting…" : "Use selected remote"}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Account — ${repository.displayName}`} onClose={onClose}>
      <p className="mb-4 text-sm text-ink-muted">
        Choose which account this repository uses for fetch and push. This does not
        change global Git config. Commit author identity is configured on the account
        itself (Accounts in the menu bar).
      </p>

      <label className="mb-1 block text-sm text-ink-muted" htmlFor="repo-account">
        Authentication account
      </label>
      <select
        id="repo-account"
        className="field-input mb-3"
        value={repository.accountId ?? ""}
        onChange={(e) => void onAssignAccount(e.target.value || null)}
        disabled={busy || working}
      >
        <option value="">System Git credentials (default)</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.displayName} ({account.provider}/{account.username})
          </option>
        ))}
      </select>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/** Re-export for callers that still type against detection results. */
export type { DetectedAccount };
