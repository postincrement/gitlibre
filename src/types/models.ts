export type WorkspaceId = string;
export type RepositoryId = string;

export interface AppError {
  code: string;
  message: string;
}

export interface Workspace {
  id: WorkspaceId;
  name: string;
  repositoryIds: RepositoryId[];
}

export interface Repository {
  id: RepositoryId;
  path: string;
  displayName: string;
}

export interface AppSnapshot {
  workspaces: Workspace[];
  activeWorkspaceId: WorkspaceId | null;
  repositories: Repository[];
}

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface WorkingTreeStatus {
  modified: number;
  added: number;
  deleted: number;
  untracked: number;
  renamed: number;
  conflicted: number;
}

export interface RepoStatus {
  repositoryId: RepositoryId;
  displayName: string;
  path: string;
  available: boolean;
  currentBranch: string | null;
  detachedHead: boolean;
  remotes: RemoteInfo[];
  workingTree: WorkingTreeStatus | null;
  isFetching: boolean;
  lastError: string | null;
  lastFetchSummary: string | null;
}

export interface FetchProgressEvent {
  repositoryId: RepositoryId;
  message: string;
}

export interface FetchFinishedEvent {
  repositoryId: RepositoryId;
  success: boolean;
  summary: string;
  error: AppError | null;
}

export interface WorkspaceFetchFinishedEvent {
  total: number;
  succeeded: number;
  failed: number;
}
