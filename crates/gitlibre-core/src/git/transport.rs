//! In-process fetch, push, and pull.
//!
//! SSH is libssh2 inside this process. Credential material is produced here and
//! handed to libgit2. Later sources (PuTTY `.ppk`, a PuTTY session, Pageant, the
//! OpenSSH agent) belong in [`supply_cred`] and must not launch an external
//! `ssh`, `plink`, or `git` program.

use crate::auth::GitAuth;
use crate::error::{CoreError, CoreResult, ErrorCode};
use crate::git::session::{map_git2, open_repo, string_list};
use crate::ssh_config::{default_ssh_config_path, SshConfigFile};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// What libgit2's credential callback receives for an SSH remote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshCallbackInputs {
    pub url: String,
    pub username: String,
    pub private_key_path: PathBuf,
    /// `IdentityFile` from the parsed SSH config, when the host block set one.
    pub config_identity_file: Option<PathBuf>,
}

/// Rewrite an SSH URL with a parsed SSH config and record the key the callback will use.
///
/// Non-SSH URLs are returned unchanged and yield `Ok(None)` when `auth` is not an SSH key.
pub fn ssh_callback_inputs(
    url: &str,
    private_key_path: &Path,
    config: Option<&SshConfigFile>,
) -> Option<SshCallbackInputs> {
    let prepared = prepare_remote_url(url, config);
    if !prepared.is_ssh {
        return None;
    }
    Some(SshCallbackInputs {
        url: prepared.url,
        username: prepared.ssh_username.unwrap_or_else(|| "git".into()),
        private_key_path: private_key_path.to_path_buf(),
        config_identity_file: prepared.identity_file,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedUrl {
    pub url: String,
    pub is_ssh: bool,
    pub is_http: bool,
    pub ssh_username: Option<String>,
    pub identity_file: Option<PathBuf>,
}

pub fn prepare_remote_url(url: &str, config: Option<&SshConfigFile>) -> PreparedUrl {
    let is_http = is_http_url(url);
    if let Some(parts) = parse_ssh_url(url) {
        let resolved = config.map(|cfg| cfg.resolve(&parts.host));
        let host = resolved
            .as_ref()
            .map(|r| r.host_name.clone())
            .unwrap_or(parts.host);
        let user = resolved
            .as_ref()
            .and_then(|r| r.user.clone())
            .unwrap_or(parts.user);
        let identity_file = resolved
            .as_ref()
            .and_then(|r| r.identity_files.first().cloned());
        let path = parts.path.trim_start_matches('/');
        return PreparedUrl {
            url: format!("ssh://{user}@{host}/{path}"),
            is_ssh: true,
            is_http: false,
            ssh_username: Some(user),
            identity_file,
        };
    }
    PreparedUrl {
        url: url.to_string(),
        is_ssh: false,
        is_http,
        ssh_username: None,
        identity_file: None,
    }
}

struct SshParts {
    user: String,
    host: String,
    path: String,
}

fn parse_ssh_url(url: &str) -> Option<SshParts> {
    if let Some(rest) = url
        .strip_prefix("ssh://")
        .or_else(|| url.strip_prefix("ssh+git://"))
        .or_else(|| url.strip_prefix("git+ssh://"))
    {
        let (hostport, path) = rest.split_once('/')?;
        let (user, hostport) = match hostport.rsplit_once('@') {
            Some((user, host)) => (user.to_string(), host),
            None => ("git".to_string(), hostport),
        };
        let host = hostport.split(':').next().unwrap_or(hostport).to_string();
        if host.is_empty() || path.is_empty() {
            return None;
        }
        return Some(SshParts {
            user,
            host,
            path: path.to_string(),
        });
    }
    if url.contains("://") {
        return None;
    }
    let (user_host, path) = url.split_once(':')?;
    if user_host.contains('/') || path.is_empty() {
        return None;
    }
    let (user, host) = match user_host.split_once('@') {
        Some((user, host)) => (user.to_string(), host.to_string()),
        None => ("git".to_string(), user_host.to_string()),
    };
    if host.is_empty() {
        return None;
    }
    Some(SshParts { user, host, path: path.to_string() })
}

fn is_http_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

fn load_ssh_config() -> Option<SshConfigFile> {
    let path = default_ssh_config_path()?;
    SshConfigFile::load_path(&path)
}

pub struct FetchRun {
    pub summary: String,
}

/// Fetch every configured remote. SSH without an account key fails before connecting.
pub fn fetch_all(
    repo_path: &Path,
    auth: Option<&GitAuth>,
    mut on_progress: impl FnMut(String),
) -> CoreResult<FetchRun> {
    let repo = open_repo(repo_path)?;
    let names = remote_names(&repo)?;
    if names.is_empty() {
        return Err(CoreError::new(
            ErrorCode::NoRemotes,
            "No remotes configured for this repository.",
        ));
    }
    let config = load_ssh_config();
    let mut last = String::new();
    for name in &names {
        let summary = fetch_named(&repo, name, auth, config.as_ref(), &mut on_progress)?;
        if !summary.is_empty() {
            last = summary;
        }
    }
    Ok(FetchRun {
        summary: if last.is_empty() {
            "Fetch completed".into()
        } else {
            last
        },
    })
}

fn remote_names(repo: &git2::Repository) -> CoreResult<Vec<String>> {
    let remotes = repo.remotes().map_err(map_git2)?;
    Ok(string_list(&remotes))
}

fn fetch_named(
    repo: &git2::Repository,
    name: &str,
    auth: Option<&GitAuth>,
    config: Option<&SshConfigFile>,
    on_progress: &mut impl FnMut(String),
) -> CoreResult<String> {
    let named = repo.find_remote(name).map_err(map_git2)?;
    let original_url = named.url().unwrap_or("").to_string();
    let specs = string_list(&named.fetch_refspecs().map_err(map_git2)?);
    let prepared = prepare_remote_url(&original_url, config);
    require_auth_for_url(&prepared, auth)?;
    let ssh = ssh_inputs(auth, &original_url, config);
    let spec_refs: Vec<&str> = specs.iter().map(String::as_str).collect();
    let messages = Rc::new(RefCell::new(Vec::new()));
    {
        let messages_for_cb = Rc::clone(&messages);
        let callbacks = remote_callbacks(auth, &prepared, ssh.as_ref(), move |msg| {
            messages_for_cb.borrow_mut().push(msg.clone());
            on_progress(msg);
        });
        let mut options = git2::FetchOptions::new();
        options.remote_callbacks(callbacks);
        let mut remote = if prepared.url != original_url {
            repo.remote_anonymous(&prepared.url).map_err(map_git2)?
        } else {
            repo.find_remote(name).map_err(map_git2)?
        };
        remote
            .fetch(&spec_refs, Some(&mut options), None)
            .map_err(map_git2)?;
    }
    let messages = messages.borrow();
    Ok(messages
        .last()
        .cloned()
        .unwrap_or_else(|| format!("Fetched {name}")))
}

fn require_auth_for_url(prepared: &PreparedUrl, auth: Option<&GitAuth>) -> CoreResult<()> {
    if prepared.is_ssh && !matches!(auth, Some(GitAuth::SshKey { .. })) {
        return Err(CoreError::new(
            ErrorCode::AuthenticationFailed,
            "Authentication failed. Assign an SSH account in GitLibre and retry.",
        ));
    }
    Ok(())
}

/// Build the libgit2 credential callback.
///
/// This is the seam for later in-process sources. Add them inside [`supply_cred`].
fn ssh_inputs(
    auth: Option<&GitAuth>,
    url: &str,
    config: Option<&SshConfigFile>,
) -> Option<SshCallbackInputs> {
    match auth {
        Some(GitAuth::SshKey { private_key_path }) => {
            ssh_callback_inputs(url, private_key_path, config)
        }
        _ => None,
    }
}

fn remote_callbacks<'a>(
    auth: Option<&GitAuth>,
    prepared: &PreparedUrl,
    ssh: Option<&SshCallbackInputs>,
    on_progress: impl FnMut(String) + 'a,
) -> git2::RemoteCallbacks<'a> {
    let auth = auth.cloned();
    let ssh_user = ssh.map(|inputs| inputs.username.clone());
    let ssh_key = ssh.map(|inputs| inputs.private_key_path.clone());
    let is_ssh = prepared.is_ssh;
    let progress = Rc::new(RefCell::new(on_progress));
    let progress_transfer = Rc::clone(&progress);
    let progress_sideband = Rc::clone(&progress);
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |url, username_from_url, allowed| {
        supply_cred(
            auth.as_ref(),
            ssh_user.as_deref(),
            ssh_key.as_deref(),
            url,
            username_from_url,
            allowed,
        )
    });
    if is_ssh {
        // Match the previous accept-new behavior for host keys. HTTPS certificates
        // stay on OpenSSL's default check.
        callbacks.certificate_check(|cert, _host| {
            if cert.as_hostkey().is_some() {
                Ok(git2::CertificateCheckStatus::CertificateOk)
            } else {
                Ok(git2::CertificateCheckStatus::CertificatePassthrough)
            }
        });
    }
    callbacks.transfer_progress(move |stats| {
        progress_transfer.borrow_mut()(format!(
            "Received {}/{} objects ({} bytes)",
            stats.received_objects(),
            stats.total_objects(),
            stats.received_bytes()
        ));
        true
    });
    callbacks.sideband_progress(move |data| {
        let text = String::from_utf8_lossy(data).trim().to_string();
        if !text.is_empty() {
            progress_sideband.borrow_mut()(text);
        }
        true
    });
    callbacks
}

