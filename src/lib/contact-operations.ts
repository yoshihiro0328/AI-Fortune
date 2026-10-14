export type ContactState = {
  status: string;
  first_response_at: string | null;
  replied_at: string | null;
  resolved_at: string | null;
};
export function contactUpdate(
  current: ContactState,
  status: string,
  note: string,
  now: string,
) {
  return {
    status,
    admin_note: note,
    updated_at: now,
    first_response_at:
      current.first_response_at ?? (status !== "open" ? now : null),
    resolved_at: status === "resolved" ? (current.resolved_at ?? now) : null,
  };
}
export function externalReply(current: ContactState, now: string) {
  return {
    replied_at: now,
    updated_at: now,
    first_response_at: current.first_response_at ?? now,
    status: current.status === "open" ? "in_progress" : current.status,
  };
}
