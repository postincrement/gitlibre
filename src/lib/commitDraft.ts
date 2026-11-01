/** In-memory commit draft so the message survives leaving the file-status view. */

export interface CommitDraft {
  message: string;
  amend: boolean;
}

const drafts = new Map<string, CommitDraft>();

export function loadCommitDraft(repositoryId: string): CommitDraft {
  return drafts.get(repositoryId) ?? { message: "", amend: false };
}

export function updateCommitDraft(
  repositoryId: string,
  patch: Partial<CommitDraft>,
): void {
  const next = { ...loadCommitDraft(repositoryId), ...patch };
  if (!next.message && !next.amend) drafts.delete(repositoryId);
  else drafts.set(repositoryId, next);
}

export function clearCommitDraft(repositoryId: string): void {
  drafts.delete(repositoryId);
}
