export type WorkspaceId = string;
export type RepositoryId = string;
export type AccountId = string;

export type HostingProvider = "github" | "gitlab" | "bitbucket" | "generic";
export type AuthKind = "https_token" | "ssh_key";

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
  accountId: AccountId | null;
}

export interface Account {
  id: AccountId;
  provider: HostingProvider;
  authKind: AuthKind;
  username: string;
  displayName: string;
  commitName: string | null;
  commitEmail: string | null;
  sshPrivateKeyPath: string | null;
  hasToken: boolean;
}

export interface CreateAccountRequest {
  provider: HostingProvider;
  authKind: AuthKind;
  username: string;
  displayName: string;
  commitName?: string | null;
  commitEmail?: string | null;
  sshPrivateKeyPath?: string | null;
  token?: string | null;
}

export interface UpdateAccountRequest {
  id: AccountId;
  provider: HostingProvider;
  authKind: AuthKind;
  username: string;
  displayName: string;
  commitName?: string | null;
  commitEmail?: string | null;
  sshPrivateKeyPath?: string | null;
  /** Non-empty replaces the keychain token; omit/empty keeps the existing token. */
  token?: string | null;
}

export interface DetectedAccount {
  provider: HostingProvider;
  authKind: AuthKind;
  suggestedUsername: string | null;
  remoteHost: string | null;
  resolvedHost: string | null;
  sshHostAlias: string | null;
  suggestedSshKeyPath: string | null;
  remoteOwner: string | null;
  primaryRemoteName: string | null;
  primaryRemoteUrl: string | null;
  commitName: string | null;
  commitEmail: string | null;
  commitIdentityIsLocal: boolean;
  matchedAccountId: AccountId | null;
}

export interface AddRepositoryResult {
  repository: Repository;
  detection: DetectedAccount | null;
  autoAssignedAccountId: AccountId | null;
}

export interface AppSnapshot {
  workspaces: Workspace[];
  activeWorkspaceId: WorkspaceId | null;
  repositories: Repository[];
  accounts: Account[];
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
  accountId: AccountId | null;
  commitName: string | null;
  commitEmail: string | null;
  commitIdentityIsLocal: boolean;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  /** Commits on the selected remote branch not present locally; null if no remote ref. */
  behind: number | null;
  /** Commits on the local branch not present on the remote; null if no remote ref. */
  ahead: number | null;
}

export interface CommitInfo {
  id: string;
  shortId: string;
  parents: string[];
  subject: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  refs: string[];
}

export type ChangeArea = "staged" | "unstaged" | "untracked";

export interface CommitFileChange {
  status: string;
  path: string;
  oldPath: string | null;
  /** Present for working-tree listings. */
  area?: ChangeArea | null;
}

export interface BlameLine {
  commitId: string;
  shortId: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  lineNumber: number;
  content: string;
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
