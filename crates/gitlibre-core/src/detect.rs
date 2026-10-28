use crate::error::{CoreError, CoreResult};
use crate::git::{read_commit_identity, GitExecutor, RemoteInfo};
use crate::ids::AccountId;
use crate::models::{Account, AuthKind, HostingProvider};
use crate::ssh_config::{resolve_alias, ResolvedSshHost};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Account-related hints extracted from an on-disk Git repository.
///
/// Tokens are never discovered here — only provider, auth transport, username
/// hints, SSH config rewrites, and local commit identity from `user.name` /
/// `user.email`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedRepoAccount {
    pub provider: HostingProvider,
    pub auth_kind: AuthKind,
    /// Best guess at login (HTTPS URL user, else remote owner/path segment).
    pub suggested_username: Option<String>,
    /// Host token from the remote URL (may be an SSH config alias).
    pub remote_host: Option<String>,
    /// Hostname after `~/.ssh/config` `HostName` rewrite (same as remote_host if none).
    pub resolved_host: Option<String>,
    /// SSH config alias when it differs from the resolved hostname.
    pub ssh_host_alias: Option<String>,
    /// Preferred `IdentityFile` from SSH config, if any.
    pub suggested_ssh_key_path: Option<PathBuf>,
    /// Owner/org segment from the remote path (`alice` in `alice/repo`).
    pub remote_owner: Option<String>,
    pub primary_remote_name: Option<String>,
    pub primary_remote_url: Option<String>,
    pub commit_name: Option<String>,
    pub commit_email: Option<String>,
    /// True when name/email came from this repo's local `.git/config` (not only global).
    pub commit_identity_is_local: bool,
    /// Existing GitLibre account that matches these hints, if any.
    pub matched_account_id: Option<AccountId>,
}

/// Parsed pieces of a Git remote URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedRemoteUrl {
    pub provider: HostingProvider,
    pub auth_kind: AuthKind,
    pub host: String,
    pub owner: Option<String>,
    pub url_username: Option<String>,
}

/// Inspect remotes + local Git identity and optionally match known accounts.
///
/// When `remote_name` is set, that remote is used instead of the usual
/// `origin`-or-first primary selection.
pub async fn detect_repo_account(
    executor: &GitExecutor,
    repo_path: &Path,
    known_accounts: &[Account],
) -> CoreResult<DetectedRepoAccount> {
    detect_repo_account_from_remote(executor, repo_path, known_accounts, None).await
}

