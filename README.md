# GitLibre

Free, open-source, cross-platform graphical Git client.

GitLibre groups local repositories into **workspaces**, shows status across them in one window, and runs real system-Git operations (status, fetch) without requiring a SaaS subscription.

This repository is the initial milestone: workspaces, repository registration, status inspection, and individual / workspace-wide fetch.

## Prerequisites

- **Rust** (stable) via [rustup](https://rustup.rs/)
- **Node.js** 20+ and npm
- **Git** on `PATH` (used for all repository operations)
- **Tauri 2 OS dependencies**
  - macOS: Xcode Command Line Tools / Xcode
  - Windows: WebView2
  - Linux: `webkit2gtk` and related packages — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

## Setup

```bash
# Install Rust if needed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Install JS dependencies
npm install
```

## Development

```bash
# Launch the desktop app (Vite + Tauri)
npm run tauri dev
```

Frontend only (no native shell):

```bash
npm run dev
```

## Tests and checks

```bash
# Rust unit + integration tests (uses temporary local Git repos)
cargo test --workspace

# TypeScript
npm run typecheck

# Frontend production bundle
npm run build
```

## Production build

```bash
npm run tauri build
```

Bundles are written under the Cargo target directory (often
`src-tauri/target/release/bundle/` or the workspace `target/release/bundle/`).

On macOS the default bundle target is the `.app` package. Creating a `.dmg`
additionally requires Finder automation and may fail in headless or restricted
environments; enable DMG later by setting `bundle.targets` to include `"dmg"`.

## Project layout

```text
Cargo.toml                 # Rust workspace
crates/gitlibre-core/      # Domain logic (models, persistence, Git)
src-tauri/                 # Thin Tauri shell (commands, events)
src/                       # React + TypeScript UI
docs/                      # Architecture, Rust learning notes, roadmap
```

## Configuration

Workspace configuration is stored as versioned JSON in the platform app config directory (for example macOS `~/Library/Application Support/com.gitlibre.desktop/config.json`). Repository files on disk are never moved or modified by add/remove.

## License

MIT
