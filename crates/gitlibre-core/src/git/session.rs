//! Open repositories on a blocking thread. libgit2 does not run on the async runtime.

use crate::error::{CoreError, CoreResult};
use std::path::Path;

pub fn open_repo(path: &Path) -> CoreResult<git2::Repository> {
    if !path.exists() {
        return Err(CoreError::path_not_found(path.display()));
    }
    match git2::Repository::open(path) {
        Ok(repo) => Ok(repo),
        Err(err) if err.code() == git2::ErrorCode::NotFound => {
            Err(CoreError::not_a_git_repository(path.display()))
        }
        Err(err) => Err(CoreError::from_git2(err)),
    }
}

pub async fn blocking<T, F>(work: F) -> CoreResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CoreResult<T> + Send + 'static,
{
    match tokio::task::spawn_blocking(work).await {
        Ok(result) => result,
        Err(err) => Err(CoreError::process_failed(format!(
            "Git task failed: {err}"
        ))),
    }
}

pub fn map_git2(err: git2::Error) -> CoreError {
    CoreError::from_git2(err)
}

pub fn string_list(array: &git2::string_array::StringArray) -> Vec<String> {
    array
        .iter()
        .flatten()
        .flatten()
        .map(str::to_string)
        .collect()
}
