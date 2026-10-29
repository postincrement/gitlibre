import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ChangeArea,
  CommitFileChange,
  CommitInfo,
  RepositoryId,
  WorkspaceId,
} from "../types/models";
import * as api from "../lib/api";
import {
  formatCommitTime,
  isUncommittedCommit,
} from "../lib/commitGraphLayout";
import {
  clampCommitInfoHeight,
  clampFilesListWidth,
  clampStagedFilesPaneHeight,
  loadCommitInfoHeight,
  loadFilesListWidth,
  loadStagedFilesPaneHeight,
  persistCommitInfoHeight,
  persistFilesListWidth,
  persistStagedFilesPaneHeight,
} from "../lib/detailSplit";
import {
  loadSelectedFile,
  persistSelectedFile,
  type PersistedFileSelection,
} from "../lib/fileSelection";
import { isImagePath } from "../lib/imagePath";
import {
  loadSeparateUntrackedList,
  UI_SETTINGS_CHANGED_EVENT,
} from "../lib/uiSettings";
import { DiffView } from "./DiffView";
import { FileAnnotateDialog } from "./FileAnnotateDialog";
import { FileHistoryDialog } from "./FileHistoryDialog";
import { VerticalSplitHandle } from "./VerticalSplitHandle";

interface FileMenuState {
  x: number;
  y: number;
  files: CommitFileChange[];
  /** Working-tree mutations (stage / remove / …) only apply here. */
  allowMutations: boolean;
}

type PendingFileAction =
  | { kind: "remove"; files: CommitFileChange[] }
  | { kind: "stopTracking"; files: CommitFileChange[] };

function revealInFolderLabel(): string {
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return "Show in Finder";
  if (/Windows/i.test(ua)) return "Show in Explorer";
  return "Show in File Manager";
}

function fileKey(file: CommitFileChange): string {
  return `${file.area ?? ""}:${file.status}:${file.oldPath ?? ""}:${file.path}`;
}

function sameFile(a: CommitFileChange, b: CommitFileChange): boolean {
  return fileKey(a) === fileKey(b);
}

function matchesPersisted(
  file: CommitFileChange,
  saved: PersistedFileSelection,
): boolean {
  return (
    file.path === saved.path &&
    (file.area ?? null) === (saved.area ?? null) &&
    file.status === saved.status &&
    (file.oldPath ?? null) === (saved.oldPath ?? null)
  );
}

function toPersisted(file: CommitFileChange): PersistedFileSelection {
  return {
    path: file.path,
    area: file.area ?? null,
    status: file.status,
    oldPath: file.oldPath ?? null,
  };
}

interface CommitFilesPaneProps {
  workspaceId: WorkspaceId;
  repositoryId: RepositoryId;
  commit: CommitInfo | null;
  files: CommitFileChange[];
  loading: boolean;
  error: string | null;
  /** Called after stage / unstage / commit so the parent can refresh. */
  onWorkingTreeChanged?: () => void;
  /** Called after a successful commit (history should reload). */
  onCommitted?: () => void;
  /** Select another commit (e.g. parent hash link). */
  onSelectCommitId?: (commitId: string) => void;
  /**
   * When true, hide the commit message / amend form for uncommitted changes
   * (History mode). Commit info for real commits is unaffected.
   */
  hideCommitComposer?: boolean;
}

