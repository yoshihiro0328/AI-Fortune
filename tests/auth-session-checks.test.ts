import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
const mock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: mock, from: mock.from }),
  parseCookieHeader: () => [],
  serializeCookieHeader: () => "",
}));
import { sessionChecks } from "../scripts/phase6/auth-session-checks.mjs";
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "auth-session-checks-"));
  fs.writeFileSync(path.join(dir, "stage"), "sessions");
  for (const l of ["a", "b"])
    fs.writeFileSync(
      path.join(dir, "user-" + l + ".json"),
      JSON.stringify({ id: l }),
    );
  vi.resetAllMocks();
  mock.getUser.mockResolvedValue({
    data: { user: { id: "a", email_confirmed_at: "fixture" } },
  });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true });
  vi.unstubAllGlobals();
});
async function invoke(
  action: string,
  origin = "http://localhost:5198",
  host = "localhost:5198",
) {
  const req = Object.assign(
    Readable.from([Buffer.from(JSON.stringify({ action }))]),
    { url: "/__step9", method: "POST", headers: { origin, host } },
  );
  let status = 0,
    text = "";
  const res = {
    writeHead: (v: number) => {
      status = v;
    },
    end: (v: string) => {
      text = v;
    },
    setHeader: vi.fn(),
  };
  await sessionChecks(req, res, dir);
  return { status, text, result: JSON.parse(text) };
}
describe("real-session test controls (offline)", () => {
  it("does not permit B recovery cleanup in normal session stage", async () => {
    expect((await invoke("recovery-logout-b")).status).toBe(403);
    expect(mock.signOut).not.toHaveBeenCalled();
  });
  it("protects A from the recovery cleanup even with a valid A identity", async () => {
    fs.writeFileSync(path.join(dir, "stage"), "b-recovery-cleanup");
    expect((await invoke("recovery-logout-b")).status).toBe(409);
    expect(mock.signOut).not.toHaveBeenCalled();
  });
  it("closes B sessions only after provider verification", async () => {
    fs.writeFileSync(path.join(dir, "stage"), "b-recovery-cleanup");
    mock.getUser.mockResolvedValue({
      data: { user: { id: "b", email_confirmed_at: "fixture" } },
    });
    mock.signOut.mockResolvedValue({ error: null });
    expect((await invoke("recovery-logout-b")).result).toEqual({
      label: "b",
      globalLogoutSucceeded: true,
    });
    expect(mock.signOut).toHaveBeenCalledWith({ scope: "global" });
  });
  it("reports recovery logout failure rather than claiming success", async () => {
    fs.writeFileSync(path.join(dir, "stage"), "b-recovery-cleanup");
    mock.getUser.mockResolvedValue({
      data: { user: { id: "b", email_confirmed_at: "fixture" } },
    });
    mock.signOut.mockResolvedValue({ error: { message: "fixture" } });
    expect((await invoke("recovery-logout-b")).status).toBe(409);
    expect(fs.existsSync(path.join(dir, "STOP"))).toBe(true);
  });
  it("rejects cross-origin before Auth", async () => {
    expect((await invoke("refresh", "https://evil.test")).status).toBe(403);
    expect(mock.getUser).not.toHaveBeenCalled();
  });
  it("rejects wrong Host before Auth", async () => {
    expect((await invoke("refresh", undefined, "evil.test")).status).toBe(403);
    expect(mock.getUser).not.toHaveBeenCalled();
  });
  it("stops for unauthenticated user", async () => {
    mock.getUser.mockResolvedValue({ data: { user: null }, error: {} });
    expect((await invoke("refresh")).status).toBe(409);
    expect(fs.existsSync(path.join(dir, "STOP"))).toBe(true);
  });
  it("stops for unconfirmed user", async () => {
    mock.getUser.mockResolvedValue({ data: { user: { id: "a" } } });
    expect((await invoke("refresh")).status).toBe(409);
  });
  it("stops for unknown account", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: { id: "c", email_confirmed_at: "fixture" } },
    });
    expect((await invoke("refresh")).status).toBe(409);
  });
  it("reports rotation without exposing credentials", async () => {
    mock.getSession.mockResolvedValue({
      data: { session: { refresh_token: "secret-before" } },
    });
    mock.refreshSession.mockResolvedValue({
      data: { session: { refresh_token: "secret-after" }, user: { id: "a" } },
    });
    const r = await invoke("refresh");
    expect(r.result).toEqual({
      label: "a",
      refreshed: true,
      sameUser: true,
      refreshTokenRotated: true,
    });
    expect(r.text).not.toContain("secret-");
  });
  it("stops for failed refresh", async () => {
    mock.getSession.mockResolvedValue({
      data: { session: { refresh_token: "secret-before" } },
    });
    mock.refreshSession.mockResolvedValue({ error: {} });
    expect((await invoke("refresh")).status).toBe(409);
  });
  it("detects cross-account rows instead of declaring RLS success", async () => {
    let n = 0;
    mock.from.mockImplementation(() => ({
      select: () => ({
        eq: async () => ({
          data: ++n === 1 ? [{ user_id: "a" }] : [{ user_id: "b" }],
        }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [{ user_id: "a" }, { user_id: "b" }] }),
      }),
    }));
    expect((await invoke("rls")).status).toBe(409);
    expect(fs.existsSync(path.join(dir, "STOP"))).toBe(true);
  });
  it("reports isolated RLS visibility", async () => {
    let n = 0;
    mock.from.mockImplementation(() => ({
      select: () => ({
        eq: async () => ({ data: ++n === 1 ? [{ user_id: "a" }] : [] }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [{ user_id: "a" }] }),
      }),
    }));
    expect((await invoke("rls")).result).toEqual({
      label: "a",
      ownCount: 1,
      otherCount: 0,
      allVisibleRowsBelongToSelf: true,
    });
  });
  it("unknown actions never send mail", async () => {
    expect((await invoke("signup")).status).toBe(409);
    expect(mock.refreshSession).not.toHaveBeenCalled();
  });
});
