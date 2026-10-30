mod blame;
mod branches;
mod executor;
mod identity;
mod log;
mod show;
mod stage;
mod status;

pub use blame::{blame_file, BlameLine};
pub use branches::{
    checkout_revision, create_branch_at, create_tag_at, list_local_branches,
    list_local_branches_for_remote, list_remote_branches, BranchInfo,
};
pub use executor::{GitExecutor, GitOutput};
pub use identity::{read_commit_identity, CommitIdentity};
pub use log::{list_commits, list_file_commits, CommitInfo};
pub use show::{
    get_commit_file_bytes_pair, get_commit_file_diff, get_commit_file_diff_with_old_path,
    list_commit_files, ChangeArea, CommitFileChange, FileBytesPair, UNCOMMITTED_COMMIT_ID,
};
pub use stage::{
    commit_index, discard_paths, push_current_branch, read_head_commit_message, remove_paths,
    resolve_repo_path, stage_paths, stop_tracking_paths, unstage_paths, CommitOptions,
};
pub use status::{
    inspect_repository, parse_porcelain_v2, RemoteInfo, RepoInspection, WorkingTreeStatus,
};