fn supply_cred(
    auth: Option<&GitAuth>,
    ssh_user: Option<&str>,
    ssh_key: Option<&Path>,
    _url: &str,
    username_from_url: Option<&str>,
    _allowed: git2::CredentialType,
) -> Result<git2::Cred, git2::Error> {
    match auth {
        Some(GitAuth::HttpsBearer { username, token }) => {
            git2::Cred::userpass_plaintext(username, token)
        }
        Some(GitAuth::SshKey { private_key_path }) => {
            let user = username_from_url.or(ssh_user).unwrap_or("git");
            let key = ssh_key.unwrap_or(private_key_path.as_path());
            git2::Cred::ssh_key(user, None, key, None)
        }
        None => Err(git2::Error::from_str(
            "Authentication failed. Assign an account in GitLibre and retry.",
        )),
    }
}

pub fn push_current_branch(repo_path: &Path, auth: Option<&GitAuth>) -> CoreResult<String> {
    let repo = open_repo(repo_path)?;
    let head = repo.head().map_err(map_git2)?;
    if !head.is_branch() {
        return Err(CoreError::new(
            ErrorCode::ProcessFailed,
            "Cannot push: detached HEAD with no upstream.",
        ));
    }
    let branch_name = head
        .shorthand()
        .map_err(map_git2)?
        .to_string();
    let branch = repo
        .find_branch(&branch_name, git2::BranchType::Local)
        .map_err(map_git2)?;
    let remote_name = branch
        .upstream()
        .ok()
        .and_then(|_| {
            repo.config()
                .ok()
                .and_then(|cfg| {
                    cfg.get_string(&format!("branch.{branch_name}.remote")).ok()
                })
        })
        .unwrap_or_else(|| "origin".to_string());
    let named = repo.find_remote(&remote_name).map_err(map_git2)?;
    let original_url = named.url().unwrap_or("").to_string();
    let config = load_ssh_config();
    let prepared = prepare_remote_url(&original_url, config.as_ref());
    require_auth_for_url(&prepared, auth)?;
    let ssh = ssh_inputs(auth, &original_url, config.as_ref());
    let refspec = format!("refs/heads/{branch_name}:refs/heads/{branch_name}");
    let callbacks = remote_callbacks(auth, &prepared, ssh.as_ref(), |_| {});
    let mut options = git2::PushOptions::new();
    options.remote_callbacks(callbacks);
    let mut remote = if prepared.url != original_url {
        repo.remote_anonymous(&prepared.url).map_err(map_git2)?
    } else {
        repo.find_remote(&remote_name).map_err(map_git2)?
    };
    remote
        .push(&[&refspec], Some(&mut options))
        .map_err(map_git2)?;
    if branch.upstream().is_err() {
        let mut cfg = repo.config().map_err(map_git2)?;
        cfg.set_str(&format!("branch.{branch_name}.remote"), &remote_name)
            .map_err(map_git2)?;
        cfg.set_str(
            &format!("branch.{branch_name}.merge"),
            &format!("refs/heads/{branch_name}"),
        )
        .map_err(map_git2)?;
    }
    Ok("Push completed".into())
}

