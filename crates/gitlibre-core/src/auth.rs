use crate::models::{Account, AuthKind};
use std::ffi::OsString;
use std::path::PathBuf;

/// Per-invocation Git authentication, applied only to that process.
///
/// Does not mutate global Git config or switch OS credentials.
#[derive(Debug, Clone)]
pub enum GitAuth {
    /// HTTPS: Authorization bearer token via GIT_CONFIG_* for this process only.
    HttpsBearer { token: String },
    /// SSH: dedicated key via GIT_SSH_COMMAND with IdentitiesOnly + BatchMode.
    SshKey { private_key_path: PathBuf },
}

impl GitAuth {
    /// Build auth from an account metadata + optional keychain token.
    pub fn from_account(account: &Account, token: Option<String>) -> Option<Self> {
        match account.auth_kind {
            AuthKind::HttpsToken => token.map(|token| Self::HttpsBearer { token }),
            AuthKind::SshKey => account
                .ssh_private_key_path
                .clone()
                .map(|private_key_path| Self::SshKey { private_key_path }),
        }
    }

    /// Environment variables applied to a single `git` process.
    pub fn env_vars(&self) -> Vec<(OsString, OsString)> {
        match self {
            Self::HttpsBearer { token } => vec![
                // Disable other helpers for this invocation so our header wins.
                (OsString::from("GIT_CONFIG_COUNT"), OsString::from("2")),
                (
                    OsString::from("GIT_CONFIG_KEY_0"),
                    OsString::from("credential.helper"),
                ),
                (OsString::from("GIT_CONFIG_VALUE_0"), OsString::from("")),
                (
                    OsString::from("GIT_CONFIG_KEY_1"),
                    OsString::from("http.extraHeader"),
                ),
                (
                    OsString::from("GIT_CONFIG_VALUE_1"),
                    OsString::from(format!("AUTHORIZATION: bearer {token}")),
                ),
            ],
            Self::SshKey { private_key_path } => {
                let cmd = format!(
                    "ssh -i {} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
                    shell_quote_path(private_key_path)
                );
                vec![(OsString::from("GIT_SSH_COMMAND"), OsString::from(cmd))]
            }
        }
    }
}

fn shell_quote_path(path: &std::path::Path) -> String {
    // GIT_SSH_COMMAND is parsed by a shell on some platforms; quote conservatively.
    let s = path.to_string_lossy();
    if s.chars().any(|c| c.is_whitespace() || c == '"') {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        s.into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::AccountId;
    use crate::models::{AuthKind, HostingProvider};

    #[test]
    fn https_auth_from_account() {
        let account = Account {
            id: AccountId::new(),
            provider: HostingProvider::GitHub,
            auth_kind: AuthKind::HttpsToken,
            username: "alice".into(),
            display_name: "Alice".into(),
            commit_name: None,
            commit_email: None,
            ssh_private_key_path: None,
        };
        let auth = GitAuth::from_account(&account, Some("tok".into())).unwrap();
        let env = auth.env_vars();
        assert!(env.iter().any(|(k, v)| {
            k == "GIT_CONFIG_VALUE_1" && v.to_string_lossy().contains("bearer tok")
        }));
    }

    #[test]
    fn https_without_token_is_none() {
        let account = Account {
            id: AccountId::new(),
            provider: HostingProvider::GitHub,
            auth_kind: AuthKind::HttpsToken,
            username: "alice".into(),
            display_name: "Alice".into(),
            commit_name: None,
            commit_email: None,
            ssh_private_key_path: None,
        };
        assert!(GitAuth::from_account(&account, None).is_none());
    }
}
