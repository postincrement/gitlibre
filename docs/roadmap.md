# Roadmap

## Milestone 1 — complete

- [x] Tauri 2 + React + TypeScript desktop shell
- [x] Named workspaces with JSON persistence
- [x] Add / remove local Git repositories (no disk mutation)
- [x] Sidebar + detail status via system Git
- [x] Individual and workspace-wide fetch with progress events
- [x] Automated tests against temporary local / bare remotes

## Milestone 2 — multi-account foundations (in progress)

- [x] Provider-independent account model (GitHub first; GitLab/Bitbucket/Generic fields ready)
- [x] OS keychain storage for HTTPS tokens (`keyring`)
- [x] Per-repository authentication identity assignment
- [x] Separate optional commit name/email on the account (not used for auth)
- [x] Per-invocation HTTPS Bearer auth / SSH `GIT_SSH_COMMAND` (no global credential switching)
- [ ] GitHub OAuth device flow (currently PAT entry)
- [ ] Apply commit identity to commit operations when those land
- [ ] Validate tokens against provider APIs before save

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
