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

## Process I/O and `PathBuf`

**Where:** `GitExecutor`

Paths are `PathBuf` / `OsString`, not assumed UTF-8 (important on Windows). Arguments are argv arrays — never `sh -c`. `GIT_TERMINAL_PROMPT=0` fails auth fast instead of hanging the UI.

## Serde

**Where:** config JSON + Tauri IPC DTOs in [`src-tauri/src/dto.rs`](../src-tauri/src/dto.rs)

Serde maps Rust structs to JSON. Frontend DTOs use `#[serde(rename_all = "camelCase")]` so TypeScript field names stay idiomatic while Rust stays snake_case.