/// Like [`detect_repo_account`], but prefer a named remote when provided.
pub async fn detect_repo_account_from_remote(
    executor: &GitExecutor,
    repo_path: &Path,
    known_accounts: &[Account],
    remote_name: Option<&str>,
) -> CoreResult<DetectedRepoAccount> {
    if !repo_path.exists() {
        return Err(CoreError::path_not_found(repo_path.display()));
    }

    let remotes = list_remotes(executor, repo_path).await?;
    let chosen = match remote_name {
        Some(name) => {
            let remote = remotes.iter().find(|r| r.name == name).ok_or_else(|| {
                CoreError::new(
                    crate::error::ErrorCode::Internal,
                    format!("Remote was not found: {name}"),
                )
            })?;
            Some(remote.clone())
        }
        None => pick_primary_remote(&remotes).cloned(),
    };
    let parsed = chosen
        .as_ref()
        .map(|r| parse_remote_url(&r.fetch_url))
        .unwrap_or(None);

    let commit_identity = read_commit_identity(executor, repo_path).await?;

    let ssh_resolved = parsed.as_ref().and_then(|p| {
        if p.auth_kind == AuthKind::SshKey {
            resolve_alias(&p.host)
        } else {
            None
        }
    });

    let (provider, auth_kind, host, owner, url_username) = match parsed {
        Some(p) => {
            let effective_host = ssh_resolved
                .as_ref()
                .map(|r| r.host_name.clone())
                .unwrap_or_else(|| p.host.clone());
            (
                provider_from_host(&effective_host),
                p.auth_kind,
                Some(p.host),
                p.owner,
                p.url_username,
            )
        }
        None => (
            HostingProvider::Generic,
            AuthKind::HttpsToken,
            None,
            None,
            None,
        ),
    };

    let suggested_username = url_username
        .clone()
        .or_else(|| {
            ssh_resolved
                .as_ref()
                .and_then(|r| r.user.clone())
                .filter(|u| u != "git")
        })
        .or_else(|| owner.clone())
        .filter(|s| !s.is_empty() && s != "git");

    let (resolved_host, ssh_host_alias, suggested_ssh_key_path) =
        ssh_resolution_fields(host.as_deref(), ssh_resolved.as_ref());

    let mut detected = DetectedRepoAccount {
        provider,
        auth_kind,
        suggested_username,
        remote_host: host,
        resolved_host,
        ssh_host_alias,
        suggested_ssh_key_path,
        remote_owner: owner,
        primary_remote_name: chosen.as_ref().map(|r| r.name.clone()),
        primary_remote_url: chosen.as_ref().map(|r| r.fetch_url.clone()),
        commit_name: commit_identity.name,
        commit_email: commit_identity.email,
        commit_identity_is_local: commit_identity.is_local,
        matched_account_id: None,
    };

    detected.matched_account_id = match_account(&detected, known_accounts);
    Ok(detected)
}

fn ssh_resolution_fields(
    alias: Option<&str>,
    resolved: Option<&ResolvedSshHost>,
) -> (Option<String>, Option<String>, Option<PathBuf>) {
    let Some(resolved) = resolved else {
        return (alias.map(str::to_string), None, None);
    };
    let alias_name = alias.unwrap_or(resolved.alias.as_str());
    let ssh_host_alias = if resolved.host_name != alias_name {
        Some(alias_name.to_string())
    } else {
        None
    };
    let suggested_key = resolved.identity_files.first().cloned();
    (
        Some(resolved.host_name.clone()),
        ssh_host_alias,
        suggested_key,
    )
}

fn match_account(detected: &DetectedRepoAccount, accounts: &[Account]) -> Option<AccountId> {
    // Strongest SSH signal: same private key path.
    if let Some(key) = detected.suggested_ssh_key_path.as_ref() {
        if let Some(a) = accounts.iter().find(|a| {
            a.auth_kind == AuthKind::SshKey
                && a.ssh_private_key_path
                    .as_ref()
                    .is_some_and(|p| paths_equal_enough(p, key))
        }) {
            return Some(a.id);
        }
    }

    let username = detected.suggested_username.as_deref()?;

    if let Some(a) = accounts.iter().find(|a| {
        a.provider == detected.provider
            && a.auth_kind == detected.auth_kind
            && a.username.eq_ignore_ascii_case(username)
    }) {
        return Some(a.id);
    }

    accounts
        .iter()
        .find(|a| {
            a.provider == detected.provider && a.username.eq_ignore_ascii_case(username)
        })
        .map(|a| a.id)
}

fn paths_equal_enough(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => a.to_string_lossy() == b.to_string_lossy(),
    }
}

fn pick_primary_remote(remotes: &[RemoteInfo]) -> Option<&RemoteInfo> {
    remotes
        .iter()
        .find(|r| r.name == "origin")
        .or_else(|| remotes.first())
}

async fn list_remotes(
    executor: &GitExecutor,
    repo_path: &Path,
) -> CoreResult<Vec<RemoteInfo>> {
    let out = executor.run(repo_path, &["remote", "-v"]).await?;
    if !out.success() {
        return Ok(Vec::new());
    }
    Ok(parse_remotes_text(&out.stdout_lossy()))
}

