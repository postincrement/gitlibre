# Architecture

## Goals

- Keep Git and workspace logic independent of the UI framework.
- Talk to repositories through vendored libgit2 (`git2`), not a host `git` or `ssh` binary.
- Stay responsive during long-running fetch operations.
- Persist workspaces without writing into repository working trees.

## Crates

### `gitlibre-core`

Framework-agnostic library:

| Module | Responsibility |
|--------|----------------|
| `models` / `ids` | Workspace, repository, account types; UUID newtypes |
| `store` | In-memory config + atomic JSON persistence + migrations |
| `secrets` | `SecretStore` trait; OS keychain + in-memory test store |
| `auth` | Per-invocation `GitAuth` (HTTPS bearer / OpenSSH private key path) |
| `detect` / `ssh_config` | Remote URL + SSH config + local identity hints |
| `git::session` | Open a repo and run libgit2 on `spawn_blocking` |
| `git::transport` | Fetch, pull, and push through libgit2 + libssh2 |
| `git::status` | Status, remotes, and branch inspection |
| `git::branches` | Local/remote branches + ahead/behind |
| `git::log` | Topo-ordered commit history with decorations |
| `git::show` | Commit / working-tree file lists and unified diffs |
| `git::stage` | Stage, unstage, discard, commit (+ amend, identity) |
| `git::identity` | Read effective / local `user.name` / `user.email` |
| `fetch` | Per-repo locks, bounded concurrency, auth-aware fetch |
| `error` | Typed `CoreError` + stable `ErrorCode` values |

### `gitlibre` (`src-tauri`)

Thin desktop shell:

- Resolves the OS app config directory and opens `ConfigStore`.
- Exposes typed Tauri commands.
- Holds `AppState` (store mutex, fetch coordinator, live fetch flags).
- Emits `repo-fetch-progress`, `repo-fetch-finished`, `workspace-fetch-finished`.
- Native app menu (workspace New/Open, Settings, etc.).

Command handlers stay thin: lock state, call core, map errors to `AppErrorDto`.
Local mutations (stage/commit) use `FetchCoordinator::with_repo_lock` so they
do not race an in-flight fetch on the same path.

## Frontend

React + TypeScript + Vite + Tailwind.

- `TopNav` — workspace context and fetch actions
- `RepoSidebar` — per-repo branch / dirty / fetch / error indicators; remotes
- `RepoDetail` — commit graph + detail split (files / diff / commit form)
- `CommitGraph` — multi-lane visual history + uncommitted synthetic row
- `CommitFilesPane` — file list, diffs; staged/unstaged/untracked actions + commit
- `AccountsPanel` / `RepoAccountDialog` — account CRUD and per-repo assignment
- `lib/api.ts` — typed `invoke` wrappers
- `lib/events.ts` — typed listeners with cleanup in `useEffect`

The UI never shells out to Git.

## Data model

Repositories live in a global registry. Workspaces hold `RepositoryId` lists, so one on-disk repo can appear in multiple workspaces without duplicating path metadata.

Paths are canonicalized when adding. Duplicate membership within a workspace is rejected. Removing a repo from a workspace does not delete files.

## Persistence

`ConfigStore` writes `config.json.tmp` then renames to `config.json`. Schema field `version` is `2` (v1 files migrate on open).

## Fetch concurrency

`FetchCoordinator`:

1. Acquires a per-canonical-path mutex (prevents concurrent Git ops on the same repo).
2. Acquires a semaphore permit (default concurrency 4).
3. Runs `git2` fetch of every remote inside `spawn_blocking` and streams progress strings.
4. Reports progress via callback; workspace fetch fans out independently.

## Staging and commit

Working-tree listings come from libgit2 status and diffs, split into **staged**,
**unstaged**, and **untracked** entries (a path can appear twice when both index
and worktree differ). Diffs are unified patches from `git2`.

Mutations update the index and worktree in process: stage, unstage, discard,
remove, and commit (including amend). Account commit name and email are applied
only to that commit's signature. GitLibre does not write `user.name` or
`user.email` into Git config. When no account identity is set, the repository's
existing config identity is used. Commit signing is not available yet. With
verification left on, GitLibre still runs the repo's `pre-commit` and
`commit-msg` hook scripts.

## Platform notes

- macOS production packaging builds a `.app`. DMG creation uses Finder AppleScript and can time out in headless CI; keep `bundle.targets` as `["app"]` until DMG automation is needed.
- Startup does not search `PATH` for `git`, `ssh`, `plink`, or TortoisePlink.
- HTTPS trust uses OpenSSL's CA bundle. Enterprise roots that exist only in the Windows certificate store are not picked up.

## Multi-account auth (M2)

- Account metadata lives in `config.json` (`accounts[]`); tokens never do.
- Tokens are stored in the OS keychain under service `com.gitlibre.desktop`, key = account UUID.
- Each repository may reference an `account_id`.
- On fetch, pull, and push, GitLibre resolves the account and supplies credentials inside libgit2's callback. Nothing is written back to `.git/config`, and `GIT_SSH` / `GIT_SSH_COMMAND` are never set.
  - HTTPS: username plus bearer token as user/password. A public remote with no account is attempted anonymously; a server 401/403 becomes `AuthenticationFailed`.
  - SSH: the account's OpenSSH private key, loaded with libssh2. Host aliases are rewritten from `~/.ssh/config` (`HostName`, `User`, `IdentityFile`) before connect; the rewritten URL is not saved. Passphrase-protected keys are unsupported. An SSH remote with no assigned key fails before connect and asks for an account.
- The credential callback is the seam for later in-process sources: PuTTY `.ppk` keys, PuTTY sessions, Pageant, and the OpenSSH agent. Those are not part of this port, and they will not be implemented by launching an external SSH or Git program.
- `ProxyJump`, `ProxyCommand`, `Match`, and `Include` are not applied.

### Account detection from existing repos

[`detect.rs`](../crates/gitlibre-core/src/detect.rs) reads:

- Primary remote URL (`origin`, else first) → provider, HTTPS vs SSH, host, owner/login hint
- Local `user.name` / `user.email` → optional commit identity (not auth)
- `~/.ssh/config` via [`ssh_config.rs`](../crates/gitlibre-core/src/ssh_config.rs) when the remote host is an SSH alias → `HostName`, `User`, `IdentityFile`

Example: `git@github-work:org/repo.git` with

```
Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_work
```

detects GitHub + SSH key `~/.ssh/id_ed25519_work`, and can match an existing account by that key path.

On **add repository** and when **opening an unassigned repo**, GitLibre runs detection. If an existing account matches (provider + username, or SSH key path), it is auto-assigned. Otherwise the UI offers “Create account from this…” with fields pre-filled (HTTPS token still entered by the user).

## Future seams (not implemented yet)

- OAuth device flow instead of PAT paste.
- Provider REST adapters for account validation.
- In-process PuTTY `.ppk` keys, PuTTY sessions, Pageant, and the OpenSSH agent, all feeding the same credential callback.
- Merge and rebase tooling.
