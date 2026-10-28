# Roadmap

## Milestone 1 — complete in this tree

- [x] Tauri 2 + React + TypeScript desktop shell
- [x] Named workspaces with JSON persistence
- [x] Add / remove local Git repositories (no disk mutation)
- [x] Sidebar + detail status via system Git
- [x] Individual and workspace-wide fetch with progress events
- [x] Automated tests against temporary local / bare remotes

## Milestone 2 — multi-account foundations

- [ ] Provider-independent account model (GitHub first)
- [ ] OS keychain storage for tokens
- [ ] Per-repository authentication identity (separate from commit `user.name` / `user.email`)
- [ ] Non-interactive HTTPS auth without global credential switching
- [ ] Optional SSH identity selection per repository

## Milestone 3 — richer workspace operations

- [ ] Pull all / push all with the same concurrency and locking model
- [ ] Workspace-wide changes view
- [ ] Coordinated branch switching (best-effort)
- [ ] Portable workspace definition import/export
- [ ] Repository search within a workspace

## Milestone 4 — advanced Git UX

- [ ] Visual commit graph
- [ ] Interactive staging and commit
- [ ] Diff viewing
- [ ] Branch create / merge / rebase / cherry-pick
- [ ] Conflict resolution UI
- [ ] Worktrees, submodules, LFS awareness

## Explicitly deferred / non-goals for early milestones

- Subscriptions or artificial feature locks
- Electron or a Node.js backend server
- Embedded database for M1–M2 configuration
- libgit2 / `git2` (revisit only if system Git proves insufficient)
