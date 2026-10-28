import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CommitInfo, RepoStatus, WorkspaceId } from "../types/models";
import * as api from "../lib/api";
import { CommitGraph } from "./CommitGraph";

interface RepoDetailProps {
  workspaceId: WorkspaceId;
  status: RepoStatus | null;
}

export function RepoDetail({ workspaceId, status }: RepoDetailProps) {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!status?.available) {
      setCommits([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const list = await api.listRepositoryCommits(status.repositoryId);
        if (!cancelled) {
          setCommits(list);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setCommits([]);
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status?.repositoryId, status?.available, status?.lastFetchSummary]);

  if (!status) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-ink-muted">
        Select a repository to inspect its status.
      </main>
    );
  }

  const wt = status.workingTree;
  const dirty =
    wt &&
    wt.modified + wt.added + wt.deleted + wt.untracked + wt.renamed + wt.conflicted > 0;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-base font-semibold tracking-tight">{status.displayName}</h1>
          <span className="font-mono text-xs text-ink-muted">
            {status.detachedHead
              ? "detached HEAD"
              : (status.currentBranch ?? "—")}
          </span>
          {status.available && (
            <span
              className={[
                "text-xs",
                dirty ? "text-warning" : "text-success",
              ].join(" ")}
            >
              {dirty ? "Modified" : "Clean"}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-ink-muted" title={status.path}>
          {status.path}
        </p>
        {!status.available && (
          <Banner tone="danger">
            {status.lastError ?? "Repository is unavailable on disk."}
          </Banner>
        )}
      </div>

      {status.available ? (
        <CommitGraph
          workspaceId={workspaceId}
          commits={commits}
          loading={loading}
          error={error}
        />
      ) : (
        <p className="p-4 text-sm text-ink-muted">Commit history unavailable.</p>
      )}
    </main>
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
        "mt-2 rounded-md border px-3 py-2 text-sm",
        tone === "danger"
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-warning/40 bg-warning/10 text-warning",
      ].join(" ")}
    >
      {children}
    </div>
  );
}
