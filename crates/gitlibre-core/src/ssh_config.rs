//! Minimal OpenSSH `~/.ssh/config` reader.
//!
//! Resolves host aliases to `HostName`, `User`, and `IdentityFile` using the
//! OpenSSH “first obtained value wins” rule across matching `Host` blocks.
//! Unknown directives are ignored so ordinary user configs do not fail parsing.

use std::fs;
use std::path::{Path, PathBuf};

/// Resolved SSH connection parameters for a remote host alias.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedSshHost {
    /// Host token from the Git remote (e.g. `github-work`).
    pub alias: String,
    /// Effective hostname after `HostName` rewrite (falls back to alias).
    pub host_name: String,
    /// `User` from config, if set (often `git` for hosting remotes).
    pub user: Option<String>,
    /// `IdentityFile` paths in preference order, with `~` expanded.
    pub identity_files: Vec<PathBuf>,
}

#[derive(Debug, Clone, Default)]
struct HostBlock {
    patterns: Vec<String>,
    host_name: Option<String>,
    user: Option<String>,
    identity_files: Vec<PathBuf>,
}

/// Parsed SSH config file (subset of OpenSSH directives).
#[derive(Debug, Clone, Default)]
pub struct SshConfigFile {
    blocks: Vec<HostBlock>,
}

impl SshConfigFile {
    pub fn parse(text: &str) -> Self {
        let mut blocks: Vec<HostBlock> = Vec::new();
        let mut current: Option<HostBlock> = None;

        for raw_line in text.lines() {
            let line = strip_comment(raw_line).trim();
            if line.is_empty() {
                continue;
            }

            let (key, value) = split_key_value(line);
            let key_lower = key.to_ascii_lowercase();

            if key_lower == "host" {
                if let Some(block) = current.take() {
                    blocks.push(block);
                }
                let patterns = value
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                current = Some(HostBlock {
                    patterns,
                    ..HostBlock::default()
                });
                continue;
            }

            let Some(block) = current.as_mut() else {
                // Directives before any Host are treated as applying to Host *
                continue;
            };

            match key_lower.as_str() {
                "hostname" => {
                    if block.host_name.is_none() {
                        block.host_name = Some(value.to_string());
                    }
                }
                "user" => {
                    if block.user.is_none() {
                        block.user = Some(value.to_string());
                    }
                }
                "identityfile" => {
                    block.identity_files.push(expand_tilde(value));
                }
                _ => {}
            }
        }

        if let Some(block) = current {
            blocks.push(block);
        }

        Self { blocks }
    }

    pub fn load_path(path: &Path) -> Option<Self> {
        let text = fs::read_to_string(path).ok()?;
        Some(Self::parse(&text))
    }

    /// Resolve parameters for `alias` (the host from a Git SSH URL).
    pub fn resolve(&self, alias: &str) -> ResolvedSshHost {
        let mut host_name: Option<String> = None;
        let mut user: Option<String> = None;
        let mut identity_files: Vec<PathBuf> = Vec::new();

        for block in &self.blocks {
            if !host_matches(alias, &block.patterns) {
                continue;
            }
            if host_name.is_none() {
                if let Some(h) = &block.host_name {
                    host_name = Some(h.clone());
                }
            }
            if user.is_none() {
                if let Some(u) = &block.user {
                    user = Some(u.clone());
                }
            }
            // IdentityFile accumulates across matching blocks (OpenSSH behaviour).
            for path in &block.identity_files {
                if !identity_files.iter().any(|p| p == path) {
                    identity_files.push(path.clone());
                }
            }
        }

        ResolvedSshHost {
            alias: alias.to_string(),
            host_name: host_name.unwrap_or_else(|| alias.to_string()),
            user,
            identity_files,
        }
    }
}

/// Load `~/.ssh/config` if present and resolve `alias`.
pub fn resolve_from_default_config(alias: &str) -> Option<ResolvedSshHost> {
    let path = default_ssh_config_path()?;
    let config = SshConfigFile::load_path(&path)?;
    let resolved = config.resolve(alias);
    // Only treat as an alias rewrite when something actually changed / was set.
    if resolved.host_name != alias
        || resolved.user.is_some()
        || !resolved.identity_files.is_empty()
    {
        Some(resolved)
    } else {
        // Still return resolution for identity defaults on Host * — if empty, None.
        None
    }
}

