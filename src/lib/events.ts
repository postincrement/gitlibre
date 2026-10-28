import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  FetchFinishedEvent,
  FetchProgressEvent,
  WorkspaceFetchFinishedEvent,
} from "../types/models";

export async function onRepoFetchProgress(
  handler: (event: FetchProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<FetchProgressEvent>("repo-fetch-progress", (e) => handler(e.payload));
}

export async function onRepoFetchFinished(
  handler: (event: FetchFinishedEvent) => void,
): Promise<UnlistenFn> {
  return listen<FetchFinishedEvent>("repo-fetch-finished", (e) => handler(e.payload));
}

export async function onWorkspaceFetchFinished(
  handler: (event: WorkspaceFetchFinishedEvent) => void,
): Promise<UnlistenFn> {
  return listen<WorkspaceFetchFinishedEvent>("workspace-fetch-finished", (e) =>
    handler(e.payload),
  );
}
