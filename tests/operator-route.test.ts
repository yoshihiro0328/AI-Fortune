import { it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("../src/lib/http")>()),
  authClient: async () => ({ auth: { getUser: m.getUser } }),
  csrf: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("../src/lib/supabase/admin")>()),
  db: () => ({ from: m.from, rpc: m.rpc }),
}));
import { GET, POST } from "../src/app/api/admin/contact/route";
it("anonymous and ordinary confirmed accounts cannot read contacts or queue replies", async () => {
  vi.stubEnv("OPERATOR_USER_IDS", "allowed-id");
  for (const user of [
    null,
    { id: "ordinary-id", email_confirmed_at: "date" },
    { id: "allowed-id" },
  ]) {
    m.getUser.mockResolvedValue({ data: { user } });
    expect(
      (await GET(new Request("https://fixture.invalid/api/admin/contact")))
        .status,
    ).toBe(403);
    expect(
      (
        await POST(
          new Request("https://fixture.invalid/api/admin/contact", {
            method: "POST",
            body: JSON.stringify({ action: "reply" }),
          }),
        )
      ).status,
    ).toBe(403);
  }
  expect(m.from).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
});
