mod blame;
mod branches;
mod identity;
mod log;
pub(crate) mod session;
mod show;
mod stage;
mod stash;
pub(crate) mod status;
pub(crate) mod transport;

pub use blame::{BlameLine, blame_file};
pub use branches::{
    BranchInfo, checkout_revision, create_branch_at, create_tag_at, list_local_branches,
    list_local_branches_for_remote, list_remote_branches,
};
pub use identity::{CommitIdentity, read_commit_identity};
pub use log::{CommitInfo, list_commits, list_file_commits};
pub use show::{
    ChangeArea, CommitFileChange, FileBytesPair, UNCOMMITTED_COMMIT_ID, get_commit_file_bytes_pair,
    get_commit_file_diff, get_commit_file_diff_with_old_path, list_commit_files,
};
pub use stage::{
    CommitOptions, commit_index, discard_paths, push_current_branch, read_head_commit_message,
    remove_paths, resolve_repo_path, stage_paths, stop_tracking_paths, unstage_paths,
};
pub use stash::{StashEntry, apply_stash, drop_stash, list_stashes, pop_stash, save_stash};
pub use status::{
    RemoteInfo, RepoInspection, WorkingTreeStatus, inspect_repository, parse_porcelain_v2,
};