fn parse_remotes_text(text: &str) -> Vec<RemoteInfo> {
    use std::collections::BTreeMap;
    let mut map: BTreeMap<String, (Option<String>, Option<String>)> = BTreeMap::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let name = parts[0].to_string();
        let url = parts[1].to_string();
        let kind = parts[2];
        let entry = map.entry(name).or_insert((None, None));
        if kind.contains("fetch") {
            entry.0 = Some(url);
        } else if kind.contains("push") {
            entry.1 = Some(url);
        }
    }
    map.into_iter()
        .map(|(name, (fetch, push))| {
            let fetch_url = fetch.clone().unwrap_or_default();
            let push_url = push.unwrap_or_else(|| fetch.unwrap_or_default());
            RemoteInfo {
                name,
                fetch_url,
                push_url,
            }
        })
        .collect()
}

/// Parse common Git remote URL forms into provider/auth/owner hints.
pub fn parse_remote_url(raw: &str) -> Option<ParsedRemoteUrl> {
    let url = raw.trim();
    if url.is_empty() {
        return None;
    }

    if let Some(parsed) = parse_scp_ssh(url) {
        return Some(parsed);
    }
    if let Some(parsed) = parse_scheme_url(url) {
        return Some(parsed);
    }
    None
}

fn parse_scp_ssh(url: &str) -> Option<ParsedRemoteUrl> {
    // git@github.com:owner/repo.git  or  github.com:owner/repo.git
    if url.contains("://") {
        return None;
    }
    let (user_host, path) = url.split_once(':')?;
    if path.contains('\\') || path.starts_with('/') && !user_host.contains('@') && !user_host.contains('.') {
        // Avoid Windows paths like C:\...
        if user_host.len() == 1 {
            return None;
        }
    }
    let (url_username, host) = match user_host.split_once('@') {
        Some((user, host)) => (Some(user.to_string()), host.to_string()),
        None => (None, user_host.to_string()),
    };
    if host.is_empty() || path.is_empty() {
        return None;
    }
    let owner = path_owner(path);
    Some(ParsedRemoteUrl {
        provider: provider_from_host(&host),
        auth_kind: AuthKind::SshKey,
        host,
        owner,
        url_username: url_username.filter(|u| u != "git"),
    })
}

fn parse_scheme_url(url: &str) -> Option<ParsedRemoteUrl> {
    let lower = url.to_ascii_lowercase();
    let auth_kind = if lower.starts_with("ssh://")
        || lower.starts_with("git://")
        || lower.starts_with("ssh+git://")
    {
        AuthKind::SshKey
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        AuthKind::HttpsToken
    } else {
        return None;
    };

    let without_scheme = url.split_once("://")?.1;
    let (authority, path) = match without_scheme.split_once('/') {
        Some((a, p)) => (a, p),
        None => (without_scheme, ""),
    };

    let (url_username, host_port) = if let Some((userinfo, host)) = authority.split_once('@') {
        let user = userinfo.split(':').next().unwrap_or(userinfo);
        (Some(user.to_string()), host)
    } else {
        (None, authority)
    };

    let host = host_port
        .split(':')
        .next()
        .unwrap_or(host_port)
        .to_string();
    if host.is_empty() {
        return None;
    }

    Some(ParsedRemoteUrl {
        provider: provider_from_host(&host),
        auth_kind,
        host,
        owner: path_owner(path),
        url_username: url_username.filter(|u| !u.is_empty() && u != "git"),
    })
}

fn path_owner(path: &str) -> Option<String> {
    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    let first = trimmed.split('/').next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.trim_end_matches(".git").to_string())
    }
}

