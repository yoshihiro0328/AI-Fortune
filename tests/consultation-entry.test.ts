import { expect, it } from "vitest";
import { consultationEntry } from "@/lib/consultation/entry";
import type { ConsultationHome } from "@/lib/consultation/model";
import { isDefiniteInputRejection, RequestError } from "@/lib/client";
import { safeReturnTo } from "@/lib/auth-return";
const h = {
  subjects: [{ id: "A" }, { id: "B" }, { id: "C" }],
  threads: [
    { id: "ta", subject_id: "A" },
    { id: "tb", subject_id: "B" },
  ],
  links: [{ diagnosis_id: "d", subject_id: "B" }],
} as ConsultationHome;
it("preserves selected empty subject and never defaults to the first history", () => {
  expect(consultationEntry(h, new URLSearchParams("subject=C"))).toMatchObject({
    subject: { id: "C" },
    threadId: undefined,
  });
  expect(consultationEntry(h, new URLSearchParams("subject=B"))).toMatchObject({
    subject: { id: "B" },
    threadId: "tb",
  });
  expect(
    consultationEntry(h, new URLSearchParams("thread=older-owned")),
  ).toMatchObject({ threadId: "older-owned" });
  expect(consultationEntry(h, new URLSearchParams())).toMatchObject({
    subject: undefined,
    threadId: undefined,
  });
  expect(
    consultationEntry(h, new URLSearchParams("diagnosis=d")),
  ).toMatchObject({ subject: { id: "B" }, threadId: "tb" });
  for (const q of ["subject=foreign", "subject=C&thread=ta"])
    expect(() => consultationEntry(h, new URLSearchParams(q))).toThrow();
});
it("only confirmed input rejection releases the pending request", () => {
  expect(
    isDefiniteInputRejection(
      new RequestError(400, "rejected", "INPUT_REJECTED"),
    ),
  ).toBe(true);
  expect(
    isDefiniteInputRejection(
      new RequestError(413, "rejected", "INPUT_REJECTED"),
    ),
  ).toBe(true);
  for (const e of [
    new Error("offline"),
    new RequestError(400, "unknown"),
    new RequestError(503, "unknown", "INPUT_REJECTED"),
    new RequestError(409, "busy"),
  ])
    expect(isDefiniteInputRejection(e)).toBe(false);
});
it("retains subject only as validated navigation metadata", () => {
  expect(
    safeReturnTo("/consult?subject=00000000-0000-4000-8000-000000000001"),
  ).not.toBeNull();
  expect(safeReturnTo("/consult?subject=foreign&text=private")).toBeNull();
});