export function CommitFilesPane({
  workspaceId,
  repositoryId,
  commit,
  files,
  loading,
  error,
  onWorkingTreeChanged,
  onCommitted,
  onSelectCommitId,
  hideCommitComposer = false,
}: CommitFilesPaneProps) {
  /** All selected file rows (multi-select). */
  const [selection, setSelection] = useState<CommitFileChange[]>([]);
  /** File whose diff is shown (last interacted). */
  const [activeFile, setActiveFile] = useState<CommitFileChange | null>(null);
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<{
    beforeUrl: string | null;
    afterUrl: string | null;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [fileMenu, setFileMenu] = useState<FileMenuState | null>(null);
  const [pendingFileAction, setPendingFileAction] =
    useState<PendingFileAction | null>(null);
  const [fileHistoryPath, setFileHistoryPath] = useState<string | null>(null);
  const [fileAnnotate, setFileAnnotate] = useState<{
    path: string;
    commit: string | null;
  } | null>(null);
  const [filesWidth, setFilesWidth] = useState(() =>
    loadFilesListWidth(workspaceId),
  );
  const [infoHeight, setInfoHeight] = useState(() =>
    loadCommitInfoHeight(workspaceId),
  );
  const [stagedPaneHeight, setStagedPaneHeight] = useState(() =>
    loadStagedFilesPaneHeight(workspaceId),
  );
  const filesWidthRef = useRef(filesWidth);
  const infoHeightRef = useRef(infoHeight);
  const stagedPaneHeightRef = useRef(stagedPaneHeight);
  const stagedSplitRef = useRef<HTMLDivElement>(null);
  const selectionAnchorRef = useRef<CommitFileChange | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  /** Pending restore after commit change; `undefined` means restore already applied. */
  const pendingFileRestoreRef = useRef<
    PersistedFileSelection | null | undefined
  >(undefined);
  /** True once `loading` has been true for the current commit (avoids settling empty too early). */
  const sawFilesLoadingRef = useRef(false);

  const uncommitted = commit ? isUncommittedCommit(commit) : false;
  const showBottomMeta = !uncommitted || !hideCommitComposer;
  const [separateUntracked, setSeparateUntracked] = useState(() =>
    loadSeparateUntrackedList(),
  );

  useEffect(() => {
    const sync = () => setSeparateUntracked(loadSeparateUntrackedList());
    window.addEventListener(UI_SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(UI_SETTINGS_CHANGED_EVENT, sync);
  }, []);

  const staged = useMemo(
    () => files.filter((f) => f.area === "staged").sort(compareByDirThenName),
    [files],
  );
  const unstagedOnly = useMemo(
    () => files.filter((f) => f.area === "unstaged").sort(compareByDirThenName),
    [files],
  );
  const untracked = useMemo(
    () => files.filter((f) => f.area === "untracked").sort(compareByDirThenName),
    [files],
  );
  const unstaged = useMemo(() => {
    if (separateUntracked) return unstagedOnly;
    return [...unstagedOnly, ...untracked].sort(compareByDirThenName);
  }, [separateUntracked, unstagedOnly, untracked]);

  const selectableFiles = useMemo(() => {
    if (!commit) return [];
    if (isUncommittedCommit(commit)) {
      return separateUntracked
        ? [...staged, ...unstagedOnly, ...untracked]
        : [...staged, ...unstaged];
    }
    return files;
  }, [
    commit,
    files,
    separateUntracked,
    staged,
    unstaged,
    unstagedOnly,
    untracked,
  ]);

  const selectedKeys = useMemo(
    () => new Set(selection.map(fileKey)),
    [selection],
  );

  useEffect(() => {
    filesWidthRef.current = filesWidth;
  }, [filesWidth]);
  useEffect(() => {
    infoHeightRef.current = infoHeight;
  }, [infoHeight]);
  useEffect(() => {
    stagedPaneHeightRef.current = stagedPaneHeight;
  }, [stagedPaneHeight]);

  useEffect(() => {
    setFilesWidth(loadFilesListWidth(workspaceId));
    setInfoHeight(loadCommitInfoHeight(workspaceId));
    setStagedPaneHeight(loadStagedFilesPaneHeight(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    setSelection([]);
    setActiveFile(null);
    selectionAnchorRef.current = null;
    setDiff("");
    setDiffError(null);
    setActionError(null);
    setFileMenu(null);
    setPendingFileAction(null);
    if (!commit || !isUncommittedCommit(commit)) {
      setMessage("");
      setAmend(false);
    }
    // Only Uncommitted changes restores a persisted file; real commits always
    // start on the first file.
    pendingFileRestoreRef.current = commit
      ? isUncommittedCommit(commit)
        ? loadSelectedFile(repositoryId, commit.id)
        : null
      : null;
    sawFilesLoadingRef.current = false;
  }, [commit?.id, repositoryId]);

  useEffect(() => {
    if (!commit) return;

    if (pendingFileRestoreRef.current !== undefined) {
      if (loading) {
        sawFilesLoadingRef.current = true;
        return;
      }
      if (selectableFiles.length > 0) {
        const saved = pendingFileRestoreRef.current;
        pendingFileRestoreRef.current = undefined;
        const restored =
          uncommitted && saved != null
            ? (selectableFiles.find((f) => matchesPersisted(f, saved)) ?? null)
            : null;
        const next = restored ?? selectableFiles[0]!;
        setSelection([next]);
        setActiveFile(next);
        selectionAnchorRef.current = next;
        if (uncommitted) {
          persistSelectedFile(repositoryId, commit.id, toPersisted(next));
        }
        return;
      }
      if (!sawFilesLoadingRef.current) {
        // Empty list before the first load cycle — wait for parent fetch.
        return;
      }
      pendingFileRestoreRef.current = undefined;
      setSelection([]);
      setActiveFile(null);
      return;
    }

    const nextSelection = selection
      .map((selected) => selectableFiles.find((f) => sameFile(f, selected)))
      .filter((f): f is CommitFileChange => f != null);
    if (
      nextSelection.length !== selection.length ||
      nextSelection.some((f, i) => !sameFile(f, selection[i]!))
    ) {
      setSelection(nextSelection);
    }
    if (activeFile) {
      const still =
        selectableFiles.find((f) => sameFile(f, activeFile)) ?? null;
      if (!still) {
        const fallback =
          nextSelection[nextSelection.length - 1] ??
          selectableFiles[0] ??
          null;
        setActiveFile(fallback);
        if (fallback) {
          setSelection((prev) =>
            prev.length === 0 ? [fallback] : prev,
          );
        } else {
          setDiff("");
          setDiffError(null);
          if (uncommitted) {
            persistSelectedFile(repositoryId, commit.id, null);
          }
        }
      } else if (!sameFile(still, activeFile)) {
        setActiveFile(still);
      }
    } else if (nextSelection.length > 0) {
      setActiveFile(nextSelection[nextSelection.length - 1]!);
    } else if (!uncommitted && selectableFiles.length > 0) {
      const first = selectableFiles[0]!;
      setSelection([first]);
      setActiveFile(first);
      selectionAnchorRef.current = first;
    }
    // Only re-sync when the file list changes / restore completes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection/activeFile updated intentionally from files
  }, [selectableFiles, loading, commit?.id, repositoryId, uncommitted]);

  useEffect(() => {
    if (!commit?.id || !uncommitted) return;
    if (pendingFileRestoreRef.current !== undefined) return;
    if (!activeFile) return;
    persistSelectedFile(repositoryId, commit.id, toPersisted(activeFile));
  }, [activeFile, commit?.id, repositoryId, uncommitted]);

  useEffect(() => {
    if (!commit || !activeFile) {
      setDiff("");
      setDiffError(null);
      setDiffLoading(false);
      setImagePreview(null);
      return;
    }

    const previewPath = activeFile.path;
    const wantsImage =
      isImagePath(previewPath) ||
      (activeFile.oldPath != null && isImagePath(activeFile.oldPath));

    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    setImagePreview(null);
    setDiff("");

    void (async () => {
      if (wantsImage) {
        try {
          const pair = await api.getCommitFilePreview(
            repositoryId,
            commit.id,
            previewPath,
            activeFile.oldPath,
            activeFile.area ?? null,
            activeFile.status,
          );
          if (cancelled) return;
          const toUrl = (p: api.FilePreview | null) =>
            p && p.mimeType.startsWith("image/")
              ? `data:${p.mimeType};base64,${p.base64}`
              : null;
          const beforeUrl = toUrl(pair.before);
          const afterUrl = toUrl(pair.after);
          if (beforeUrl || afterUrl) {
            setImagePreview({ beforeUrl, afterUrl });
            setDiffLoading(false);
            return;
          }
        } catch {
          /* Fall through to textual diff / error below. */
        }
      }

      try {
        const text = await api.getCommitFileDiff(
          repositoryId,
          commit.id,
          activeFile.path,
          activeFile.oldPath,
          activeFile.area ?? null,
        );
        if (!cancelled) {
          setDiff(text);
          setDiffLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setDiff("");
          setDiffError(e instanceof Error ? e.message : String(e));
          setDiffLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [commit, repositoryId, activeFile]);

  const runMutation = useCallback(
    async (fn: () => Promise<void>, opts?: { committed?: boolean }) => {
      try {
        setBusy(true);
        setActionError(null);
        await fn();
        onWorkingTreeChanged?.();
        if (opts?.committed) {
          setMessage("");
          setAmend(false);
          onCommitted?.();
        }
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onWorkingTreeChanged, onCommitted],
  );

  const onFilesWidthDrag = useCallback((deltaX: number) => {
    setFilesWidth((prev) => clampFilesListWidth(prev + deltaX));
  }, []);

  const onFilesWidthDragEnd = useCallback(() => {
    persistFilesListWidth(workspaceId, filesWidthRef.current);
  }, [workspaceId]);

  const onInfoHeightDrag = useCallback((deltaY: number) => {
    setInfoHeight((prev) => clampCommitInfoHeight(prev - deltaY));
  }, []);

  const onInfoHeightDragEnd = useCallback(() => {
    persistCommitInfoHeight(workspaceId, infoHeightRef.current);
  }, [workspaceId]);

  const onStagedPaneDrag = useCallback((deltaY: number) => {
    const container = stagedSplitRef.current?.clientHeight ?? 0;
    setStagedPaneHeight((prev) =>
      clampStagedFilesPaneHeight(prev + deltaY, container),
    );
  }, []);

  const onStagedPaneDragEnd = useCallback(() => {
    persistStagedFilesPaneHeight(workspaceId, stagedPaneHeightRef.current);
  }, [workspaceId]);

  async function handleCommit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim() && !amend) return;
    if (!amend && staged.length === 0) return;
    await runMutation(
      async () => {
        await api.commitRepository(repositoryId, message, amend);
      },
      { committed: true },
    );
  }

  const selectFile = useCallback(
    (file: CommitFileChange, e: ReactMouseEvent) => {
      const ordered = selectableFiles;
      if (e.shiftKey && selectionAnchorRef.current) {
        const anchor = selectionAnchorRef.current;
        const a = ordered.findIndex((f) => sameFile(f, anchor));
        const b = ordered.findIndex((f) => sameFile(f, file));
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setSelection(ordered.slice(lo, hi + 1));
          setActiveFile(file);
          return;
        }
      }

      if (e.metaKey || e.ctrlKey) {
        setSelection((prev) => {
          const exists = prev.some((f) => sameFile(f, file));
          if (exists) {
            const next = prev.filter((f) => !sameFile(f, file));
            setActiveFile(next[next.length - 1] ?? null);
            return next;
          }
          setActiveFile(file);
          return [...prev, file];
        });
        selectionAnchorRef.current = file;
        return;
      }

      setSelection([file]);
      setActiveFile(file);
      selectionAnchorRef.current = file;
    },
    [selectableFiles],
  );

  const openFileMenu = useCallback(
    (
      e: ReactMouseEvent,
      file: CommitFileChange,
      allowMutations: boolean,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const current = selectionRef.current;
      const alreadySelected = current.some((f) => sameFile(f, file));
      const menuFiles =
        alreadySelected && current.length > 0 ? current : [file];
      if (!alreadySelected || current.length === 0) {
        setSelection([file]);
        selectionAnchorRef.current = file;
      }
      setActiveFile(file);
      setFileMenu({
        x: e.clientX,
        y: e.clientY,
        files: menuFiles,
        allowMutations,
      });
    },
    [],
  );

  async function handleOpenFiles(targets: CommitFileChange[]) {
    try {
      setActionError(null);
      for (const file of targets) {
        await api.openRepositoryFile(repositoryId, file.path);
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRevealFile(file: CommitFileChange) {
    try {
      setActionError(null);
      await api.revealRepositoryFile(repositoryId, file.path);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleCopyPaths(targets: CommitFileChange[]) {
    try {
      setActionError(null);
      const paths: string[] = [];
      for (const file of targets) {
        paths.push(await api.resolveRepositoryFilePath(repositoryId, file.path));
      }
      await navigator.clipboard.writeText(paths.join("\n"));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleLogSelected(file: CommitFileChange) {
    setFileHistoryPath(fileLogPath(file));
  }

  function handleAnnotateSelected(file: CommitFileChange) {
    setFileAnnotate(fileAnnotateTarget(file, commit));
  }

  async function stageSelected(targets: CommitFileChange[]) {
    const paths = targets.map((f) => f.path);
    await runMutation(() => api.stagePaths(repositoryId, paths));
  }

  async function unstageSelected(targets: CommitFileChange[]) {
    const paths = targets.map((f) => f.path);
    await runMutation(() => api.unstagePaths(repositoryId, paths));
  }

  async function removeSelected(targets: CommitFileChange[]) {
    await runMutation(async () => {
      const byArea = new Map<ChangeArea, string[]>();
      for (const file of targets) {
        if (!file.area) continue;
        const list = byArea.get(file.area) ?? [];
        list.push(file.path);
        byArea.set(file.area, list);
      }
      for (const [area, paths] of byArea) {
        await api.removePaths(repositoryId, paths, area);
      }
    });
  }

  async function stopTrackingSelected(targets: CommitFileChange[]) {
    const paths = targets
      .filter((f) => f.area !== "untracked")
      .map((f) => f.path);
    if (paths.length === 0) return;
    await runMutation(() => api.stopTrackingPaths(repositoryId, paths));
  }

  if (!commit) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-[12px] text-ink-muted">
        Select a commit to view changed files.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-surface-raised/40">
      <div
        className="flex min-h-0 shrink-0 flex-col border-r border-border"
        style={{ width: filesWidth }}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border bg-surface-raised/95 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            Files
          </div>
          {actionError && (
            <p className="shrink-0 border-b border-border/60 px-3 py-1.5 text-[11px] text-danger">
              {actionError}
            </p>
          )}
          {loading ? (
            <p className="px-3 py-2 text-[12px] text-ink-muted">Loading files…</p>
          ) : error ? (
            <p className="px-3 py-2 text-[12px] text-danger">{error}</p>
          ) : files.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-ink-muted">No files changed.</p>
          ) : uncommitted ? (
            <div
              ref={stagedSplitRef}
              className="flex min-h-0 flex-1 flex-col text-[12px]"
            >
              <div
                className="min-h-0 shrink-0 overflow-auto"
                style={{ height: stagedPaneHeight }}
              >
                <FileSection
                  title="Staged"
                  files={staged}
                  selectedKeys={selectedKeys}
                  busy={busy}
                  emptyHint="No staged files"
                  stagedChecked
                  onSelect={selectFile}
                  onContextMenu={(e, file) => openFileMenu(e, file, true)}
                  onToggleStaged={(file, checked) => {
                    if (checked) return;
                    void runMutation(() =>
                      api.unstagePaths(repositoryId, [file.path]),
                    );
                  }}
                  bulkAction={
                    staged.length > 0
                      ? {
                          label: "Unstage all",
                          onClick: () =>
                            void runMutation(() =>
                              api.unstagePaths(
                                repositoryId,
                                staged.map((f) => f.path),
                              ),
                            ),
                        }
                      : undefined
                  }
                />
              </div>
              <VerticalSplitHandle
                label="Resize staged / unstaged files"
                onDrag={onStagedPaneDrag}
                onDragEnd={onStagedPaneDragEnd}
              />
              <div className="min-h-0 flex-1 overflow-auto">
                <FileSection
                  title="Unstaged"
                  files={unstaged}
                  selectedKeys={selectedKeys}
                  busy={busy}
                  emptyHint="No unstaged changes"
                  stagedChecked={false}
                  onSelect={selectFile}
                  onContextMenu={(e, file) => openFileMenu(e, file, true)}
                  onToggleStaged={(file, checked) => {
                    if (!checked) return;
                    void runMutation(() =>
                      api.stagePaths(repositoryId, [file.path]),
                    );
                  }}
                  bulkAction={
                    unstaged.length > 0
                      ? {
                          label: "Stage all",
                          onClick: () =>
                            void runMutation(() =>
                              api.stagePaths(
                                repositoryId,
                                unstaged.map((f) => f.path),
                              ),
                            ),
                        }
                      : undefined
                  }
                />
                {separateUntracked && (
                  <FileSection
                    title="Untracked"
                    files={untracked}
                    selectedKeys={selectedKeys}
                    busy={busy}
                    emptyHint="No untracked files"
                    stagedChecked={false}
                    onSelect={selectFile}
                    onContextMenu={(e, file) => openFileMenu(e, file, true)}
                    onToggleStaged={(file, checked) => {
                      if (!checked) return;
                      void runMutation(() =>
                        api.stagePaths(repositoryId, [file.path]),
                      );
                    }}
                    bulkAction={
                      untracked.length > 0
                        ? {
                            label: "Stage all",
                            onClick: () =>
                              void runMutation(() =>
                                api.stagePaths(
                                  repositoryId,
                                  untracked.map((f) => f.path),
                                ),
                              ),
                          }
                        : undefined
                    }
                  />
                )}
              </div>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-auto py-1 text-[12px]">
              {files.map((file) => {
                const selected = selectedKeys.has(fileKey(file));
                return (
                  <li key={`${file.status}:${file.oldPath ?? ""}:${file.path}`}>
                    <button
                      type="button"
                      onClick={(e) => selectFile(file, e)}
                      onContextMenu={(e) => openFileMenu(e, file, false)}
                      className={[
                        "flex w-full items-center gap-2 px-3 py-0.5 text-left",
                        selected
                          ? "bg-accent/20"
                          : "hover:bg-surface-overlay/60",
                      ].join(" ")}
                      title={
                        file.oldPath
                          ? `${file.oldPath} → ${file.path}`
                          : file.path
                      }
                    >
                      <StatusBadge status={file.status} />
                      <span className="font-filename min-w-0 truncate text-ink">
                        {file.oldPath ? (
                          <>
                            <span className="text-ink-muted">{file.oldPath}</span>
                            <span className="text-ink-muted"> → </span>
                            {file.path}
                          </>
                        ) : (
                          file.path
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {showBottomMeta && (
          <>
            <VerticalSplitHandle
              onDrag={onInfoHeightDrag}
              onDragEnd={onInfoHeightDragEnd}
            />

            <div
              className="shrink-0 overflow-auto border-t border-border bg-surface/40"
              style={{ height: infoHeight }}
            >
              {uncommitted ? (
                <CommitForm
                  message={message}
                  amend={amend}
                  busy={busy}
                  canCommit={staged.length > 0 || amend}
                  stagedCount={staged.length}
                  actionError={actionError}
                  onMessageChange={setMessage}
                  onAmendChange={setAmend}
                  onSubmit={handleCommit}
                />
              ) : (
                <CommitInfoPanel
                  commit={commit}
                  onSelectCommitId={onSelectCommitId}
                />
              )}
            </div>
          </>
        )}
      </div>

      <FilesSplitHandle onDrag={onFilesWidthDrag} onDragEnd={onFilesWidthDragEnd} />

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {!activeFile ? (
          <div className="flex h-full items-center justify-center px-4 text-[12px] text-ink-muted">
            Select a file to view its diff.
          </div>
        ) : diffLoading ? (
          <p className="px-3 py-2 text-[12px] text-ink-muted">Loading diff…</p>
        ) : imagePreview ? (
          <ImagePreviewPane
            beforeUrl={imagePreview.beforeUrl}
            afterUrl={imagePreview.afterUrl}
            path={activeFile.path}
            oldPath={activeFile.oldPath}
          />
        ) : diffError ? (
          <p className="px-3 py-2 text-[12px] text-danger">{diffError}</p>
        ) : (
          <div className="h-full overflow-auto">
            <DiffView diff={diff} />
          </div>
        )}
      </div>

      {pendingFileAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface-raised p-4">
            <h3 className="mb-2 font-semibold">
              {pendingFileAction.kind === "remove"
                ? pendingFileAction.files.length > 1
                  ? "Remove files"
                  : "Remove file"
                : "Stop tracking"}
            </h3>
            <p className="mb-4 text-sm text-ink-muted">
              {pendingFileAction.kind === "remove" ? (
                pendingFileAction.files.length === 1 ? (
                  <>
                    Remove{" "}
                    <span className="font-filename text-ink">
                      {pendingFileAction.files[0]!.path}
                    </span>{" "}
                    from the working tree
                    {pendingFileAction.files[0]!.area === "untracked"
                      ? ""
                      : " and index"}
                    ? This cannot be undone.
                  </>
                ) : (
                  <>
                    Remove {pendingFileAction.files.length} selected files from
                    the working tree (and index when tracked)? This cannot be
                    undone.
                  </>
                )
              ) : pendingFileAction.files.length === 1 ? (
                <>
                  Stop tracking{" "}
                  <span className="font-filename text-ink">
                    {pendingFileAction.files[0]!.path}
                  </span>
                  ? The file will stay on disk but leave the index.
                </>
              ) : (
                <>
                  Stop tracking {pendingFileAction.files.length} selected files?
                  They will stay on disk but leave the index.
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPendingFileAction(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() => {
                  const action = pendingFileAction;
                  setPendingFileAction(null);
                  if (!action) return;
                  if (action.kind === "remove") {
                    void removeSelected(action.files);
                  } else {
                    void stopTrackingSelected(action.files);
                  }
                }}
              >
                {pendingFileAction.kind === "remove" ? "Remove" : "Stop tracking"}
              </button>
            </div>
          </div>
        </div>
      )}

      {fileMenu && (
        <FileContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          files={fileMenu.files}
          allowMutations={fileMenu.allowMutations}
          busy={busy}
          revealLabel={revealInFolderLabel()}
          onClose={() => setFileMenu(null)}
          onOpen={() => {
            const targets = fileMenu.files;
            setFileMenu(null);
            void handleOpenFiles(targets);
          }}
          onReveal={() => {
            const file = fileMenu.files[0];
            setFileMenu(null);
            if (file) void handleRevealFile(file);
          }}
          onCopyPath={() => {
            const targets = fileMenu.files;
            setFileMenu(null);
            void handleCopyPaths(targets);
          }}
          onLogSelected={() => {
            const file = fileMenu.files[0];
            setFileMenu(null);
            if (file) handleLogSelected(file);
          }}
          onAnnotateSelected={() => {
            const file = fileMenu.files[0];
            setFileMenu(null);
            if (file) handleAnnotateSelected(file);
          }}
          onAddToIndex={() => {
            const targets = fileMenu.files;
            setFileMenu(null);
            void stageSelected(targets);
          }}
          onUnstage={() => {
            const targets = fileMenu.files;
            setFileMenu(null);
            void unstageSelected(targets);
          }}
          onRemove={() => {
            const targets = fileMenu.files;
            setFileMenu(null);
            setPendingFileAction({ kind: "remove", files: targets });
          }}
          onStopTracking={() => {
            const targets = fileMenu.files;
            setFileMenu(null);
            setPendingFileAction({ kind: "stopTracking", files: targets });
          }}
        />
      )}

      {fileHistoryPath && (
        <FileHistoryDialog
          workspaceId={workspaceId}
          repositoryId={repositoryId}
          path={fileHistoryPath}
          startCommit={
            commit && !isUncommittedCommit(commit) ? commit.id : null
          }
          onClose={() => setFileHistoryPath(null)}
        />
      )}

      {fileAnnotate && (
        <FileAnnotateDialog
          workspaceId={workspaceId}
          repositoryId={repositoryId}
          path={fileAnnotate.path}
          commit={fileAnnotate.commit}
          onClose={() => setFileAnnotate(null)}
        />
      )}
    </div>
  );
}

function fileLogPath(file: CommitFileChange): string {
  const letter = file.status.charAt(0).toUpperCase();
  if (letter === "D" && file.oldPath) return file.oldPath;
  return file.path;
}

function fileAnnotateTarget(
  file: CommitFileChange,
  commit: CommitInfo | null,
): { path: string; commit: string | null } {
  const letter = file.status.charAt(0).toUpperCase();
  const path =
    letter === "D" && file.oldPath ? file.oldPath : file.path;
  if (!commit || isUncommittedCommit(commit)) {
    // Deleted in the working tree: blame the last committed version.
    if (letter === "D") return { path, commit: "HEAD" };
    return { path, commit: null };
  }
  if (letter === "D") return { path, commit: `${commit.id}^` };
  return { path, commit: commit.id };
}

function FileSection({
  title,
  files,
  selectedKeys,
  busy,
  emptyHint,
  stagedChecked,
  onSelect,
  onContextMenu,
  onToggleStaged,
  bulkAction,
}: {
  title: string;
  files: CommitFileChange[];
  selectedKeys: Set<string>;
  busy: boolean;
  emptyHint: string;
  /** Reflects whether files in this section are currently staged. */
  stagedChecked: boolean;
  onSelect: (file: CommitFileChange, e: ReactMouseEvent) => void;
  onContextMenu: (e: ReactMouseEvent, file: CommitFileChange) => void;
  onToggleStaged: (file: CommitFileChange, checked: boolean) => void;
  bulkAction?: { label: string; onClick: () => void };
}) {
  return (
    <div className="border-b border-border/60 last:border-b-0">
      <div className="flex items-center justify-between gap-2 px-3 py-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
          {title}
          <span className="ml-1 tabular-nums text-ink-muted/80">({files.length})</span>
        </div>
        {bulkAction && (
          <button
            type="button"
            className="text-[10px] text-accent hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={bulkAction.onClick}
          >
            {bulkAction.label}
          </button>
        )}
      </div>
      {files.length === 0 ? (
        <p className="px-3 pb-2 text-[11px] text-ink-muted">{emptyHint}</p>
      ) : (
        <ul>
          {files.map((file) => {
            const isSelected = selectedKeys.has(fileKey(file));
            return (
              <li
                key={`${file.area}:${file.status}:${file.oldPath ?? ""}:${file.path}`}
                className={[
                  "flex items-center gap-1 pr-1",
                  isSelected ? "bg-accent/20" : "hover:bg-surface-overlay/60",
                ].join(" ")}
                onContextMenu={(e) => onContextMenu(e, file)}
              >
                <label
                  className="flex shrink-0 cursor-pointer items-center pl-2.5"
                  title={stagedChecked ? "Unstage" : "Stage"}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--color-accent)]"
                    checked={stagedChecked}
                    disabled={busy}
                    aria-label={
                      stagedChecked
                        ? `Unstage ${file.path}`
                        : `Stage ${file.path}`
                    }
                    onChange={(e) => onToggleStaged(file, e.target.checked)}
                  />
                </label>
                <button
                  type="button"
                  onClick={(e) => onSelect(file, e)}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-0.5 text-left"
                  title={
                    file.oldPath
                      ? `${file.oldPath} → ${file.path}`
                      : file.path
                  }
                >
                  <StatusBadge status={file.status} />
                  <span className="font-filename min-w-0 truncate text-ink">
                    {file.path}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FileContextMenu({
  x,
  y,
  files,
  allowMutations,
  busy,
  revealLabel,
  onClose,
  onOpen,
  onReveal,
  onCopyPath,
  onLogSelected,
  onAnnotateSelected,
  onAddToIndex,
  onUnstage,
  onRemove,
  onStopTracking,
}: {
  x: number;
  y: number;
  files: CommitFileChange[];
  allowMutations: boolean;
  busy: boolean;
  revealLabel: string;
  onClose: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onCopyPath: () => void;
  onLogSelected: () => void;
  onAnnotateSelected: () => void;
  onAddToIndex: () => void;
  onUnstage: () => void;
  onRemove: () => void;
  onStopTracking: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const multi = files.length > 1;
  const allStaged = files.length > 0 && files.every((f) => f.area === "staged");
  const allNotStaged =
    files.length > 0 && files.every((f) => f.area !== "staged");
  const allTracked =
    files.length > 0 && files.every((f) => f.area !== "untracked");
  /** History commit files have no area; treat them as tracked. */
  const showHistoryActions =
    !multi &&
    files.length === 1 &&
    files[0]!.area !== "untracked";
  const showAdd = allowMutations && (multi || allNotStaged);
  const showUnstage = allowMutations && (multi || allStaged);
  const showStopTracking = allowMutations && allTracked;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [x, y]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="File actions"
      className="fixed z-50 min-w-48 rounded-md border border-border bg-surface-raised py-1 text-[12px] shadow-xl shadow-black/40"
      style={{ left: x, top: y }}
    >
      <MenuItem disabled={busy} onClick={onOpen}>
        Open
      </MenuItem>
      <MenuItem disabled={busy || multi} onClick={onReveal}>
        {revealLabel}
      </MenuItem>
      <MenuItem disabled={busy} onClick={onCopyPath}>
        Copy Path to Clipboard
      </MenuItem>
      {showHistoryActions && (
        <>
          <div className="my-1 border-t border-border" role="separator" />
          <MenuItem disabled={busy} onClick={onLogSelected}>
            Log Selected
          </MenuItem>
          <MenuItem disabled={busy} onClick={onAnnotateSelected}>
            Annotate Selected
          </MenuItem>
        </>
      )}
      {allowMutations && (
        <>
          <div className="my-1 border-t border-border" role="separator" />
          {showAdd && (
            <MenuItem disabled={busy || !allNotStaged} onClick={onAddToIndex}>
              Add to index
            </MenuItem>
          )}
          {showUnstage && (
            <MenuItem disabled={busy || !allStaged} onClick={onUnstage}>
              Unstage from index
            </MenuItem>
          )}
          <MenuItem disabled={busy} danger onClick={onRemove}>
            Remove
          </MenuItem>
          {showStopTracking && (
            <MenuItem disabled={busy} onClick={onStopTracking}>
              Stop tracking
            </MenuItem>
          )}
        </>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={[
        "block w-full px-2.5 py-1 text-left disabled:opacity-50",
        danger
          ? "text-danger hover:bg-danger/10"
          : "text-ink hover:bg-surface-overlay",
      ].join(" ")}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CommitForm({
  message,
  amend,
  busy,
  canCommit,
  stagedCount,
  actionError,
  onMessageChange,
  onAmendChange,
  onSubmit,
}: {
  message: string;
  amend: boolean;
  busy: boolean;
  canCommit: boolean;
  stagedCount: number;
  actionError: string | null;
  onMessageChange: (v: string) => void;
  onAmendChange: (v: boolean) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-2 px-3 py-2 text-[12px]">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
        Commit
      </div>
      <textarea
        className="field-input min-h-[72px] resize-y font-sans text-[12px]"
        placeholder="Commit message"
        value={message}
        onChange={(e) => onMessageChange(e.target.value)}
        disabled={busy}
      />
      <label className="flex items-center gap-2 text-[11px] text-ink-muted">
        <input
          type="checkbox"
          checked={amend}
          onChange={(e) => onAmendChange(e.target.checked)}
          disabled={busy}
        />
        Amend previous commit
      </label>
      {actionError && <p className="text-[11px] text-danger">{actionError}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-muted">
          {stagedCount} staged
        </span>
        <button
          type="submit"
          className="btn-primary"
          disabled={
            busy || !canCommit || (!amend && !message.trim()) || (!amend && stagedCount === 0)
          }
        >
          {busy ? "Working…" : amend ? "Amend" : "Commit"}
        </button>
      </div>
    </form>
  );
}

function CommitInfoPanel({
  commit,
  onSelectCommitId,
}: {
  commit: CommitInfo;
  onSelectCommitId?: (commitId: string) => void;
}) {
  const author =
    commit.authorName || commit.authorEmail
      ? [commit.authorName, commit.authorEmail ? `<${commit.authorEmail}>` : null]
          .filter(Boolean)
          .join(" ")
      : "—";

  return (
    <div className="space-y-2 px-3 py-2 text-[12px]">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
        Commit
      </div>
      <div className="font-medium leading-snug text-ink">{commit.subject}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-ink-muted">Hash</dt>
        <dd className="min-w-0 truncate font-mono text-ink" title={commit.id}>
          {commit.id}
        </dd>
        <dt className="text-ink-muted">Author</dt>
        <dd className="min-w-0 truncate text-ink" title={author}>
          {author}
        </dd>
        <dt className="text-ink-muted">Date</dt>
        <dd className="min-w-0 truncate text-ink">
          {commit.authoredAt ? formatCommitTime(commit.authoredAt) : "—"}
        </dd>
        {commit.parents.length > 0 && (
          <>
            <dt className="text-ink-muted">
              {commit.parents.length === 1 ? "Parent" : "Parents"}
            </dt>
            <dd className="min-w-0 font-mono text-ink">
              {commit.parents.map((parentId, index) => (
                <span key={parentId}>
                  {index > 0 && <span className="text-ink-muted">, </span>}
                  {onSelectCommitId ? (
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      title={parentId}
                      onClick={() => onSelectCommitId(parentId)}
                    >
                      {parentId.slice(0, 7)}
                    </button>
                  ) : (
                    <span title={parentId}>{parentId.slice(0, 7)}</span>
                  )}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
      {commit.refs.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {commit.refs.map((ref) => (
            <span
              key={ref}
              className={[
                "rounded px-1 py-px text-[10px] font-medium",
                ref === "HEAD"
                  ? "bg-accent/25 text-accent"
                  : ref.startsWith("tag:")
                    ? "bg-warning/20 text-warning"
                    : ref.includes("/")
                      ? "bg-surface-overlay text-ink-muted"
                      : "bg-success/20 text-success",
              ].join(" ")}
            >
              {ref}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function FilesSplitHandle({
  onDrag,
  onDragEnd,
}: {
  onDrag: (deltaX: number) => void;
  onDragEnd: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const onDragRef = useRef(onDrag);
  const onDragEndRef = useRef(onDragEnd);

  useEffect(() => {
    onDragRef.current = onDrag;
  }, [onDrag]);
  useEffect(() => {
    onDragEndRef.current = onDragEnd;
  }, [onDragEnd]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startX.current = e.clientX;
    setDragging(true);

    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      onDragRef.current(ev.clientX - startX.current);
      startX.current = ev.clientX;
    };
    const onUp = () => {
      setDragging(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      onDragEndRef.current();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file list"
      onPointerDown={onPointerDown}
      className={[
        "z-20 w-1.5 shrink-0 cursor-col-resize touch-none",
        dragging ? "bg-accent/70" : "bg-border hover:bg-accent/50",
      ].join(" ")}
    />
  );
}

function ImagePreviewPane({
  beforeUrl,
  afterUrl,
  path,
  oldPath,
}: {
  beforeUrl: string | null;
  afterUrl: string | null;
  path: string;
  oldPath?: string | null;
}) {
  const both = Boolean(beforeUrl && afterUrl);
  return (
    <div
      className={[
        "flex h-full min-h-0 gap-2 overflow-hidden bg-surface/30 p-3",
        both ? "flex-row" : "flex-col",
      ].join(" ")}
    >
      {beforeUrl && (
        <figure className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
          <figcaption className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            Before
          </figcaption>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <img
              src={beforeUrl}
              alt={oldPath ?? path}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </figure>
      )}
      {afterUrl && (
        <figure className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
          <figcaption className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
            {beforeUrl ? "After" : "Image"}
          </figcaption>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <img
              src={afterUrl}
              alt={path}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </figure>
      )}
    </div>
  );
}

/** Directory path first (root / empty dir first), then filename. */
function compareByDirThenName(a: CommitFileChange, b: CommitFileChange): number {
  const [dirA, nameA] = splitDirAndName(a.path);
  const [dirB, nameB] = splitDirAndName(b.path);
  const dirCmp = dirA.localeCompare(dirB, undefined, { sensitivity: "base" });
  if (dirCmp !== 0) return dirCmp;
  return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
}

function splitDirAndName(path: string): [string, string] {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slash === -1) return ["", path];
  return [path.slice(0, slash), path.slice(slash + 1)];
}

function statusLabel(status: string): string {
  const letter = status.charAt(0);
  if (letter === "?") return "U";
  return letter || "?";
}

/** Colored status chip: letter on a filled rectangle. */
function StatusBadge({ status }: { status: string }) {
  const letter = statusLabel(status);
  const kind = status.charAt(0);

  // Dark letter on color in dark theme; white letter in light theme.
  const onColor =
    "text-[#1a1200] [:is(html.light)_&]:text-white";

  let className: string;
  let style: { backgroundColor: string } | undefined;

  if (kind === "M" || kind === "T") {
    className = onColor;
    style = { backgroundColor: "var(--status-modified)" };
  } else if (kind === "?") {
    // Untracked / new in the working tree.
    className = onColor;
    style = { backgroundColor: "var(--status-new)" };
  } else if (kind === "A") {
    // Added to the index (staged or historical).
    className = onColor;
    style = { backgroundColor: "var(--status-added)" };
  } else if (kind === "D") {
    className = onColor;
    style = { backgroundColor: "var(--status-deleted)" };
  } else if (kind === "R" || kind === "C") {
    className = "bg-accent text-white";
  } else {
    className = onColor;
    style = { backgroundColor: "var(--status-modified)" };
  }

  return (
    <span
      className={[
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px]",
        "font-mono text-[10px] font-bold leading-none",
        className,
      ].join(" ")}
      style={style}
      aria-label={letter}
    >
      {letter}
    </span>
  );
}
