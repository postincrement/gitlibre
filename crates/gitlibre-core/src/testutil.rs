//! Build fixture repositories with libgit2. Tests do not shell out to `git`.

use std::path::{Path, PathBuf};

pub fn init_repo(path: &Path) -> git2::Repository {
    let mut opts = git2::RepositoryInitOptions::new();
    opts.initial_head("main");
    let repo = git2::Repository::init_opts(path, &opts).expect("init repo");
    set_identity(&repo, "Test", "test@example.com");
    repo
}

pub fn init_bare(path: &Path) -> git2::Repository {
    let mut opts = git2::RepositoryInitOptions::new();
    opts.bare(true).initial_head("main");
    git2::Repository::init_opts(path, &opts).expect("init bare")
}

pub fn set_identity(repo: &git2::Repository, name: &str, email: &str) {
    let mut cfg = repo.config().unwrap();
    cfg.set_str("user.name", name).unwrap();
    cfg.set_str("user.email", email).unwrap();
}

pub fn commit_file(repo: &git2::Repository, rel: &str, content: &str, message: &str) -> git2::Oid {
    let workdir = repo.workdir().expect("workdir");
    let file = workdir.join(rel);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(&file, content).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(rel)).unwrap();
    index.write().unwrap();
    let tree_id = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_id).unwrap();
    let name = config_string(repo, "user.name").unwrap_or_else(|| "Test".into());
    let email = config_string(repo, "user.email").unwrap_or_else(|| "test@example.com".into());
    let sig = git2::Signature::now(&name, &email).unwrap();
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .unwrap()
}

fn config_string(repo: &git2::Repository, key: &str) -> Option<String> {
    repo.config().ok()?.get_string(key).ok()
}

pub fn add_remote(repo: &git2::Repository, name: &str, url: &str) {
    repo.remote(name, url).unwrap();
}

pub fn push_branch(repo: &git2::Repository, remote_name: &str, branch: &str) {
    let mut remote = repo.find_remote(remote_name).unwrap();
    let spec = format!("refs/heads/{branch}:refs/heads/{branch}");
    remote.push(&[&spec], None).unwrap();
    let mut cfg = repo.config().unwrap();
    cfg.set_str(&format!("branch.{branch}.remote"), remote_name)
        .unwrap();
    cfg.set_str(
        &format!("branch.{branch}.merge"),
        &format!("refs/heads/{branch}"),
    )
    .unwrap();
}

pub fn clone_repo(url: &str, dest: &Path) -> git2::Repository {
    git2::build::RepoBuilder::new()
        .clone(url, dest)
        .expect("clone")
}

pub fn setup_local_and_bare(root: &Path) -> (PathBuf, PathBuf) {
    let bare_path = root.join("remote.git");
    let local_path = root.join("local");
    init_bare(&bare_path);
    let local = init_repo(&local_path);
    commit_file(&local, "file.txt", "v1", "init");
    let url = bare_path.to_string_lossy().into_owned();
    add_remote(&local, "origin", &url);
    push_branch(&local, "origin", "main");
    (local_path, bare_path)
}
