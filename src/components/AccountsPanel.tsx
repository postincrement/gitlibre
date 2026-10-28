import { useState, type FormEvent, type ReactNode } from "react";
import type { Account, AuthKind, CreateAccountRequest, HostingProvider } from "../types/models";
import { Modal } from "./Modal";
import * as api from "../lib/api";

interface AccountsPanelProps {
  accounts: Account[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}

export function AccountsPanel({ accounts, onChanged, onClose }: AccountsPanelProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      setBusy(true);
      setError(null);
      await api.deleteAccount(pendingDelete.id);
      setPendingDelete(null);
      await onChanged();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Accounts" onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">
        Accounts authenticate remote Git operations. Commit name/email are optional and
        separate from authentication. Tokens are stored in the OS keychain, not in config.
      </p>

      {error && (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {accounts.length === 0 ? (
        <p className="mb-4 text-sm text-ink-muted">No accounts yet.</p>
      ) : (
        <ul className="mb-4 max-h-56 space-y-2 overflow-y-auto">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface-overlay px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-medium text-ink">{account.displayName}</div>
                <div className="text-xs text-ink-muted">
                  {account.provider} · {account.username} · {account.authKind.replace("_", " ")}
                  {account.authKind === "https_token" &&
                    (account.hasToken ? " · token saved" : " · missing token")}
                </div>
                {(account.commitName || account.commitEmail) && (
                  <div className="text-xs text-ink-muted">
                    commit: {account.commitName ?? "—"} &lt;{account.commitEmail ?? "—"}&gt;
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn-secondary shrink-0 text-danger"
                disabled={busy}
                onClick={() => setPendingDelete(account)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn-primary" onClick={() => setShowAdd(true)}>
          Add account
        </button>
      </div>

      {showAdd && (
        <AddAccountForm
          onCancel={() => setShowAdd(false)}
          onCreated={async () => {
            setShowAdd(false);
            await onChanged();
          }}
        />
      )}
      {pendingDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface-raised p-4">
            <h3 className="mb-2 font-semibold">Remove account</h3>
            <p className="mb-4 text-sm text-ink-muted">
              Remove {pendingDelete.displayName}? Repositories using it will be unassigned.
              The keychain token will be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AddAccountForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const [provider, setProvider] = useState<HostingProvider>("github");
  const [authKind, setAuthKind] = useState<AuthKind>("https_token");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [token, setToken] = useState("");
  const [commitName, setCommitName] = useState("");
  const [commitEmail, setCommitEmail] = useState("");
  const [sshPath, setSshPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const request: CreateAccountRequest = {
      provider,
      authKind,
      username: username.trim(),
      displayName: displayName.trim() || username.trim(),
      commitName: commitName.trim() || null,
      commitEmail: commitEmail.trim() || null,
      sshPrivateKeyPath: authKind === "ssh_key" ? sshPath || null : null,
      token: authKind === "https_token" ? token : null,
    };
    try {
      setBusy(true);
      setError(null);
      await api.createAccount(request);
      await onCreated();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-border bg-surface-raised p-4 shadow-xl"
      >
        <h3 className="mb-3 text-base font-semibold">Add account</h3>
        {error && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as HostingProvider)}
            className="field-input"
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="bitbucket">Bitbucket</option>
            <option value="generic">Generic</option>
          </select>
        </Field>

        <Field label="Auth method">
          <select
            value={authKind}
            onChange={(e) => setAuthKind(e.target.value as AuthKind)}
            className="field-input"
          >
            <option value="https_token">HTTPS token (PAT)</option>
            <option value="ssh_key">SSH private key</option>
          </select>
        </Field>

        <Field label="Username / login">
          <input
            className="field-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>

        <Field label="Display name">
          <input
            className="field-input"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Defaults to username"
          />
        </Field>

        {authKind === "https_token" ? (
          <Field label="Personal access token">
            <input
              className="field-input"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoComplete="off"
            />
          </Field>
        ) : (
          <Field label="SSH private key path">
            <div className="flex gap-2">
              <input
                className="field-input flex-1"
                value={sshPath}
                onChange={(e) => setSshPath(e.target.value)}
                required
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  void api.pickFile().then((p) => {
                    if (p) setSshPath(p);
                  });
                }}
              >
                Browse
              </button>
            </div>
          </Field>
        )}

        <Field label="Commit name (optional)">
          <input
            className="field-input"
            value={commitName}
            onChange={(e) => setCommitName(e.target.value)}
          />
        </Field>
        <Field label="Commit email (optional)">
          <input
            className="field-input"
            value={commitEmail}
            onChange={(e) => setCommitEmail(e.target.value)}
          />
        </Field>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save account"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block text-sm text-ink-muted">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function formatError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return "Unexpected error";
}
