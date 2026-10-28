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
| `git::executor` | Spawn `git` with argv arrays, cwd, optional auth env |
| `git::status` | Porcelain v2 `-z` parsing, remotes, branch inspection |
| `fetch` | Per-repo locks, bounded concurrency, auth-aware fetch |
| `error` | Typed `CoreError` + stable `ErrorCode` values |

### `gitlibre` (`src-tauri`)

Thin desktop shell:

- Resolves the OS app config directory and opens `ConfigStore`.
- Exposes typed Tauri commands.
- Holds `AppState` (store mutex, fetch coordinator, live fetch flags).
- Emits `repo-fetch-progress`, `repo-fetch-finished`, `workspace-fetch-finished`.

Command handlers stay thin: lock state, call core, map errors to `AppErrorDto`.

## Frontend

React + TypeScript + Vite + Tailwind.

- `TopNav` — workspace selector and primary actions
- `RepoSidebar` — per-repo branch / dirty / fetch / error indicators
- `RepoDetail` — path, remotes, working-tree counts, fetch controls
- `lib/api.ts` — typed `invoke` wrappers
- `lib/events.ts` — typed listeners with cleanup in `useEffect`

The UI never shells out to Git.

## Data model

Repositories live in a global registry. Workspaces hold `RepositoryId` lists, so one on-disk repo can appear in multiple workspaces without duplicating path metadata.

Paths are canonicalized when adding. Duplicate membership within a workspace is rejected. Removing a repo from a workspace does not delete files.

## Persistence

`ConfigStore` writes `config.json.tmp` then renames to `config.json`. Schema field `version` starts at `1` for future migrations.

## Fetch concurrency

`FetchCoordinator`:

1. Acquires a per-canonical-path mutex (prevents concurrent Git ops on the same repo).
2. Acquires a semaphore permit (default concurrency 4).
3. Runs `git fetch --all --progress` with `GIT_TERMINAL_PROMPT=0`.
4. Reports progress via callback; workspace fetch fans out independently.

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
- Config schema version is `2` (v1 files migrate on open).

## Future seams (not implemented yet)

- OAuth device flow instead of PAT paste.
- Provider REST adapters for account validation.
- Staging, commit graph, merge tooling as additional core modules.
