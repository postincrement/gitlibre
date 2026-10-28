import type { ReactNode } from "react";
import type { Account, AccountId, DetectedAccount, RepoStatus } from "../types/models";
import { DetectedAccountBanner } from "./DetectedAccountBanner";

interface RepoDetailProps {
  status: RepoStatus | null;
  accounts: Account[];
  detection: DetectedAccount | null;
  onFetch: () => void;
  onRemove: () => void;
  onAssignAccount: (accountId: AccountId | null) => void;
  onDetectAccount: () => void;
  onCreateFromDetection: () => void;
  onDismissDetection: () => void;
  busy: boolean;
}

export function RepoDetail({
  status,
  accounts,
  detection,
  onFetch,
  onRemove,
  onAssignAccount,
  onDetectAccount,
  onCreateFromDetection,
  onDismissDetection,
  busy,
}: RepoDetailProps) {
  if (!status) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-ink-muted">
        Select a repository to inspect its status.
      </main>
    );
  }

  const wt = status.workingTree;

  return (
    <main className="flex flex-1 flex-col overflow-y-auto p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{status.displayName}</h1>
          <p className="mt-1 break-all font-mono text-sm text-ink-muted">{status.path}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onFetch}
            disabled={busy || status.isFetching || !status.available}
            className="btn-primary"
          >
            {status.isFetching ? "Fetching…" : "Fetch"}
          </button>
          <button type="button" onClick={onRemove} className="btn-secondary">
            Remove from workspace
          </button>
        </div>
      </div>

      {!status.available && (
        <Banner tone="danger">
          {status.lastError ?? "Repository is unavailable on disk."}
        </Banner>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink-muted">
          Authentication account
        </h2>
        {!status.accountId && detection && (
          <DetectedAccountBanner
            detection={detection}
            onCreateAccount={onCreateFromDetection}
            onDismiss={onDismissDetection}
          />
        )}
        <div className="flex max-w-xl flex-wrap items-center gap-2">
          <select
            className="field-input max-w-md flex-1"
            value={status.accountId ?? ""}
            onChange={(e) => onAssignAccount(e.target.value || null)}
            disabled={busy}
          >
            <option value="">System Git credentials (default)</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName} ({account.provider}/{account.username})
              </option>
            ))}
          </select>
          {!status.accountId && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={onDetectAccount}
            >
              Detect from remotes
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          Per-repository identity for fetch/push. Does not change global Git config.
          Commit author identity is configured separately on the account.
        </p>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <InfoCard label="Current branch">
          {status.detachedHead
            ? "detached HEAD"
            : (status.currentBranch ?? "—")}
        </InfoCard>
        <InfoCard label="Working tree">
          {!status.available
            ? "—"
            : wt &&
                wt.modified + wt.added + wt.deleted + wt.untracked + wt.renamed + wt.conflicted ===
                  0
              ? "Clean"
              : "Modified"}
        </InfoCard>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink-muted">
          Remotes
        </h2>
        {status.remotes.length === 0 ? (
          <p className="text-sm text-ink-muted">No remotes configured.</p>
        ) : (
          <ul className="space-y-2">
            {status.remotes.map((remote) => (
              <li
                key={remote.name}
                className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm"
              >
                <div className="font-medium">{remote.name}</div>
                <div className="mt-1 break-all font-mono text-xs text-ink-muted">
                  fetch: {remote.fetchUrl}
                </div>
                <div className="break-all font-mono text-xs text-ink-muted">
                  push: {remote.pushUrl}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink-muted">
          Working-tree counts
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Modified" value={wt?.modified ?? 0} />
          <Stat label="Added" value={wt?.added ?? 0} />
          <Stat label="Deleted" value={wt?.deleted ?? 0} />
          <Stat label="Untracked" value={wt?.untracked ?? 0} />
          <Stat label="Renamed" value={wt?.renamed ?? 0} />
          <Stat label="Conflicted" value={wt?.conflicted ?? 0} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink-muted">
          Last fetch
        </h2>
        {status.lastFetchSummary ? (
          <p className="text-sm text-ink">{status.lastFetchSummary}</p>
        ) : (
          <p className="text-sm text-ink-muted">No fetch has been run yet.</p>
        )}
        {status.lastError && <Banner tone="danger">{status.lastError}</Banner>}
      </section>
    </main>
  );
}

function InfoCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-lg font-medium">{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Banner({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "danger" | "warning";
}) {
  return (
    <div
      className={[
        "mb-4 rounded-md border px-3 py-2 text-sm",
        tone === "danger"
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-warning/40 bg-warning/10 text-warning",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
