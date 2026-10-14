import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("../src/lib/http")>()),
  authClient: async () => ({ auth: { getUser: m.getUser } }),
  csrf: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("../src/lib/supabase/admin")>()),
  db: () => ({ from: m.from }),
}));
vi.mock("@/lib/ai/pipeline", () => ({
  lock: async (_key: string, fn: () => unknown) => fn(),
}));
import { GET, POST } from "../src/app/api/admin/contact/route";
const id = "da9cf49d-7e52-4eec-a467-7acfb6a1f06f";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPERATOR_USER_IDS", "allowed-id");
  vi.stubEnv("MAIL_ENABLED", "false");
  m.getUser.mockResolvedValue({
    data: { user: { id: "allowed-id", email_confirmed_at: "date" } },
  });
  const contact = {
    id,
    email: "fixture@example.com",
    status: "open",
    first_response_at: null,
    replied_at: null,
    resolved_at: null,
  };
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [contact], error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: contact, error: null }),
    update: m.update,
  };
  m.update.mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  m.from.mockReturnValue(chain);
});
afterEach(() => vi.unstubAllEnvs());
it("an allowed confirmed operator reads the work queue without SMTP", async () => {
  const r = await GET(
    new Request("https://fixture.invalid/api/admin/contact?status=open"),
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    mailConfigured: false,
    messages: [{ id }],
  });
});
it("manual reply recording works with mail disabled and ignores forged dates", async () => {
  const r = await POST(
    new Request("https://fixture.invalid/api/admin/contact", {
      method: "POST",
      body: JSON.stringify({
        action: "external_reply",
        id,
        replied_at: "1900-01-01",
        status: "resolved",
      }),
    }),
  );
  expect(r.status).toBe(200);
  expect(m.update).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "in_progress",
      replied_at: expect.any(String),
    }),
  );
  expect(m.update.mock.calls[0][0].replied_at).not.toBe("1900-01-01");
});
it("outbound reply fails closed when SMTP is not configured", async () => {
  const r = await POST(
    new Request("https://fixture.invalid/api/admin/contact", {
      method: "POST",
      body: JSON.stringify({
        action: "reply",
        id,
        requestId: id,
        message: "回答です",
      }),
    }),
  );
  expect(r.status).toBe(409);
  expect(m.update).not.toHaveBeenCalled();
});
