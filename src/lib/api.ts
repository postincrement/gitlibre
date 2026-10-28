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
  Workspace,
  WorkspaceFetchFinishedEvent,
  WorkspaceId,
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

export async function addRepository(path: string): Promise<AddRepositoryResult> {
  return invoke<AddRepositoryResult>("add_repository", { path });
}

export async function detectRepositoryAccount(
  id: RepositoryId,
): Promise<DetectedAccount> {
  return invoke<DetectedAccount>("detect_repository_account", { id });
}

export async function removeRepository(id: RepositoryId): Promise<AppSnapshot> {
  return invoke<AppSnapshot>("remove_repository", { id });
}

export async function createAccount(request: CreateAccountRequest): Promise<Account> {
  return invoke<Account>("create_account", { request });
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

export async function listWorkspaceStatuses(): Promise<RepoStatus[]> {
  return invoke<RepoStatus[]>("list_workspace_statuses");
}

export async function fetchRepository(id: RepositoryId): Promise<void> {
  return invoke<void>("fetch_repository", { id });
}

export async function fetchWorkspace(): Promise<WorkspaceFetchFinishedEvent> {
  return invoke<WorkspaceFetchFinishedEvent>("fetch_workspace");
}