pub struct PullRun {
    pub summary: String,
    pub conflicted_paths: Vec<String>,
}

pub fn pull_current_branch(
    repo_path: &Path,
    auth: Option<&GitAuth>,
    on_progress: impl FnMut(String),
) -> CoreResult<PullRun> {
    let repo = open_repo(repo_path)?;
    let names = remote_names(&repo)?;
    if names.is_empty() {
        return Err(CoreError::new(
            ErrorCode::NoRemotes,
            "No remotes configured for this repository.",
        ));
    }
    let head = repo.head().map_err(map_git2)?;
    if !head.is_branch() {
        return Err(CoreError::process_failed(
            "Cannot pull: HEAD is detached.",
        ));
    }
    let branch_name = head.shorthand().unwrap_or("HEAD").to_string();
    let remote_name = repo
        .config()
        .ok()
        .and_then(|cfg| cfg.get_string(&format!("branch.{branch_name}.remote")).ok())
        .filter(|name| names.iter().any(|n| n == name))
        .unwrap_or_else(|| {
            if names.iter().any(|n| n == "origin") {
                "origin".to_string()
            } else {
                names[0].clone()
            }
        });
    let mut on_progress = on_progress;
    fetch_named(
        &repo,
        &remote_name,
        auth,
        load_ssh_config().as_ref(),
        &mut on_progress,
    )?;

    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(map_git2)?;
    let their_oid = fetch_head
        .target()
        .ok_or_else(|| CoreError::process_failed("FETCH_HEAD did not point at a commit."))?;
    let annotated = repo
        .find_annotated_commit(their_oid)
        .map_err(map_git2)?;
    let (analysis, _) = repo.merge_analysis(&[&annotated]).map_err(map_git2)?;
    if analysis.is_up_to_date() {
        return Ok(PullRun {
            summary: "Already up to date".into(),
            conflicted_paths: Vec::new(),
        });
    }
    if analysis.is_fast_forward() {
        fast_forward(&repo, &branch_name, their_oid)?;
        return Ok(PullRun {
            summary: "Fast-forward".into(),
            conflicted_paths: Vec::new(),
        });
    }

    repo.merge(&[&annotated], None, None).map_err(map_git2)?;
    let conflicts = conflicted_paths_in(&repo)?;
    if !conflicts.is_empty() {
        return Ok(PullRun {
            summary: format!("Pull finished with {} conflict(s)", conflicts.len()),
            conflicted_paths: conflicts,
        });
    }
    let mut index = repo.index().map_err(map_git2)?;
    let tree_id = index.write_tree_to(&repo).map_err(map_git2)?;
    let tree = repo.find_tree(tree_id).map_err(map_git2)?;
    let sig = signature_from_config(&repo)?;
    let head_commit = repo.head().map_err(map_git2)?.peel_to_commit().map_err(map_git2)?;
    let their = repo.find_commit(their_oid).map_err(map_git2)?;
    let message = format!("Merge branch '{branch_name}'");
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &message,
        &tree,
        &[&head_commit, &their],
    )
    .map_err(map_git2)?;
    repo.cleanup_state().map_err(map_git2)?;
    Ok(PullRun {
        summary: "Merge completed".into(),
        conflicted_paths: Vec::new(),
    })
}

