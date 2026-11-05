import { useCallback, useEffect, useState, type FormEvent } from "react";
import * as api from "../lib/api";
import { formatError } from "../lib/formatError";
import type { RepositoryId, StashEntry } from "../types/models";
import { Modal } from "./Modal";

interface StashDialogProps {
  repositoryId: RepositoryId;
  onClose: () => void;
  onChanged: () => void;
}

export function StashDialog({ repositoryId, onClose, onChanged }: StashDialogProps) {
  const [entries, setEntries] = useState<StashEntry[]>([]);
  const [message, setMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const listed = await api.listStashes(repositoryId);
    setEntries(listed);
  }, [repositoryId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listStashes(repositoryId)
      .then((listed) => {
        if (!cancelled) setEntries(listed);
      })
      .catch((e) => {
        if (!cancelled) setError(formatError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setConfirmDrop(null);
    try {
      await action();
      await reload();
      onChanged();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const text = message;
    void run(async () => {
      await api.saveStash(repositoryId, text, includeUntracked);
      setMessage("");
    });
  }

  return (
    <Modal title="Stash" onClose={busy ? undefined : onClose} panelClassName="max-w-lg">
      <form onSubmit={handleSave} className="mb-4">
        <label className="mb-1 block text-sm text-ink-muted" htmlFor="stash-message">
          Message
        </label>
        <input
          id="stash-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={busy}
          placeholder="Optional. Leave blank for the default message."
          className="field-input mb-3"
        />
        <label className="mb-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={includeUntracked}
            disabled={busy}
            onChange={(e) => setIncludeUntracked(e.target.checked)}
          />
          Include untracked files
        </label>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy}>
            Stash
          </button>
        </div>
      </form>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}

      <h3 className="mb-2 text-sm font-semibold text-ink">Saved stashes</h3>
      {loading ? (
        <p className="text-sm text-ink-muted">Loading stashes…</p>
      ) : entries.length === 0 ? (
        error ? null : <p className="text-sm text-ink-muted">No stashes.</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-auto">
          {entries.map((entry) => (
            <li
              key={`${entry.index}-${entry.oid}`}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-ink" title={entry.message}>
                <span className="mr-2 font-mono text-xs text-ink-muted">
                  stash@{"{"}
                  {entry.index}
                  {"}"}
                </span>
                {entry.message}
              </span>
              {confirmDrop === entry.index ? (
                <>
                  <button
                    type="button"
                    className="btn-danger px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => void run(() => api.dropStash(repositoryId, entry.index))}
                  >
                    Drop
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => setConfirmDrop(null)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => void run(() => api.applyStash(repositoryId, entry.index))}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => void run(() => api.popStash(repositoryId, entry.index))}
                  >
                    Pop
                  </button>
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-xs"
                    disabled={busy}
                    onClick={() => setConfirmDrop(entry.index)}
                  >
                    Drop
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