/// Always resolve against default config when the file exists (including Host *).
pub fn resolve_alias(alias: &str) -> Option<ResolvedSshHost> {
    let path = default_ssh_config_path()?;
    let config = SshConfigFile::load_path(&path)?;
    Some(config.resolve(alias))
}

pub fn default_ssh_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".ssh").join("config"))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            #[cfg(windows)]
            {
                std::env::var_os("USERPROFILE")
                    .filter(|v| !v.is_empty())
                    .map(PathBuf::from)
            }
            #[cfg(not(windows))]
            {
                None
            }
        })
}

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    if path == "~" {
        if let Some(home) = home_dir() {
            return home;
        }
    }
    PathBuf::from(path)
}

fn strip_comment(line: &str) -> &str {
    // OpenSSH comments start with #; keep # inside quotes out of scope for M2.
    match line.find('#') {
        Some(idx) => &line[..idx],
        None => line,
    }
}

fn split_key_value(line: &str) -> (&str, &str) {
    if let Some((k, v)) = line.split_once('=') {
        return (k.trim(), v.trim());
    }
    let mut parts = line.splitn(2, char::is_whitespace);
    let key = parts.next().unwrap_or("").trim();
    let value = parts.next().unwrap_or("").trim();
    (key, value)
}

/// OpenSSH-like host pattern match (`*`, `?`, and leading `!` negation).
fn host_matches(host: &str, patterns: &[String]) -> bool {
    let mut matched = false;
    let mut negated = false;
    for pattern in patterns {
        if let Some(neg) = pattern.strip_prefix('!') {
            if pattern_match(host, neg) {
                negated = true;
            }
        } else if pattern_match(host, pattern) {
            matched = true;
        }
    }
    matched && !negated
}

fn pattern_match(value: &str, pattern: &str) -> bool {
    match_glob(value.as_bytes(), pattern.as_bytes())
}

fn match_glob(value: &[u8], pattern: &[u8]) -> bool {
    let mut vi = 0;
    let mut pi = 0;
    let mut star_p: Option<usize> = None;
    let mut star_v: usize = 0;

    while vi < value.len() {
        if pi < pattern.len() && (pattern[pi] == b'?' || pattern[pi] == value[vi]) {
            vi += 1;
            pi += 1;
        } else if pi < pattern.len() && pattern[pi] == b'*' {
            star_p = Some(pi);
            star_v = vi;
            pi += 1;
        } else if let Some(sp) = star_p {
            pi = sp + 1;
            star_v += 1;
            vi = star_v;
        } else {
            return false;
        }
    }

    while pi < pattern.len() && pattern[pi] == b'*' {
        pi += 1;
    }
    pi == pattern.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_alias_hostname_user_and_key() {
        let config = SshConfigFile::parse(
            r#"
Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_work

Host *
  IdentityFile ~/.ssh/id_ed25519
"#,
        );

        let resolved = config.resolve("github-work");
        assert_eq!(resolved.host_name, "github.com");
        assert_eq!(resolved.user.as_deref(), Some("git"));
        assert_eq!(resolved.identity_files.len(), 2);
        assert!(resolved.identity_files[0]
            .to_string_lossy()
            .ends_with("id_ed25519_work"));
        assert!(resolved.identity_files[1]
            .to_string_lossy()
            .ends_with("id_ed25519"));
    }

    #[test]
    fn first_wins_for_hostname() {
        let config = SshConfigFile::parse(
            r#"
Host github-work
  HostName github.com

Host github-work
  HostName evil.example
  User ignored-because-user-not-set-above
"#,
        );
        let resolved = config.resolve("github-work");
        assert_eq!(resolved.host_name, "github.com");
        assert_eq!(resolved.user.as_deref(), Some("ignored-because-user-not-set-above"));
    }

    #[test]
    fn negation_pattern() {
        let config = SshConfigFile::parse(
            r#"
Host * !github-work
  HostName elsewhere
  IdentityFile ~/.ssh/other

Host github-work
  HostName github.com
  IdentityFile ~/.ssh/work
"#,
        );
        let work = config.resolve("github-work");
        assert_eq!(work.host_name, "github.com");
        assert_eq!(work.identity_files.len(), 1);

        let other = config.resolve("gitlab.com");
        assert_eq!(other.host_name, "elsewhere");
    }

    #[test]
    fn glob_question_mark() {
        assert!(pattern_match("github1", "github?"));
        assert!(!pattern_match("github12", "github?"));
    }
}
