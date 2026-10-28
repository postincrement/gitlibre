interface DiffViewProps {
  diff: string;
  emptyMessage?: string;
}

interface HunkRange {
  start: number;
  count: number;
}

interface DiffHunk {
  index: number;
  oldRange: HunkRange;
  newRange: HunkRange;
  headerSuffix: string;
  lines: string[];
}

interface ParsedDiff {
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@(.*)$/;

/** Lightweight unified-diff renderer with numbered hunk divider bars. */
export function DiffView({
  diff,
  emptyMessage = "No diff for this file.",
}: DiffViewProps) {
  if (!diff.trim()) {
    return (
      <p className="px-3 py-2 text-[12px] text-ink-muted">{emptyMessage}</p>
    );
  }

  const parsed = parseUnifiedDiff(diff);

  if (parsed.hunks.length === 0) {
    return (
      <p className="px-3 py-2 text-[12px] text-ink-muted">{emptyMessage}</p>
    );
  }

  return (
    <div className="min-h-full font-mono text-[11px] leading-[18px]">
      {parsed.hunks.map((hunk) => (
        <section key={hunk.index} className="border-b border-border/40">
          <div className="sticky top-0 z-[1] flex flex-wrap items-center gap-x-3 gap-y-0.5 border-y border-border bg-surface-overlay px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            <span className="text-ink">Hunk {hunk.index}</span>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span title="Removed / old file lines">
              −{formatRange(hunk.oldRange)}
            </span>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span title="Added / new file lines">
              +{formatRange(hunk.newRange)}
            </span>
            {hunk.headerSuffix.trim() && (
              <>
                <span aria-hidden className="text-border">
                  ·
                </span>
                <span className="normal-case tracking-normal text-ink-muted truncate">
                  {hunk.headerSuffix.trim()}
                </span>
              </>
            )}
          </div>
          <pre className="m-0 overflow-visible p-0">
            {hunk.lines.map((line, index) => (
              <DiffLine key={`${hunk.index}-${index}`} line={line} />
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  return (
    <div
      className={["whitespace-pre-wrap break-all px-3", lineClass(line)].join(
        " ",
      )}
    >
      {line.length === 0 ? " " : line}
    </div>
  );
}

function formatRange(range: HunkRange): string {
  if (range.count <= 0) return String(range.start);
  if (range.count === 1) return String(range.start);
  return `${range.start}–${range.start + range.count - 1}`;
}

function parseUnifiedDiff(diff: string): ParsedDiff {
  const lines = diff.replace(/\n$/, "").split("\n");
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of lines) {
    const match = HUNK_RE.exec(line);
    if (match) {
      current = {
        index: hunks.length + 1,
        oldRange: {
          start: Number(match[1]),
          count: match[2] !== undefined ? Number(match[2]) : 1,
        },
        newRange: {
          start: Number(match[3]),
          count: match[4] !== undefined ? Number(match[4]) : 1,
        },
        headerSuffix: match[5] ?? "",
        lines: [],
      };
      hunks.push(current);
      continue;
    }

    // Skip file-level headers (diff --git, index, ---, +++, etc.).
    if (!current) continue;
    current.lines.push(line);
  }

  return { hunks };
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "bg-surface-overlay/80 text-ink-muted";
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bg-success/15 text-success";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bg-danger/15 text-danger";
  }
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("similarity ") ||
    line.startsWith("rename ") ||
    line.startsWith("copy ") ||
    line.startsWith("Binary ")
  ) {
    return "text-ink-muted";
  }
  return "text-ink";
}
