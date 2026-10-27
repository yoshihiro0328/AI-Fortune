export type SaveState = "anonymous" | "unsaved" | "saved";
// Only call after the diagnosis ownership check has succeeded.
export function diagnosisSaveState(
  owner: string | null,
  signedIn: boolean,
): SaveState {
  return owner ? "saved" : signedIn ? "unsaved" : "anonymous";
}