fn fast_forward(repo: &git2::Repository, branch_name: &str, oid: git2::Oid) -> CoreResult<()> {
    let commit = repo.find_commit(oid).map_err(map_git2)?;
    repo.checkout_tree(commit.as_object(), Some(git2::build::CheckoutBuilder::new().force()))
        .map_err(map_git2)?;
    let refname = format!("refs/heads/{branch_name}");
    repo.reference(&refname, oid, true, "pull: fast-forward")
        .map_err(map_git2)?;
    repo.set_head(&refname).map_err(map_git2)?;
    Ok(())
}

pub fn conflicted_paths(repo_path: &Path) -> CoreResult<Vec<String>> {
    let repo = open_repo(repo_path)?;
    conflicted_paths_in(&repo)
}

fn conflicted_paths_in(repo: &git2::Repository) -> CoreResult<Vec<String>> {
    let index = repo.index().map_err(map_git2)?;
    if !index.has_conflicts() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    let conflicts = index.conflicts().map_err(map_git2)?;
    for conflict in conflicts {
        let conflict = conflict.map_err(map_git2)?;
        let entry = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref());
        if let Some(entry) = entry {
            let path = String::from_utf8_lossy(&entry.path).into_owned();
            if !path.is_empty() {
                paths.push(path);
            }
        }
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn signature_from_config(repo: &git2::Repository) -> CoreResult<git2::Signature<'static>> {
    let config = repo.config().map_err(map_git2)?;
    let name = config
        .get_string("user.name")
        .unwrap_or_else(|_| "GitLibre".into());
    let email = config
        .get_string("user.email")
        .unwrap_or_else(|_| "gitlibre@localhost".into());
    git2::Signature::now(&name, &email).map_err(map_git2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_alias_rewrites_host_and_records_identity_file() {
        let config = SshConfigFile::parse(
            "\
Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_work
",
        );
        let prepared = prepare_remote_url("git@github-work:org/repo.git", Some(&config));
        assert_eq!(prepared.url, "ssh://git@github.com/org/repo.git");
        assert!(prepared.is_ssh);
        let identity = prepared.identity_file.expect("identity file");
        assert!(
            identity.ends_with("id_ed25519_work"),
            "{identity:?}"
        );

        let inputs = ssh_callback_inputs(
            "git@github-work:org/repo.git",
            &identity,
            Some(&config),
        )
        .expect("ssh inputs");
        assert_eq!(inputs.url, "ssh://git@github.com/org/repo.git");
        assert_eq!(inputs.username, "git");
        assert_eq!(inputs.private_key_path, identity);
        assert_eq!(inputs.config_identity_file.as_ref(), Some(&identity));
    }

    #[test]
    fn local_path_is_not_ssh() {
        let prepared = prepare_remote_url("/tmp/remote.git", None);
        assert!(!prepared.is_ssh);
        assert!(ssh_callback_inputs("/tmp/remote.git", Path::new("/key"), None).is_none());
    }
}
