import type { DetectedAccount } from "../types/models";

interface DetectedAccountBannerProps {
  detection: DetectedAccount;
  onCreateAccount: () => void;
  onDismiss: () => void;
}

export function DetectedAccountBanner({
  detection,
  onCreateAccount,
  onDismiss,
}: DetectedAccountBannerProps) {
  const username = detection.suggestedUsername ?? detection.remoteOwner ?? "unknown";
  return (
    <div className="mb-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-3 text-sm">
      <div className="font-medium text-ink">Account detected from repository</div>
      <p className="mt-1 text-ink-muted">
        {detection.provider} · {detection.authKind.replace("_", " ")} · suggested login{" "}
        <span className="text-ink">{username}</span>
        {detection.primaryRemoteUrl && (
          <>
            {" "}
            via <span className="break-all font-mono text-xs">{detection.primaryRemoteUrl}</span>
          </>
        )}
      </p>
      {(detection.commitName || detection.commitEmail) && (
        <p className="mt-1 text-xs text-ink-muted">
          Local commit identity: {detection.commitName ?? "—"} &lt;
          {detection.commitEmail ?? "—"}&gt;
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={onCreateAccount}>
          Create account from this…
        </button>
        <button type="button" className="btn-secondary" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
