# Architecture

## Goals

- Keep Git and workspace logic independent of the UI framework.
- Prefer the system `git` executable over embedding libgit2.
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
| `auth` | Per-invocation `GitAuth` (HTTPS bearer / SSH key env) |
| `detect` / `ssh_config` | Remote URL + SSH config + local identity hints |
| `git::executor` | Spawn `git` with argv arrays, cwd, optional auth env |
| `git::status` | Porcelain v2 `-z` parsing, remotes, branch inspection |
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
3. Runs `git fetch --all --progress` with `GIT_TERMINAL_PROMPT=0`.
4. Reports progress via callback; workspace fetch fans out independently.

## Staging and commit

Working-tree listings parse porcelain v1 into separate **staged**, **unstaged**,
and **untracked** entries (a path can appear twice when both index and worktree
differ). Diffs use `git diff --cached`, `git diff`, or `git diff --no-index`
accordingly.

Mutations:

| Action | Git |
|--------|-----|
| Stage | `git add -- <paths>` |
| Unstage | `git restore --staged -- <paths>` |
| Discard staged | `git restore --source=HEAD --staged --worktree -- <paths>` |
| Discard unstaged | `git restore --worktree -- <paths>` |
| Discard untracked | `git clean -f -d -- <paths>` |
| Commit | `git commit [-c user.*] [-m \| --no-edit] [--amend]` |

When the repository has an assigned account with `commitName` / `commitEmail`,
those values are passed as one-shot `-c user.name` / `-c user.email` (no global
config rewrite). Otherwise system Git identity applies.

## Platform notes

- macOS production packaging builds a `.app`. DMG creation uses Finder AppleScript and can time out in headless CI; keep `bundle.targets` as `["app"]` until DMG automation is needed.
- Git discovery uses `PATH` plus common Homebrew/`/usr/bin` locations.
- Auth hangs are avoided with `GIT_TERMINAL_PROMPT=0` and an empty `GIT_ASKPASS`.

## Multi-account auth (M2)

- Account metadata lives in `config.json` (`accounts[]`); tokens never do.
- Tokens are stored in the OS keychain under service `com.gitlibre.desktop`, key = account UUID.
- Each repository may reference an `account_id`.
- On fetch, GitLibre resolves the account and applies **per-process** env:
  - HTTPS: `GIT_CONFIG_*` `http.extraHeader=AUTHORIZATION: bearer …` and empty `credential.helper` for that invocation only.
  - SSH: `GIT_SSH_COMMAND=ssh -i … -o IdentitiesOnly=yes -o BatchMode=yes`.
- Unassigned repos continue to use the user’s normal system Git credentials.

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
- Checkout, pull/push, merge/rebase tooling as additional core modules.
