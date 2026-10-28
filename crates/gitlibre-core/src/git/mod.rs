mod executor;
mod identity;
mod status;

pub use executor::{GitExecutor, GitOutput};
pub use identity::{read_commit_identity, CommitIdentity};
pub use status::{
    inspect_repository, parse_porcelain_v2, RemoteInfo, RepoInspection, WorkingTreeStatus,
};
