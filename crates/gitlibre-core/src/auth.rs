use crate::models::{Account, AuthKind};
use std::path::PathBuf;

/// Per-invocation authentication, applied only to that fetch or push.
///
/// Credentials are handed to libgit2 inside this process. Nothing is written to
/// Git config, and no external `git` or `ssh` program is started.
///
/// [`GitAuth::SshKey`] is the source this port loads. Later in-process sources
/// (PuTTY `.ppk`, a PuTTY session, Pageant, the OpenSSH agent) can be added as
/// variants here and resolved in `git::transport` without shelling out.
#[derive(Debug, Clone)]
pub enum GitAuth {
    /// HTTPS username plus token. libgit2 sends them as plaintext user/password.
    HttpsBearer { username: String, token: String },
    /// OpenSSH private key file, loaded by libssh2.
    SshKey { private_key_path: PathBuf },
}

impl GitAuth {
    /// Build auth from account metadata plus an optional keychain token.
    pub fn from_account(account: &Account, token: Option<String>) -> Option<Self> {
        match account.auth_kind {
            AuthKind::HttpsToken => token.map(|token| Self::HttpsBearer {
                username: account.username.clone(),
                token,
            }),
            AuthKind::SshKey => account
                .ssh_private_key_path
                .clone()
                .map(|private_key_path| Self::SshKey { private_key_path }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::AccountId;
    use crate::models::{AuthKind, HostingProvider};

    fn https_account() -> Account {
        Account {
            id: AccountId::new(),
            provider: HostingProvider::GitHub,
            auth_kind: AuthKind::HttpsToken,
            username: "alice".into(),
            display_name: "Alice".into(),
            commit_name: None,
            commit_email: None,
            ssh_private_key_path: None,
        }
    }

    #[test]
    fn https_auth_from_account() {
        let auth = GitAuth::from_account(&https_account(), Some("tok".into())).unwrap();
        match auth {
            GitAuth::HttpsBearer { username, token } => {
                assert_eq!(username, "alice");
                assert_eq!(token, "tok");
            }
            GitAuth::SshKey { .. } => panic!("expected https"),
        }
    }

    #[test]
    fn https_without_token_is_none() {
        assert!(GitAuth::from_account(&https_account(), None).is_none());
    }
}
