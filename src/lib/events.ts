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

export async function onMenuOpenWorkspace(handler: () => void): Promise<UnlistenFn> {
  return listen("menu-open-workspace", () => handler());
}

export async function onMenuNewWorkspace(handler: () => void): Promise<UnlistenFn> {
  return listen("menu-new-workspace", () => handler());
}

export async function onMenuAccounts(handler: () => void): Promise<UnlistenFn> {
  return listen("menu-accounts", () => handler());
}

export async function onMenuSettings(handler: () => void): Promise<UnlistenFn> {
  return listen("menu-settings", () => handler());
}

export async function onMenuZoomIn(handler: () => void): Promise<UnlistenFn> {
  return listen("menu-zoom-in", () => handler());
}

export async function onMenuZoomOut(handler: () => void): Promise<UnlistenFn> {
  return listen("menu-zoom-out", () => handler());
}

export async function onMenuZoomReset(handler: () => void): Promise<UnlistenFn> {
  return listen("menu-zoom-reset", () => handler());
}
