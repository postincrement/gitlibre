import type { AccountId, RemoteAccount, RepoStatus } from "../types/models";

/** Account that authenticates one remote. An explicit binding wins, including none. */
export function accountIdForRemote(
  status: { accountId: AccountId | null; remoteAccounts?: RemoteAccount[] },
  remote: string,
): AccountId | null {
  const binding = status.remoteAccounts?.find((entry) => entry.remote === remote);
  if (binding) return binding.accountId;
  return status.accountId;
}

/** True when fetch or push has an account for at least one remote. */
export function repositoryCanSync(status: RepoStatus): boolean {
  if (status.remotes.length === 0) return status.accountId != null;
  return status.remotes.some(
    (remote) => accountIdForRemote(status, remote.name) != null,
  );
}
