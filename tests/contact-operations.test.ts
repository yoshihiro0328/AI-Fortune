import { describe, it, expect } from "vitest";
import { contactUpdate, externalReply } from "../src/lib/contact-operations";
const now = "2026-10-07T07:00:00Z";
const initial = {
  status: "open",
  first_response_at: null,
  replied_at: null,
  resolved_at: null,
};
describe("manual contact operations without email", () => {
  it("records a response without claiming delivery or completion", () => {
    const result = externalReply(initial, now);
    expect(result).toMatchObject({
      status: "in_progress",
      first_response_at: now,
      replied_at: now,
    });
    expect(result).not.toHaveProperty("resolved_at");
  });
  it("preserves first response and completion when only notes change", () => {
    const current = {
      ...initial,
      status: "resolved",
      first_response_at: "earlier",
      resolved_at: "completed",
    };
    expect(
      contactUpdate(current, "resolved", "Internal note", now),
    ).toMatchObject({
      first_response_at: "earlier",
      resolved_at: "completed",
      admin_note: "Internal note",
    });
  });
  it("clears completion when reopening and preserves reply history", () => {
    const result = contactUpdate(
      { ...initial, status: "resolved", resolved_at: "old" },
      "open",
      "Needs more work",
      now,
    );
    expect(result.resolved_at).toBeNull();
    expect(result).not.toHaveProperty("replied_at");
  });
  it("does not reopen a completed request when another reply is recorded", () => {
    expect(
      externalReply(
        { ...initial, status: "resolved", first_response_at: "first" },
        now,
      ),
    ).toMatchObject({ status: "resolved", first_response_at: "first" });
  });
});
