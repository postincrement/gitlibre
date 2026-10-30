/** Persisted SourceTree-style commit checkboxes (global). */

const PUSH_KEY = "gitlibre.commit.pushImmediately";
const SIGN_OFF_KEY = "gitlibre.commit.signOff";
const SIGN_COMMIT_KEY = "gitlibre.commit.signCommit";
const NO_VERIFY_KEY = "gitlibre.commit.noVerify";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

export function loadPushImmediately(): boolean {
  return readBool(PUSH_KEY, false);
}

export function persistPushImmediately(value: boolean): void {
  writeBool(PUSH_KEY, value);
}

export function loadSignOff(): boolean {
  return readBool(SIGN_OFF_KEY, false);
}

export function persistSignOff(value: boolean): void {
  writeBool(SIGN_OFF_KEY, value);
}

export function loadSignCommit(): boolean {
  return readBool(SIGN_COMMIT_KEY, false);
}

export function persistSignCommit(value: boolean): void {
  writeBool(SIGN_COMMIT_KEY, value);
}

export function loadNoVerify(): boolean {
  return readBool(NO_VERIFY_KEY, false);
}

export function persistNoVerify(value: boolean): void {
  writeBool(NO_VERIFY_KEY, value);
}
