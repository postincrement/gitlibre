use crate::auth::GitAuth;
use crate::error::{CoreError, CoreResult};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Result of a completed Git process invocation.
#[derive(Debug, Clone)]
pub struct GitOutput {
    pub status: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl GitOutput {
    pub fn success(&self) -> bool {
        self.status == 0
    }

    pub fn stdout_lossy(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    pub fn stderr_lossy(&self) -> String {
        String::from_utf8_lossy(&self.stderr).into_owned()
    }
}

/// Executes the system `git` binary with explicit argv arrays (never a shell).
///
/// Working directory is set per call. Environment forces non-interactive auth
/// failure (`GIT_TERMINAL_PROMPT=0`) so the UI cannot hang on credential prompts.
/// Optional [`GitAuth`] applies per-invocation credentials without global switching.
#[derive(Debug, Clone)]
pub struct GitExecutor {
    git_path: PathBuf,
}

impl GitExecutor {
    pub fn from_path() -> CoreResult<Self> {
        let git_path = which_git()?;
        Ok(Self { git_path })
    }

    /// Used when Git is missing so the desktop shell can still launch.
    pub fn from_explicit_path(git_path: PathBuf) -> Self {
        Self { git_path }
    }

    pub fn git_path(&self) -> &Path {
        &self.git_path
    }

    /// Run `git <args>` with `cwd` as the working directory.
    pub async fn run(&self, cwd: &Path, args: &[&str]) -> CoreResult<GitOutput> {
        self.run_with_auth(cwd, args, None).await
    }

    pub async fn run_with_auth(
        &self,
        cwd: &Path,
        args: &[&str],
        auth: Option<&GitAuth>,
    ) -> CoreResult<GitOutput> {
        self.run_os(cwd, args.iter().map(OsString::from).collect(), auth)
            .await
    }

    pub async fn run_os(
        &self,
        cwd: &Path,
        args: Vec<OsString>,
        auth: Option<&GitAuth>,
    ) -> CoreResult<GitOutput> {
        let mut cmd = Command::new(&self.git_path);
        apply_base_env(&mut cmd);
        if let Some(auth) = auth {
            for (key, value) in auth.env_vars() {
                cmd.env(key, value);
            }
        }
        cmd.args(&args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let output = cmd
            .output()
            .await
            .map_err(|e| CoreError::process_failed(format!("Failed to start git: {e}")))?;

        Ok(GitOutput {
            status: output.status.code().unwrap_or(-1),
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    /// Run git and stream stderr lines to `on_progress` (used for `git fetch --progress`).
    pub async fn run_with_stderr_progress<F>(
        &self,
        cwd: &Path,
        args: &[&str],
        on_progress: F,
    ) -> CoreResult<GitOutput>
    where
        F: FnMut(String) + Send,
    {
        self.run_with_stderr_progress_auth(cwd, args, None, on_progress)
            .await
    }

    pub async fn run_with_stderr_progress_auth<F>(
        &self,
        cwd: &Path,
        args: &[&str],
        auth: Option<&GitAuth>,
        mut on_progress: F,
    ) -> CoreResult<GitOutput>
    where
        F: FnMut(String) + Send,
    {
        let mut cmd = Command::new(&self.git_path);
        apply_base_env(&mut cmd);
        if let Some(auth) = auth {
            for (key, value) in auth.env_vars() {
                cmd.env(key, value);
            }
        }
        cmd.args(args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| CoreError::process_failed(format!("Failed to start git: {e}")))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let stdout_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            if let Some(stdout) = stdout {
                let mut reader = BufReader::new(stdout);
                let mut line = Vec::new();
                loop {
                    line.clear();
                    let n = reader.read_until(b'\n', &mut line).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&line);
                }
            }
            buf
        });

        let mut stderr_buf = Vec::new();
        if let Some(stderr) = stderr {
            let mut reader = BufReader::new(stderr);
            let mut line = Vec::new();
            loop {
                line.clear();
                let n = reader
                    .read_until(b'\n', &mut line)
                    .await
                    .map_err(|e| CoreError::process_failed(e.to_string()))?;
                if n == 0 {
                    break;
                }
                stderr_buf.extend_from_slice(&line);
                let text = String::from_utf8_lossy(&line).trim_end().to_string();
                if !text.is_empty() {
                    on_progress(text);
                }
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|e| CoreError::process_failed(e.to_string()))?;
        let stdout = stdout_task
            .await
            .map_err(|e| CoreError::process_failed(e.to_string()))?;

        Ok(GitOutput {
            status: status.code().unwrap_or(-1),
            stdout,
            stderr: stderr_buf,
        })
    }

    /// Synchronous helper for tests that prefer blocking APIs.
    pub fn run_blocking(&self, cwd: &Path, args: &[&str]) -> CoreResult<GitOutput> {
        use std::process::Command as StdCommand;
        let output = StdCommand::new(&self.git_path)
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", "")
            .output()
            .map_err(|e| CoreError::process_failed(format!("Failed to start git: {e}")))?;
        Ok(GitOutput {
            status: output.status.code().unwrap_or(-1),
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
}

fn apply_base_env(cmd: &mut Command) {
    cmd.env("GIT_TERMINAL_PROMPT", "0").env("GIT_ASKPASS", "");
}

fn which_git() -> CoreResult<PathBuf> {
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join("git");
            if candidate.is_file() {
                return Ok(candidate);
            }
            #[cfg(windows)]
            {
                let candidate = dir.join("git.exe");
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }
    for candidate in ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(CoreError::git_not_found())
}

/// Redact likely secret-bearing argv tokens before logging.
#[allow(dead_code)]
pub fn redact_args(args: &[impl AsRef<OsStr>]) -> Vec<String> {
    args.iter()
        .map(|a| {
            let s = a.as_ref().to_string_lossy();
            if s.contains("://") && (s.contains('@') || s.contains("token")) {
                "<redacted-url>".to_string()
            } else if s.to_ascii_lowercase().contains("authorization")
                || s.to_ascii_lowercase().contains("bearer")
            {
                "<redacted-header>".to_string()
            } else {
                s.into_owned()
            }
        })
        .collect()
}
