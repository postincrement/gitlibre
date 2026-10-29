import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountId,
  AddRepositoryResult,
  AppSnapshot,
  CreateAccountRequest,
  DetectedAccount,
  Repository,
  RepositoryId,
  RepoStatus,
  UpdateAccountRequest,
  BlameLine,
  BranchInfo,
  ChangeArea,
  CommitFileChange,
  CommitInfo,
  Workspace,
  WorkspaceFetchFinishedEvent,
  WorkspaceId,
  PullResult,
} from "../types/models";

export async function getSnapshot(): Promise<AppSnapshot> {
  return invoke<AppSnapshot>("get_snapshot");
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return invoke<Workspace>("create_workspace", { name });
}

export async function deleteWorkspace(id: WorkspaceId): Promise<AppSnapshot> {
  return invoke<AppSnapshot>("delete_workspace", { id });
}

export async function setActiveWorkspace(id: WorkspaceId): Promise<AppSnapshot> {
  return invoke<AppSnapshot>("set_active_workspace", { id });
}

export async function openWorkspaceWindow(intent: "open" | "create"): Promise<void> {
  return invoke<void>("open_workspace_window", { intent });
}

export async function addRepository(
  workspaceId: WorkspaceId,
  path: string,
): Promise<AddRepositoryResult> {
  return invoke<AddRepositoryResult>("add_repository", { workspaceId, path });
}

export async function detectRepositoryAccount(
  id: RepositoryId,
  remoteName?: string | null,
): Promise<DetectedAccount> {
  return invoke<DetectedAccount>("detect_repository_account", {
    id,
    remoteName: remoteName ?? null,
  });
}

export async function removeRepository(
  workspaceId: WorkspaceId,
  id: RepositoryId,
): Promise<AppSnapshot> {
  return invoke<AppSnapshot>("remove_repository", { workspaceId, id });
}

export async function createAccount(request: CreateAccountRequest): Promise<Account> {
  return invoke<Account>("create_account", { request });
}

export async function updateAccount(request: UpdateAccountRequest): Promise<Account> {
  return invoke<Account>("update_account", { request });
}

export async function deleteAccount(id: AccountId): Promise<AppSnapshot> {
  return invoke<AppSnapshot>("delete_account", { id });
}

export async function setRepositoryAccount(
  repositoryId: RepositoryId,
  accountId: AccountId | null,
): Promise<Repository> {
  return invoke<Repository>("set_repository_account", {
    repositoryId,
    accountId,
  });
}

export async function pickDirectory(): Promise<string | null> {
  return invoke<string | null>("pick_directory");
}

export async function pickFile(): Promise<string | null> {
  return invoke<string | null>("pick_ssh_key");
}

export async function pickSshKey(): Promise<string | null> {
  return invoke<string | null>("pick_ssh_key");
}

export async function listSshPrivateKeys(): Promise<string[]> {
  return invoke<string[]>("list_ssh_private_keys");
}

export async function getRepositoryStatus(id: RepositoryId): Promise<RepoStatus> {
  return invoke<RepoStatus>("get_repository_status", { id });
}

export async function listRepositoryBranches(
  id: RepositoryId,
  remoteName?: string | null,
): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>("list_repository_branches", {
    id,
    remoteName: remoteName ?? null,
  });
}

export async function listRemoteBranches(
  id: RepositoryId,
  remoteName: string,
): Promise<string[]> {
  return invoke<string[]>("list_remote_branches", { id, remoteName });
}

export async function listRepositoryCommits(
  id: RepositoryId,
  options?: { limit?: number; skip?: number },
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("list_repository_commits", {
    id,
    limit: options?.limit ?? null,
    skip: options?.skip ?? null,
  });
}

export async function listFileCommits(
  id: RepositoryId,
  path: string,
  options?: { startCommit?: string | null; limit?: number },
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("list_file_commits", {
    id,
    path,
    startCommit: options?.startCommit ?? null,
    limit: options?.limit ?? null,
  });
}

export async function blameFile(
  id: RepositoryId,
  path: string,
  commit?: string | null,
): Promise<BlameLine[]> {
  return invoke<BlameLine[]>("blame_file", {
    id,
    path,
    commit: commit ?? null,
  });
}

export async function listCommitFiles(
  id: RepositoryId,
  commit: string,
): Promise<CommitFileChange[]> {
  return invoke<CommitFileChange[]>("list_commit_files", { id, commit });
}

export async function getCommitFileDiff(
  id: RepositoryId,
  commit: string,
  path: string,
  oldPath?: string | null,
  area?: ChangeArea | null,
): Promise<string> {
  return invoke<string>("get_commit_file_diff", {
    id,
    commit,
    path,
    oldPath: oldPath ?? null,
    area: area ?? null,
  });
}

export interface FilePreview {
  mimeType: string;
  base64: string;
}

export interface FilePreviewPair {
  before: FilePreview | null;
  after: FilePreview | null;
}

export async function getCommitFilePreview(
  id: RepositoryId,
  commit: string,
  path: string,
  oldPath?: string | null,
  area?: ChangeArea | null,
  status?: string | null,
): Promise<FilePreviewPair> {
  return invoke<FilePreviewPair>("get_commit_file_preview", {
    id,
    commit,
    path,
    oldPath: oldPath ?? null,
    area: area ?? null,
    status: status ?? null,
  });
}

export async function stagePaths(
  id: RepositoryId,
  paths: string[],
): Promise<void> {
  return invoke<void>("stage_paths", { id, paths });
}

export async function unstagePaths(
  id: RepositoryId,
  paths: string[],
): Promise<void> {
  return invoke<void>("unstage_paths", { id, paths });
}

export async function discardPaths(
  id: RepositoryId,
  paths: string[],
  area: ChangeArea,
): Promise<void> {
  return invoke<void>("discard_paths", { id, paths, area });
}

export async function removePaths(
  id: RepositoryId,
  paths: string[],
  area: ChangeArea,
): Promise<void> {
  return invoke<void>("remove_paths", { id, paths, area });
}

export async function stopTrackingPaths(
  id: RepositoryId,
  paths: string[],
): Promise<void> {
  return invoke<void>("stop_tracking_paths", { id, paths });
}

export async function resolveRepositoryFilePath(
  id: RepositoryId,
  path: string,
): Promise<string> {
  return invoke<string>("resolve_repository_file_path", { id, path });
}

export async function openRepositoryFile(
  id: RepositoryId,
  path: string,
): Promise<void> {
  return invoke<void>("open_repository_file", { id, path });
}

export async function revealRepositoryFile(
  id: RepositoryId,
  path: string,
): Promise<void> {
  return invoke<void>("reveal_repository_file", { id, path });
}

export async function commitRepository(
  id: RepositoryId,
  message: string,
  amend?: boolean,
): Promise<string> {
  return invoke<string>("commit_repository", {
    id,
    message,
    amend: amend ?? false,
  });
}

export async function listWorkspaceStatuses(
  workspaceId: WorkspaceId,
): Promise<RepoStatus[]> {
  return invoke<RepoStatus[]>("list_workspace_statuses", { workspaceId });
}

export async function fetchRepository(id: RepositoryId): Promise<void> {
  return invoke<void>("fetch_repository", { id });
}

export async function pullRepository(id: RepositoryId): Promise<PullResult> {
  return invoke<PullResult>("pull_repository", { id });
}

export async function fetchWorkspace(
  workspaceId: WorkspaceId,
): Promise<WorkspaceFetchFinishedEvent> {
  return invoke<WorkspaceFetchFinishedEvent>("fetch_workspace", { workspaceId });
}
