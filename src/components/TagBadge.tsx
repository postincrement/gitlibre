/** Price-tag mark used in place of the "tag:" prefix on commit badges. */
export function TagIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 shrink-0" aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M2.1 2.85A.85.85 0 0 1 2.95 2h3.72c.23 0 .44.09.6.25l6.05 6.05a.85.85 0 0 1 0 1.2l-3.82 3.82a.85.85 0 0 1-1.2 0L2.25 7.27a.85.85 0 0 1-.25-.6V2.85Zm3.15 1.4a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Z"
      />
    </svg>
  );
}

export function isTagRef(ref: string): boolean {
  return ref.startsWith("tag:");
}

export function tagDisplayName(ref: string): string {
  return ref.replace(/^tag:\s*/, "");
}

export function TagBadge({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-0.5 rounded px-1 py-px font-medium leading-tight",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        backgroundColor: "var(--status-tag)",
        color: "var(--status-tag-fg)",
      }}
      title={`Tag ${name}`}
      aria-label={`Tag ${name}`}
    >
      <TagIcon />
      {name}
    </span>
  );
}
