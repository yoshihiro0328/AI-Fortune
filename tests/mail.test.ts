import { it, expect, vi, afterEach } from "vitest";
import { allowedOperator, mailConfig } from "../src/lib/mail-config";
const m = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn() }));
vi.mock("../src/lib/supabase/admin", () => ({
  db: () => ({ rpc: m.rpc, from: () => ({ update: m.update }) }),
  checked: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
import { receiptJobs, dispatchMail } from "../src/lib/mail";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function configured() {
  for (const [k, v] of Object.entries({
    MAIL_ENABLED: "true",
    RESEND_API_KEY: "fixture",
    EMAIL_FROM: "support@example.test",
    EMAIL_REPLY_TO: "reply@example.test",
    CONTACT_NOTIFY_TO: "operator@example.test",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
  }))
    vi.stubEnv(k, v);
}
it("operator authorization requires a confirmed allowlisted user UUID", () => {
  expect(allowedOperator(null, "a")).toBe(false);
  expect(allowedOperator({ id: "a" }, "a")).toBe(false);
  expect(allowedOperator({ id: "b", email_confirmed_at: "date" }, "a")).toBe(
    false,
  );
  expect(
    allowedOperator({ id: "a", email_confirmed_at: "date" }, " a ,b"),
  ).toBe(true);
  expect(allowedOperator({ id: "a", email_confirmed_at: "date" }, "")).toBe(
    false,
  );
});
it("missing or malformed sender settings do not claim email is queued", () => {
  vi.stubEnv("MAIL_ENABLED", "false");
  expect(mailConfig()).toBeNull();
  expect(receiptJobs("id", "person@example.test")).toEqual([]);
  configured();
  vi.stubEnv("EMAIL_FROM", "support@example.test\nBcc: victim@example.test");
  expect(mailConfig()).toBeNull();
});
it("receipts omit submitted text and operator notifications point to the public URL", () => {
  configured();
  const jobs = receiptJobs("fixture-id", "person@example.test");
  expect(jobs).toHaveLength(2);
  expect(jobs[0].payload.to).toEqual(["person@example.test"]);
  expect(jobs[0].payload.reply_to).toBe("reply@example.test");
  expect(jobs[1].payload.text).toContain(
    "https://app.example.test/admin/contact",
  );
});
it("provider outage stores failure; retry uses immutable key and payload, never claims delivery", async () => {
  configured();
  const job = {
    id: "job",
    dedupe_key: "receipt/fixture",
    payload: receiptJobs("fixture", "person@example.test")[0].payload,
  };
  m.rpc.mockResolvedValue({ data: [job], error: null });
  const q = {
    eq: () => q,
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  m.update.mockReturnValue(q);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response("failure", { status: 500 }))
    .mockResolvedValueOnce(Response.json({ id: "provider-id" }));
  vi.stubGlobal("fetch", fetchMock);
  await dispatchMail();
  expect(m.update.mock.calls[0][0].status).toBe("failed");
  await dispatchMail();
  expect(m.update.mock.calls[1][0].status).toBe("accepted");
  expect(m.update.mock.calls[1][0].provider_id).toBe("provider-id");
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).toBe(
    "receipt/fixture",
  );
});
