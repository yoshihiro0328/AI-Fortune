import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import type { PGlite } from "@electric-sql/pglite";
import {
  isolatedDb,
  applyIsolation,
  migrationName,
} from "./helpers/isolated-db";
const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  cookieOptions: [] as unknown[],
  rpc: vi.fn(),
  user: null as {
    id: string;
    email: string;
    email_confirmed_at: string | null;
  } | null,
  count: vi.fn(),
  generate: vi.fn(),
  construct: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) =>
      state.jar.has(k) ? { value: state.jar.get(k) } : undefined,
    getAll: () => [],
    set: (k: string, v: string, o: unknown) => {
      state.jar.set(k, v);
      state.cookieOptions.push(o);
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  db: () => ({ rpc: state.rpc }),
  checked: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      signUp: async () => ({ error: null }),
    },
  }),
}));
vi.mock("openai", () => ({
  default: class {
    constructor(o: unknown) {
      state.construct(o);
    }
    responses = { inputTokens: { count: state.count }, parse: state.generate };
  },
}));
import { POST as authPost } from "@/app/api/auth/route";
import { GET as read, POST as create } from "@/app/api/trial/session/route";
import { POST as send } from "@/app/api/trial/turns/route";
import { POST as claim } from "@/app/api/trial/claim/route";
import { DELETE as erase } from "@/app/api/trial/session/content/route";
let pg: PGlite;
const origin = "http://127.0.0.1:5187",
  user = "20000000-0000-4000-8000-000000000001";
