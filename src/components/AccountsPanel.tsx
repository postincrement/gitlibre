import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  Account,
  AuthKind,
  CreateAccountRequest,
  DetectedAccount,
  HostingProvider,
  UpdateAccountRequest,
} from "../types/models";
import { Modal } from "./Modal";
import * as api from "../lib/api";
import { formatError } from "../lib/formatError";

interface AccountsPanelProps {
  accounts: Account[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}

export function AccountsPanel({ accounts, onChanged, onClose }: AccountsPanelProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
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
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setEditing(account)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-secondary text-danger"
                  disabled={busy}
                  onClick={() => setPendingDelete(account)}
                >
                  Remove
                </button>
              </div>
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
      {editing && (
        <EditAccountForm
          account={editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
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

export function AddAccountForm({
  draft,
  title = "Add account",
  onCancel,
  onCreated,
}: {
  draft?: DetectedAccount | null;
  title?: string;
  onCancel: () => void;
  onCreated: (account: Account) => Promise<void>;
}) {
  const [provider, setProvider] = useState<HostingProvider>(draft?.provider ?? "github");
  const [authKind, setAuthKind] = useState<AuthKind>(draft?.authKind ?? "https_token");
  const [username, setUsername] = useState(draft?.suggestedUsername ?? "");
  const [displayName, setDisplayName] = useState(
    draft?.sshHostAlias
      ? `${draft.suggestedUsername ?? draft.sshHostAlias} (${draft.sshHostAlias})`
      : (draft?.suggestedUsername ?? ""),
  );
  const [token, setToken] = useState("");
  const [commitName, setCommitName] = useState(draft?.commitName ?? "");
  const [commitEmail, setCommitEmail] = useState(draft?.commitEmail ?? "");
  const [sshPath, setSshPath] = useState(draft?.suggestedSshKeyPath ?? "");
  const [sshKeys, setSshKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authKind !== "ssh_key") return;
    void api.listSshPrivateKeys().then((keys) => {
      setSshKeys(keys);
      setSshPath((current) => {
        if (current) return current;
        if (draft?.suggestedSshKeyPath) return draft.suggestedSshKeyPath;
        if (keys.length === 1) return keys[0];
        return current;
      });
    });
  }, [authKind, draft?.suggestedSshKeyPath]);

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
      const account = await api.createAccount(request);
      await onCreated(account);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountFormShell
      title={title}
      draft={draft}
      error={error}
      busy={busy}
      provider={provider}
      setProvider={setProvider}
      authKind={authKind}
      setAuthKind={setAuthKind}
      username={username}
      setUsername={setUsername}
      displayName={displayName}
      setDisplayName={setDisplayName}
      token={token}
      setToken={setToken}
      tokenRequired
      tokenHint={null}
      commitName={commitName}
      setCommitName={setCommitName}
      commitEmail={commitEmail}
      setCommitEmail={setCommitEmail}
      sshPath={sshPath}
      setSshPath={setSshPath}
      sshKeys={sshKeys}
      onCancel={onCancel}
      onSubmit={handleSubmit}
      submitLabel="Save account"
    />
  );
}

function EditAccountForm({
  account,
  onCancel,
  onSaved,
}: {
  account: Account;
  onCancel: () => void;
  onSaved: (account: Account) => Promise<void>;
}) {
  const [provider, setProvider] = useState<HostingProvider>(account.provider);
  const [authKind, setAuthKind] = useState<AuthKind>(account.authKind);
  const [username, setUsername] = useState(account.username);
  const [displayName, setDisplayName] = useState(account.displayName);
  const [token, setToken] = useState("");
  const [commitName, setCommitName] = useState(account.commitName ?? "");
  const [commitEmail, setCommitEmail] = useState(account.commitEmail ?? "");
  const [sshPath, setSshPath] = useState(account.sshPrivateKeyPath ?? "");
  const [sshKeys, setSshKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authKind !== "ssh_key") return;
    void api.listSshPrivateKeys().then((keys) => {
      setSshKeys(keys);
    });
  }, [authKind]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const request: UpdateAccountRequest = {
      id: account.id,
      provider,
      authKind,
      username: username.trim(),
      displayName: displayName.trim() || username.trim(),
      commitName: commitName.trim() || null,
      commitEmail: commitEmail.trim() || null,
      sshPrivateKeyPath: authKind === "ssh_key" ? sshPath || null : null,
      token: authKind === "https_token" ? token || null : null,
    };
    try {
      setBusy(true);
      setError(null);
      const saved = await api.updateAccount(request);
      await onSaved(saved);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  const needsNewToken = authKind === "https_token" && !account.hasToken;
  const tokenHint =
    authKind === "https_token" && account.hasToken && account.authKind === "https_token"
      ? "Leave blank to keep the saved token."
      : null;

  return (
    <AccountFormShell
      title="Edit account"
      draft={null}
      error={error}
      busy={busy}
      provider={provider}
      setProvider={setProvider}
      authKind={authKind}
      setAuthKind={setAuthKind}
      username={username}
      setUsername={setUsername}
      displayName={displayName}
      setDisplayName={setDisplayName}
      token={token}
      setToken={setToken}
      tokenRequired={needsNewToken}
      tokenHint={tokenHint}
      commitName={commitName}
      setCommitName={setCommitName}
      commitEmail={commitEmail}
      setCommitEmail={setCommitEmail}
      sshPath={sshPath}
      setSshPath={setSshPath}
      sshKeys={sshKeys}
      onCancel={onCancel}
      onSubmit={handleSubmit}
      submitLabel="Save changes"
    />
  );
}

function AccountFormShell({
  title,
  draft,
  error,
  busy,
  provider,
  setProvider,
  authKind,
  setAuthKind,
  username,
  setUsername,
  displayName,
  setDisplayName,
  token,
  setToken,
  tokenRequired,
  tokenHint,
  commitName,
  setCommitName,
  commitEmail,
  setCommitEmail,
  sshPath,
  setSshPath,
  sshKeys,
  onCancel,
  onSubmit,
  submitLabel,
}: {
  title: string;
  draft?: DetectedAccount | null;
  error: string | null;
  busy: boolean;
  provider: HostingProvider;
  setProvider: (v: HostingProvider) => void;
  authKind: AuthKind;
  setAuthKind: (v: AuthKind) => void;
  username: string;
  setUsername: (v: string) => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  token: string;
  setToken: (v: string) => void;
  tokenRequired: boolean;
  tokenHint: string | null;
  commitName: string;
  setCommitName: (v: string) => void;
  commitEmail: string;
  setCommitEmail: (v: string) => void;
  sshPath: string;
  setSshPath: (v: string) => void;
  sshKeys: string[];
  onCancel: () => void;
  onSubmit: (e: FormEvent) => void;
  submitLabel: string;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg border border-border bg-surface-raised p-4 shadow-xl"
      >
        <h3 className="mb-3 text-base font-semibold">{title}</h3>
        {draft?.primaryRemoteUrl && (
          <p className="mb-2 break-all font-mono text-xs text-ink-muted">
            From remote: {draft.primaryRemoteUrl}
          </p>
        )}
        {draft?.sshHostAlias && draft.resolvedHost && (
          <p className="mb-3 text-xs text-ink-muted">
            SSH config: <span className="text-ink">{draft.sshHostAlias}</span> →{" "}
            <span className="text-ink">{draft.resolvedHost}</span>
            {draft.suggestedSshKeyPath && (
              <>
                {" "}
                using{" "}
                <span className="break-all font-mono text-ink">{draft.suggestedSshKeyPath}</span>
              </>
            )}
          </p>
        )}
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
              required={tokenRequired}
              autoComplete="off"
              placeholder={tokenHint ? "••••••••" : undefined}
            />
            {tokenHint && <p className="mt-1 text-xs text-ink-muted">{tokenHint}</p>}
          </Field>
        ) : (
          <Field label="SSH private key path">
            <div className="flex gap-2">
              <input
                className="field-input flex-1"
                list="ssh-private-key-suggestions"
                value={sshPath}
                onChange={(e) => setSshPath(e.target.value)}
                placeholder="~/.ssh/id_ed25519"
                required
              />
              <datalist id="ssh-private-key-suggestions">
                {sshKeys.map((key) => (
                  <option key={key} value={key} />
                ))}
              </datalist>
              <button
                type="button"
                className="btn-secondary"
                title="Opens the file dialog in ~/.ssh"
                onClick={() => {
                  void api.pickSshKey().then((p) => {
                    if (p) setSshPath(p);
                  });
                }}
              >
                Browse
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Pre-filled from SSH config when available. Browse opens in ~/.ssh.
            </p>
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
            {busy ? "Saving…" : submitLabel}
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