fn provider_from_host(host: &str) -> HostingProvider {
    let host = host.to_ascii_lowercase();
    // Official hosts plus common SSH config aliases / enterprise hosts.
    if host == "github.com" || host.ends_with(".github.com") || host.contains("github") {
        return HostingProvider::GitHub;
    }
    if host == "gitlab.com" || host.contains("gitlab") {
        return HostingProvider::GitLab;
    }
    if host == "bitbucket.org" || host.contains("bitbucket") {
        return HostingProvider::Bitbucket;
    }
    HostingProvider::Generic
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::AccountId;
    use std::fs;
    use std::process::Command;
    use tempfile::tempdir;

    #[test]
    fn parse_https_github() {
        let p = parse_remote_url("https://github.com/alice/widget.git").unwrap();
        assert_eq!(p.provider, HostingProvider::GitHub);
        assert_eq!(p.auth_kind, AuthKind::HttpsToken);
        assert_eq!(p.owner.as_deref(), Some("alice"));
        assert!(p.url_username.is_none());
    }

    #[test]
    fn parse_https_with_user() {
        let p = parse_remote_url("https://bob@github.com/org/repo.git").unwrap();
        assert_eq!(p.url_username.as_deref(), Some("bob"));
        assert_eq!(p.owner.as_deref(), Some("org"));
    }

    #[test]
    fn parse_scp_ssh() {
        let p = parse_remote_url("git@github.com:acme/app.git").unwrap();
        assert_eq!(p.provider, HostingProvider::GitHub);
        assert_eq!(p.auth_kind, AuthKind::SshKey);
        assert_eq!(p.owner.as_deref(), Some("acme"));
        assert!(p.url_username.is_none()); // filtered "git"
    }

    #[test]
    fn parse_ssh_scheme() {
        let p = parse_remote_url("ssh://git@gitlab.com/group/proj.git").unwrap();
        assert_eq!(p.provider, HostingProvider::GitLab);
        assert_eq!(p.auth_kind, AuthKind::SshKey);
        assert_eq!(p.owner.as_deref(), Some("group"));
    }

    #[test]
    fn match_prefers_exact_account() {
        let detected = DetectedRepoAccount {
            provider: HostingProvider::GitHub,
            auth_kind: AuthKind::HttpsToken,
            suggested_username: Some("alice".into()),
            remote_host: Some("github.com".into()),
            resolved_host: Some("github.com".into()),
            ssh_host_alias: None,
            suggested_ssh_key_path: None,
            remote_owner: Some("alice".into()),
            primary_remote_name: Some("origin".into()),
            primary_remote_url: Some("https://github.com/alice/r.git".into()),
            commit_name: None,
            commit_email: None,
            commit_identity_is_local: false,
            matched_account_id: None,
        };
        let id = AccountId::new();
        let accounts = vec![Account {
            id,
            provider: HostingProvider::GitHub,
            auth_kind: AuthKind::HttpsToken,
            username: "alice".into(),
            display_name: "Alice".into(),
            commit_name: None,
            commit_email: None,
            ssh_private_key_path: None,
        }];
        assert_eq!(match_account(&detected, &accounts), Some(id));
    }

    #[tokio::test]
    async fn detect_from_temp_repo() {
        let dir = tempdir().unwrap();
        let repo = dir.path().join("repo");
        fs::create_dir(&repo).unwrap();
        assert!(Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/scrypos/demo.git"
            ])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "--local", "user.name", "Scry Dev"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());
        assert!(Command::new("git")
            .args(["config", "--local", "user.email", "dev@scry.example"])
            .current_dir(&repo)
            .status()
            .unwrap()
            .success());

        let executor = GitExecutor::from_path().unwrap();
        let detected = detect_repo_account(&executor, &repo, &[]).await.unwrap();
        assert_eq!(detected.provider, HostingProvider::GitHub);
        assert_eq!(detected.auth_kind, AuthKind::HttpsToken);
        assert_eq!(detected.suggested_username.as_deref(), Some("scrypos"));
        assert_eq!(detected.commit_name.as_deref(), Some("Scry Dev"));
        assert_eq!(detected.commit_email.as_deref(), Some("dev@scry.example"));
        assert!(detected.commit_identity_is_local);
        assert!(detected.matched_account_id.is_none());
    }
}
