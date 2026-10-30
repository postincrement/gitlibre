# Rust learning notes (from GitLibre)

Concise notes tied to real code in this repo. Written for an experienced C++ engineer.

## Ownership and borrowing

**Where:** `ConfigStore` methods in [`crates/gitlibre-core/src/store.rs`](../crates/gitlibre-core/src/store.rs)

Rust values have a single owner. Passing by value *moves* (like a destructive move in C++ without a valid moved-from state for use). Shared access uses borrows:

- `&T` — shared immutable (many readers)
- `&mut T` — exclusive mutable (one writer)

Unlike C++ references, the borrow checker rejects overlapping `&mut` with any other borrow at compile time. That is why `add_repository_to_workspace` looks up registry IDs *before* taking a mutable borrow of the workspace list.

## `Result`, `Option`, and `?`

**Where:** `CoreResult` / `CoreError` in [`crates/gitlibre-core/src/error.rs`](../crates/gitlibre-core/src/error.rs)

Operational failures return `Result<T, CoreError>` instead of throwing. The `?` operator propagates `Err` early — similar to early-return on `HRESULT` / `expected`, but enforced by the type system.

`Option<T>` is for absence (`None`), not failure. Prefer `Option` for “no active workspace”; prefer `Result` for “load failed”.

## Newtypes

**Where:** [`crates/gitlibre-core/src/ids.rs`](../crates/gitlibre-core/src/ids.rs)

```rust
struct WorkspaceId(Uuid);
struct RepositoryId(Uuid);
```

Stronger than `using WorkspaceId = std::string` in C++: you cannot pass a repository id where a workspace id is required. `#[serde(transparent)]` serializes them as plain UUID strings.

## Enums and pattern matching

**Where:** `ErrorCode`, porcelain classification in [`crates/gitlibre-core/src/git/status.rs`](../crates/gitlibre-core/src/git/status.rs)

Rust enums are tagged unions (like `std::variant` with niceties). `match` is exhaustive: forget a variant and the compiler errors. Useful for mapping Git XY status bytes to counters.

## Traits and derives

**Where:** `Serialize` / `Deserialize` on models; `Error` via `thiserror`

Traits are closest to C++ concepts + abstract interfaces. `#[derive(Serialize)]` is compile-time codegen (like a macro that writes a serializer), not runtime reflection.

## Modules and Cargo workspaces

**Where:** root [`Cargo.toml`](../Cargo.toml), [`crates/gitlibre-core`](../crates/gitlibre-core), [`src-tauri`](../src-tauri)

A *crate* is a compilation unit (static/dynamic library or binary). A *workspace* groups crates with shared dependency versions. `gitlibre-core` is a library crate; `gitlibre` depends on it with a path dependency — analogous to a CMake library target linked into an app target.

`mod foo;` loads `foo.rs` or `foo/mod.rs`. `pub use` re-exports for a clean public API from `lib.rs`.

## Async / Tokio

**Where:** [`crates/gitlibre-core/src/git/executor.rs`](../crates/gitlibre-core/src/git/executor.rs), [`crates/gitlibre-core/src/fetch.rs`](../crates/gitlibre-core/src/fetch.rs)

`async fn` returns a future; `.await` polls it. Tokio provides the runtime, process APIs, `Semaphore`, and `Mutex`.

Compared to C++ coroutines / thread pools: Rust futures are inert until polled; sending non-`Send` types across `.await` points is a compile error. We use `tokio::sync::Mutex` when holding locks across awaits; `std::sync::Mutex` in the Tauri layer for short critical sections that do not await.

## Shared state without `Arc<Mutex>` sprawl

**Where:** `FetchCoordinator` clones `Arc<Semaphore>` / lock map handles; Tauri `AppState` uses `Mutex<ConfigStore>`

Share ownership only at boundaries that need it (coordinator clone into tasks). Prefer passing `&AppState` into helpers rather than wrapping everything in `Arc`.

## Paths and blocking Git work

**Where:** `git::session` and `git::transport`

Paths are `PathBuf` / `OsString`, not assumed UTF-8 (important on Windows). Repository work goes through `git2` on `spawn_blocking` so the UI thread is not stuck inside libgit2. SSH and HTTPS credentials are supplied in-process; GitLibre does not spawn `git` or `ssh`.

## Serde

**Where:** config JSON + Tauri IPC DTOs in [`src-tauri/src/dto.rs`](../src-tauri/src/dto.rs)

Serde maps Rust structs to JSON. Frontend DTOs use `#[serde(rename_all = "camelCase")]` so TypeScript field names stay idiomatic while Rust stays snake_case.

Enum rename rules matter: `#[serde(rename_all = "snake_case")]` turns `GitHub` into `git_hub`. For provider ids we want `github`, so `HostingProvider` uses `rename_all = "lowercase"`.

## Traits as capability boundaries

**Where:** [`crates/gitlibre-core/src/secrets.rs`](../crates/gitlibre-core/src/secrets.rs)

`SecretStore` is a trait (closest C++ analogue: abstract interface / concept). Production uses `KeyringSecretStore`; tests use `MemorySecretStore`. The Tauri layer holds `Box<dyn SecretStore>` — dynamic dispatch at the app boundary, while core APIs take `&dyn SecretStore` or concrete types in tests. Prefer static generics when hot paths need it; `Box<dyn …>` is fine for rare secret I/O.

## Config migration

**Where:** `migrate_config` in [`crates/gitlibre-core/src/models.rs`](../crates/gitlibre-core/src/models.rs)

Persisted `version` lets us evolve the schema. Opening a v1 file fills defaults for new fields (`accounts`, `account_id`) and bumps to v2. Similar to a lightweight data migration without a database.

## Parsing text formats without “stringly” APIs

**Where:** [`crates/gitlibre-core/src/ssh_config.rs`](../crates/gitlibre-core/src/ssh_config.rs)

OpenSSH config is line-oriented with optional `Key Value` or `Key=Value` forms. We parse into structured `HostBlock` values, then resolve with OpenSSH’s first-wins rule. Prefer returning typed results (`ResolvedSshHost`) over scattering string splits through callers — same instinct as parsing into a C++ struct instead of keeping `std::string` bags.

## Pathspecs and argv safety

**Where:** [`crates/gitlibre-core/src/git/stage.rs`](../crates/gitlibre-core/src/git/stage.rs)

User-facing paths become `git add -- <path>` arguments. Validate before spawn: reject empty/`NUL`, leading `-` (option injection), absolute paths, and `..` components. The `--` separator stops Git treating a path as a flag — same idea as not concatenating untrusted strings into a shell command.
