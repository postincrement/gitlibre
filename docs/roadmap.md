# Roadmap

## Milestone 1 — complete

- [x] Tauri 2 + React + TypeScript desktop shell
- [x] Named workspaces with JSON persistence
- [x] Add / remove local Git repositories (no disk mutation)
- [x] Sidebar + detail status via libgit2 (`git2`)
- [x] Individual and workspace-wide fetch with progress events
- [x] Automated tests against temporary local / bare remotes

## Milestone 2 — multi-account foundations

- [x] Provider-independent account model (GitHub first; GitLab/Bitbucket/Generic fields ready)
- [x] OS keychain storage for HTTPS tokens (`keyring`)
- [x] Per-repository authentication identity assignment
- [x] Separate optional commit name/email on the account (not used for auth)
- [x] Per-invocation HTTPS bearer auth and libssh2 SSH keys (no host `git`/`ssh`, no global credential switching)
- [x] Detect accounts from remotes + `~/.ssh/config` + local `user.name` / `user.email`
- [x] Apply account commit identity to the commit signature without writing Git config
- [ ] GitHub OAuth device flow (currently PAT entry)
- [ ] Validate tokens against provider APIs before save

## Milestone 3 — local mutations & sync (in progress)

- [x] Visual commit graph (topo log, lanes, refs, infinite scroll)
- [x] Diff viewing (commit + working tree, staged/unstaged/untracked)
- [x] Interactive staging / unstaging / discard
- [x] Commit (+ amend) with optional account identity
- [ ] Branch checkout / create / delete
- [ ] Pull and push (auth-aware, with progress)
- [ ] Pull all / push all with the same concurrency and locking model
- [ ] Conflict detection and resolution UI
- [ ] Workspace-wide changes view
- [ ] Coordinated branch switching (best-effort)
- [ ] Portable workspace definition import/export
- [ ] Repository search within a workspace

## Milestone 4 — advanced Git UX

- [ ] Branch merge / rebase / cherry-pick
- [ ] Interactive rebase tooling
- [ ] Worktrees, submodules, LFS awareness
- [ ] Clone / init from the app
- [ ] Filesystem watching for external Git changes

## Explicitly deferred / non-goals for early milestones

- Subscriptions or artificial feature locks
- Electron or a Node.js backend server
- Embedded database for early configuration
- Launching Git for Windows, OpenSSH, PuTTY, or TortoisePlink (credentials stay inside GitLibre; `.ppk`, PuTTY sessions, Pageant, and the OpenSSH agent are future in-process sources)
