use gitlibre_core::{ConfigStore, FetchCoordinator, GitExecutor, RepositoryId};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Default)]
pub struct LiveRepoState {
    pub is_fetching: bool,
    pub last_error: Option<String>,
    pub last_fetch_summary: Option<String>,
}

pub struct AppState {
    pub store: Mutex<ConfigStore>,
    pub coordinator: FetchCoordinator,
    pub live: Mutex<HashMap<RepositoryId, LiveRepoState>>,
}

impl AppState {
    pub fn new(store: ConfigStore, executor: GitExecutor) -> Self {
        Self {
            store: Mutex::new(store),
            coordinator: FetchCoordinator::new(executor),
            live: Mutex::new(HashMap::new()),
        }
    }
}