const intake = {
  requestId: "10000000-0000-4000-8000-000000000001",
  topicId: "reply",
  topicVersion: 1,
  text: "返信に迷っています。相手が返しやすい言い方を考えたいです。",
  fields: { received: "最近どう？" },
};
function req(path: string, data: unknown, customOrigin = origin) {
  return new Request(origin + path, {
    method: "POST",
    headers: { origin: customOrigin, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
const sessionReq = () =>
  req("/api/trial/session", {
    consentVersion: "trial-2026-10-15",
    challengeToken: "synthetic-only",
  });
beforeEach(async () => {
  state.jar.clear();
  state.user = null;
  state.cookieOptions = [];
  vi.clearAllMocks();
  for (const [k, v] of Object.entries({
    TRIAL_ENABLED: "true",
    TRIAL_ENVIRONMENT: "sandbox",
    STRIPE_MODE: "sandbox",
    TRIAL_RETENTION_VERIFIED: "true",
    TRIAL_BUDGET_VERIFIED: "true",
    TRIAL_SESSION_SECRET: "synthetic-session-secret",
    SESSION_SECRET: "synthetic-auth-secret",
    TRIAL_ABUSE_SECRET: "synthetic-abuse-secret",
    TRIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    TRIAL_TURNSTILE_SECRET: "synthetic-challenge-secret",
    TRIAL_OPENAI_API_KEY: "synthetic-provider-key",
    NEXT_PUBLIC_APP_URL: origin,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon",
  }))
    vi.stubEnv(k, v);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        success: true,
        hostname: "127.0.0.1",
        action: "trial_session",
        challenge_ts: new Date().toISOString(),
      }),
    ),
  );
  state.count.mockResolvedValue({ input_tokens: 200 });
  state.generate.mockResolvedValue({
    id: "resp_synthetic",
    status: "completed",
    usage: { input_tokens: 200, output_tokens: 100 },
    output_parsed: {
      answer:
        "短い近況と、相手が答えやすい質問を一つ添えてみてはいかがでしょうか。",
      safety: false,
    },
  });
  pg = await isolatedDb();
  await applyIsolation(pg);
  for (const n of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql") && n > migrationName)
    .sort())
    await pg.exec(await readFile("supabase/migrations/" + n, "utf8"));
  await pg.exec(
    "update trial_private.settings set enabled=true,cleaned_at=now();update trial_private.prices set valid_until=now()+interval '1 day';",
  );
  state.rpc.mockImplementation(
    async (name: string, args: Record<string, unknown> = {}) => {
      const entries = Object.entries(args);
      try {
        const r = await pg.query<{ r: unknown }>(
          `select public.${name}(${entries.map(([k], i) => k + " => $" + (i + 1)).join(",")}) r`,
          entries.map(([, v]) => v),
        );
        return { data: r.rows[0].r, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  );
});
afterEach(async () => {
  await pg.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("real route -> encrypted DB -> synthetic provider -> claim", () => {
  it("replaces an expired session even when the old cookie is still present", async () => {
    expect((await create(sessionReq())).status).toBe(200);
    const oldCookie = state.jar.get("yorisoi_trial");
    await pg.exec("update trial_private.sessions set expires_at=now()-interval '1 second'");
    expect((await (await read()).json()).active).toBe(false);
    const response = await create(req("/api/trial/session", {
      consentVersion: "trial-2026-10-15",
      challengeToken: "synthetic-renewal",
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).active).toBe(true);
    expect(state.jar.get("yorisoi_trial")).not.toEqual(oldCookie);
    expect(state.generate).not.toHaveBeenCalled();
  });
  it("signup throttling spans cookie and email changes without changing monthly limits", async () => {
    for (let i = 0; i < 4; i++) {
      state.jar.clear();
      const response = await authPost(
        req("/api/auth", {
          action: "signup",
          email: `synthetic${i}@example.com`,
          password: "SyntheticPassword123!",
          consent: true,
        }),
      );
      expect(response.status).toBe(i < 3 ? 200 : 429);
    }
    const limits = await pg.query<{ free_limit: number; plus_limit: number }>(
      "select free_limit,plus_limit from service_settings",
    );
    expect(limits.rows[0]).toEqual({ free_limit: 3, plus_limit: 30 });
  });
  it("uses one reservation/provider call and replays saved answer after refresh", async () => {
    expect((await create(sessionReq())).status).toBe(200);
    expect(state.cookieOptions[0]).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      maxAge: 86400,
    });
    const response = await send(req("/api/trial/turns", intake));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.turn.answer).toContain("短い近況");
    expect(data.remaining).toBe(0);
    expect((await send(req("/api/trial/turns", intake))).status).toBe(200);
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(state.construct).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0, timeout: 25000 }),
    );
    expect(state.generate.mock.calls[0][0]).toMatchObject({
      store: false,
      max_output_tokens: 1200,
      service_tier: "default",
    });
    const raw = await pg.query<{ payload: string; answer: string }>(
      "select payload,answer from trial_private.turns",
    );
    expect(raw.rows[0].payload).not.toContain(intake.text);
    expect(raw.rows[0].answer).not.toContain("短い近況");
    expect((await read()).headers.get("cache-control")).toBe(
      "private, no-store",
    );
  });
  it("enforces consent, origin, challenge hostname/action/expiry before creating session", async () => {
    expect((await create(req("/api/trial/session", {}))).status).toBe(422);
    expect(
      (await create(req("/api/trial/session", {}, "https://evil.invalid")))
        .status,
    ).toBe(403);
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        success: true,
        hostname: "evil.invalid",
        action: "trial_session",
        challenge_ts: new Date().toISOString(),
      }),
    );
    expect((await create(sessionReq())).status).toBe(403);
    expect(state.generate).not.toHaveBeenCalled();
  });
  it("800 limit, changed-body idempotency and unknown topic fail without extra generation", async () => {
    await create(sessionReq());
    expect(
      (
        await send(
          req("/api/trial/turns", { ...intake, text: "あ".repeat(801) }),
        )
      ).status,
    ).toBe(422);
    expect(
      (await send(req("/api/trial/turns", { ...intake, topicId: "unknown" })))
        .status,
    ).toBe(422);
    await send(req("/api/trial/turns", intake));
    expect(
      (await send(req("/api/trial/turns", { ...intake, text: "別の内容" })))
        .status,
    ).toBe(409);
    expect(state.generate).toHaveBeenCalledTimes(1);
  });
  it("budget failure and stale model price never contact provider", async () => {
    await create(sessionReq());
    await pg.exec("update trial_private.settings set daily_nusd=1");
    expect((await send(req("/api/trial/turns", intake))).status).toBe(503);
    expect(state.count).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
  });
  it("counts the full input and rejects over-limit input before generation", async () => {
    await create(sessionReq());
    state.count.mockResolvedValue({ input_tokens: 3001 });
    expect((await send(req("/api/trial/turns", intake))).status).toBe(503);
    expect(state.generate).not.toHaveBeenCalled();
    expect(
      (
        await pg.query<{ n: number }>(
          "select settled_nusd::int n from trial_private.calls",
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("timeout preserves cost; retry succeeds without consuming monthly allowance", async () => {
    await create(sessionReq());
    state.generate.mockRejectedValueOnce(new Error("synthetic timeout"));
    expect((await send(req("/api/trial/turns", intake))).status).toBe(503);
    expect(
      (
        await pg.query<{ status: string }>(
          "select status from trial_private.calls",
        )
      ).rows[0].status,
    ).toBe("uncertain");
    expect((await send(req("/api/trial/turns", intake))).status).toBe(200);
    expect(state.generate).toHaveBeenCalledTimes(2);
  });
  it("invalid/empty provider output records usage but does not consume success quota", async () => {
    await create(sessionReq());
    state.generate.mockResolvedValue({
      id: "resp_bad",
      status: "completed",
      usage: { input_tokens: 50, output_tokens: 10 },
      output_parsed: { answer: "", safety: false },
    });
    expect((await send(req("/api/trial/turns", intake))).status).toBe(503);
    expect((await (await read()).json()).remaining).toBe(1);
    expect(
      (
        await pg.query<{ n: number }>(
          "select settled_nusd::int n from trial_private.calls",
        )
      ).rows[0].n,
    ).toBe(11250);
  });
  it("claims only after verified login, explicit consent and matching displayed account; resumes existing thread", async () => {
    await create(sessionReq());
    await send(req("/api/trial/turns", intake));
    const approval = { consent: true, expectedEmail: "synthetic@example.com" };
    expect((await claim(req("/api/trial/claim", approval))).status).toBe(401);
    state.user = {
      id: user,
      email: "synthetic@example.com",
      email_confirmed_at: new Date().toISOString(),
    };
    await pg.exec(
      `insert into auth.users(id,email_confirmed_at) values('${user}',now())`,
    );
    expect(
      (await claim(req("/api/trial/claim", { ...approval, consent: false })))
        .status,
    ).toBe(422);
    expect(
      (
        await claim(
          req("/api/trial/claim", {
            ...approval,
            expectedEmail: "other@example.com",
          }),
        )
      ).status,
    ).toBe(403);
    const r = await claim(req("/api/trial/claim", approval));
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.threadId).toBeTruthy();
    expect(
      await (await claim(req("/api/trial/claim", approval))).json(),
    ).toEqual(data);
    const resume = await pg.query<{ r: { error?: string; turn: unknown } }>(
      "select public.reserve_consultation($1,$2,$3,'その後の相談です',$4,false,false,null) r",
      [user, data.threadId, crypto.randomUUID(), crypto.randomUUID()],
    );
    expect(resume.rows[0].r.error).toBeUndefined();
    expect(resume.rows[0].r.turn).toBeTruthy();
  });
  it("foreign cookies see nothing; expiry returns a fresh-session state", async () => {
    await create(sessionReq());
    await send(req("/api/trial/turns", intake));
    state.jar.set("yorisoi_trial", "d".repeat(43));
    expect((await (await read()).json()).active).toBe(false);
    expect((await send(req("/api/trial/turns", intake))).status).toBe(410);
  });
  it("safe fallback does not call AI; deletion never resets allowance", async () => {
    await create(sessionReq());
    expect(
      (
        await send(
          req("/api/trial/turns", { ...intake, text: "昨日殴られました" }),
        )
      ).status,
    ).toBe(200);
    expect(state.generate).not.toHaveBeenCalled();
    expect((await (await read()).json()).turn.safety).toBe(true);
    expect(
      (
        await erase(
          new Request(origin + "/api/trial/session/content", {
            method: "DELETE",
            headers: { origin },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await (await read()).json()).remaining).toBe(0);
  });
  it("disabled/production gates reject before DB/provider operations", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await create(sessionReq())).status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
  });
});
