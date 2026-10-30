/** Turn a Tauri invoke rejection into text. Those payloads are `{ code, message }`, not `Error`. */
export function formatError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object" && "message" in e) {
    const message = (e as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
    if (message != null && typeof message !== "object") return String(message);
  }
  return "Unexpected error";
}
