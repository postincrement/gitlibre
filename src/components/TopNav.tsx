import type { ReactNode, SVGProps } from "react";

interface TopNavProps {
  workspaceName: string | null;
  repoName: string | null;
  canFetchRepo: boolean;
  repoFetching: boolean;
  busy: boolean;
  onCommit: () => void;
  onPullRepo: () => void;
  onFetchRepo: () => void;
  onFetchAll: () => void;
}

export function TopNav({
  workspaceName,
  repoName,
  canFetchRepo,
  repoFetching,
  busy,
  onCommit,
  onPullRepo,
  onFetchRepo,
  onFetchAll,
}: TopNavProps) {
  const title =
    workspaceName && repoName
      ? `${workspaceName} / ${repoName}`
      : (workspaceName ?? undefined);

  const repoActionsDisabled = !canFetchRepo || busy || repoFetching;

  return (
    <header className="flex h-[4.25rem] shrink-0 items-center gap-3 border-b border-border bg-surface-raised/90 px-4 backdrop-blur">
      {workspaceName && (
        <div
          className="min-w-0 max-w-[28%] truncate text-lg font-semibold tracking-tight text-ink"
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

      {repoName && (
        <nav
          className="flex items-end gap-1 sm:gap-2"
          aria-label="Repository actions"
        >
          <ToolbarIconButton
            label="Commit"
            disabled={repoActionsDisabled}
            onClick={onCommit}
            icon={<IconPlus />}
          />
          <ToolbarIconButton
            label="Pull"
            disabled={repoActionsDisabled}
            onClick={onPullRepo}
            icon={<IconArrowDown />}
          />
          <ToolbarIconButton
            label="Push"
            disabled={repoActionsDisabled}
            icon={<IconArrowUp />}
          />
          <ToolbarIconButton
            label={repoFetching ? "Fetching…" : "Fetch"}
            disabled={repoActionsDisabled}
            dashed
            onClick={onFetchRepo}
            icon={<IconArrowDown />}
          />
          <ToolbarIconButton
            label="Branch"
            disabled={repoActionsDisabled}
            icon={<IconBranch />}
          />
          <ToolbarIconButton
            label="Merge"
            disabled={repoActionsDisabled}
            icon={<IconMerge />}
          />
          <ToolbarIconButton
            label="Stash"
            disabled={repoActionsDisabled}
            icon={<IconStash />}
          />
        </nav>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onFetchAll}
          disabled={!workspaceName || busy}
          className="btn-secondary"
        >
          {busy && !repoFetching ? "Fetching…" : "Fetch all"}
        </button>
      </div>
    </header>
  );
}

function ToolbarIconButton({
  label,
  icon,
  onClick,
  disabled,
  dashed,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  dashed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={[
        "group flex w-12 flex-col items-center gap-0.5 rounded-md px-0.5 py-0.5",
        "text-ink-muted transition-colors",
        "enabled:hover:text-ink enabled:focus-visible:outline enabled:focus-visible:outline-2 enabled:focus-visible:outline-offset-2 enabled:focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-40",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-8 w-8 items-center justify-center rounded-full border bg-surface-overlay/80",
          dashed
            ? "border-dashed border-ink-muted group-enabled:group-hover:border-ink"
            : "border-solid border-border group-enabled:group-hover:border-ink-muted",
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="max-w-full truncate text-[10px] font-medium leading-tight tracking-wide">
        {label}
      </span>
    </button>
  );
}

function iconProps(props: SVGProps<SVGSVGElement> = {}) {
  return {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    ...props,
  };
}

function IconPlus() {
  return (
    <svg {...iconProps()}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  );
}

function IconArrowDown() {
  return (
    <svg {...iconProps()}>
      <path d="M8 3v9.5M4.5 9.5 8 13l3.5-3.5" />
    </svg>
  );
}

function IconArrowUp() {
  return (
    <svg {...iconProps()}>
      <path d="M8 13V3.5M4.5 6.5 8 3l3.5 3.5" />
    </svg>
  );
}

/** Vertical trunk with a branch leaving to the right at ~45°. */
function IconBranch() {
  return (
    <svg {...iconProps()}>
      <path d="M6 2.5v11" />
      <circle cx="6" cy="3.5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12.5" r="1.35" fill="currentColor" stroke="none" />
      <path d="M6 7.5 11.5 3.5" />
      <circle cx="12" cy="3.25" r="1.35" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Vertical trunk with a branch joining from the right at ~45°. */
function IconMerge() {
  return (
    <svg {...iconProps()}>
      <path d="M6 2.5v11" />
      <circle cx="6" cy="3.5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12.5" r="1.35" fill="currentColor" stroke="none" />
      <path d="M11.5 3.5 6 8.5" />
      <circle cx="12" cy="3.25" r="1.35" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Stack / drawer — stash. */
function IconStash() {
  return (
    <svg {...iconProps()}>
      <path d="M3 5.5h10" />
      <path d="M3 8.5h10" />
      <path d="M3 11.5h10" />
      <path d="M5 3.5h6v9.5H5z" />
    </svg>
  );
}
