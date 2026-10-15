import { afterEach, describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import {
  isolatedDb,
  applyIsolation,
  migrationName,
} from "./helpers/isolated-db";
import type { PGlite } from "@electric-sql/pglite";
let pg: PGlite;
const h = "a".repeat(64),
  ip = "b".repeat(64),
  challenge = "c".repeat(64),
  req = "10000000-0000-4000-8000-000000000001",
  user = "20000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000002";
async function setup() {
  pg = await isolatedDb();
  await applyIsolation(pg);
  for (const name of (await readdir("supabase/migrations"))
    .filter((n) => n.endsWith(".sql") && n > migrationName)
    .sort())
    await pg.exec(await readFile("supabase/migrations/" + name, "utf8"));
  await pg.exec(
    "update trial_private.settings set enabled=true,cleaned_at=now(); update trial_private.prices set valid_until=now()+interval '1 day';",
  );
}
async function rpc(name: string, args: unknown[] = []) {
  await pg.exec("set role service_role");
  try {
    const r = await pg.query<{
      r: {
        error?: string;
        call: { id: string; reserved_nusd: number };
        lease: string;
        turnId: string;
        turn: { status: string; answer: string };
        remaining: number;
        enabled: boolean;
        cached: boolean;
        threadId: string;
        used: number;
        deletedSessions: number;
      };
    }>(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) r`,
      args,
    );
    return r.rows[0].r;
  } finally {
    await pg.exec("reset role");
  }
}
async function session(hash = h, network = ip, ch = challenge) {
  return rpc("trial_create", [hash, network, ch, "trial-2026-10-15"]);
}
async function reserve(hash = h, id = req, body = "body") {
  return rpc("trial_reserve", [hash, id, body, "general", "encrypted-input"]);
}
async function success(hash = h, id = req) {
  const r = await reserve(hash, id);
  await rpc("trial_finish", [
    r.call.id,
    r.lease,
    "encrypted-answer",
    false,
    100,
    200,
    "resp_test",
    false,
  ]);
  return r;
}
afterEach(async () => {
  await pg?.close();
});
describe("trial transactional database", () => {
  it("defaults OFF; preserves existing settings, payments and policies", async () => {
    pg = await isolatedDb();
    await applyIsolation(pg);
    const before = await pg.query(
      "select free_limit,plus_limit from service_settings",
    );
    for (const n of (await readdir("supabase/migrations"))
      .filter((n) => n > migrationName && n.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + n, "utf8"));
    expect((await rpc("trial_policy")).enabled).toBe(false);
    expect(
      await pg.query("select free_limit,plus_limit from service_settings"),
    ).toEqual(before);
    expect((await session()).error).toBe("paused");
  });
  it("reserves before any call; handles replays, conflicts and 24h quota", async () => {
    await setup();
    await session();
    const r = await reserve();
    expect(r.call.reserved_nusd).toBe(1950000);
    expect((await reserve()).error).toBe("busy");
    expect((await reserve(h, req, "changed")).error).toBe("conflict");
    await rpc("trial_finish", [
      r.call.id,
      r.lease,
      "answer",
      false,
      100,
      200,
      "resp",
      false,
    ]);
    expect((await reserve()).cached).toBe(true);
    expect(
      (await reserve(h, "10000000-0000-4000-8000-000000000002")).error,
    ).toBe("quota");
    expect((await rpc("trial_read", [h])).remaining).toBe(0);
  });
  it("budget, unknown/expired prices, missing cleanup and environment fail closed", async () => {
    await setup();
    await session();
    await pg.exec("update trial_private.settings set daily_nusd=1");
    expect((await reserve()).error).toBe("budget");
    await pg.exec(
      "update trial_private.settings set daily_nusd=3000000000,model='unpriced'",
    );
    expect((await reserve()).error).toBe("pricing");
    await pg.exec(
      "update trial_private.settings set model='gpt-6-luna',cleaned_at=now()-interval '11 minutes'",
    );
    expect((await reserve()).error).toBe("paused");
    await pg.exec(
      "update trial_private.settings set cleaned_at=now();update trial_private.prices set valid_until=now()-interval '1 second'",
    );
    expect((await reserve()).error).toBe("pricing");
  });
  it("uncertain failure keeps cost, retries spend new reservation and stop after three", async () => {
    await setup();
    await session();
    for (let i = 0; i < 3; i++) {
      const r = await reserve();
      expect(r.call).toBeTruthy();
      expect(
        (
          await rpc("trial_finish", [
            r.call.id,
            r.lease,
            null,
            false,
            null,
            null,
            null,
            false,
          ])
        ).error,
      ).toBe("provider");
    }
    expect((await reserve()).error).toBe("quota");
    const sums = await pg.query<{ n: number }>(
      "select sum(reserved_nusd)::int n from trial_private.calls where settled_nusd is null",
    );
    expect(sums.rows[0].n).toBe(5850000);
    expect((await rpc("trial_read", [h])).remaining).toBe(1);
  });
  it("pre-generation failures release cost but preserve attempt limits", async () => {
    await setup();
    await session();
    const r = await reserve();
    await rpc("trial_finish", [
      r.call.id,
      r.lease,
      null,
      false,
      null,
      null,
      null,
      true,
    ]);
    expect(
      (
        await pg.query<{ n: number }>(
          "select settled_nusd::int n from trial_private.calls",
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await reserve()).call).toBeTruthy();
  });
  it("over-limit provider usage records full cost and disables generation", async () => {
    await setup();
    await session();
    const r = await reserve();
    await rpc("trial_finish", [
      r.call.id,
      r.lease,
      "answer",
      false,
      4000,
      2000,
      "resp",
      false,
    ]);
    expect((await rpc("trial_policy")).enabled).toBe(false);
    expect((await rpc("trial_read", [h])).turn.status).toBe("failed");
  });
  it("expired worker is fenced and cannot overwrite a retry", async () => {
    await setup();
    await session();
    const first = await reserve();
    await pg.exec(
      "update trial_private.turns set lease_until=now()-interval '1 second'",
    );
    const second = await reserve();
    expect(second.lease).not.toBe(first.lease);
    await rpc("trial_finish", [
      first.call.id,
      first.lease,
      "stale",
      false,
      10,
      10,
      "resp",
      false,
    ]);
    expect((await rpc("trial_read", [h])).turn.status).toBe("pending");
    await rpc("trial_finish", [
      second.call.id,
      second.lease,
      "fresh",
      false,
      10,
      10,
      "resp2",
      false,
    ]);
    expect((await rpc("trial_read", [h])).turn.answer).toBe("fresh");
  });
  it("verified explicit claim is atomic, idempotent, uncharged and owner bound", async () => {
    await setup();
    await session();
    const r = await success();
    await pg.exec(
      `insert into auth.users(id,email_confirmed_at) values('${user}',null),('${other}',now())`,
    );
    const args = [h, user, r.turnId, "相談したこと", "短い回答", "general", {}];
    expect((await rpc("trial_claim", args)).error).toBe("auth");
    await pg.exec(
      `update auth.users set email_confirmed_at=now() where id='${user}'`,
    );
    const claimed = await rpc("trial_claim", args);
    expect(claimed.threadId).toBeTruthy();
    expect(await rpc("trial_claim", args)).toEqual(claimed);
    expect((await rpc("trial_claim", [h, other, ...args.slice(2)])).error).toBe(
      "ownership",
    );
    const ent = await rpc("consultation_entitlement", [user]);
    expect(ent.used).toBe(0);
    expect(ent.remaining).toBe(3);
    expect((await rpc("trial_read", [h])).turn).toBeUndefined();
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from consultation_turns",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("claim rollback leaves no partial subject, thread or transferred content", async () => {
    await setup();
    await session();
    const r = await success();
    await pg.exec(
      `insert into auth.users(id,email_confirmed_at) values('${user}',now());create function public.fail_test() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure';end $$;create trigger fail_test before insert on public.consultation_turns for each row execute function public.fail_test();`,
    );
    await expect(
      rpc("trial_claim", [h, user, r.turnId, "相談", "回答", "general", {}]),
    ).rejects.toThrow("synthetic failure");
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from consultation_subjects",
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await rpc("trial_read", [h])).turn.answer).toBe("encrypted-answer");
  });
  it("content deletion preserves quota and prevents late completion / claim", async () => {
    await setup();
    await session();
    const r = await reserve();
    await rpc("trial_delete_content", [h]);
    expect(
      (
        await rpc("trial_finish", [
          r.call.id,
          r.lease,
          "late",
          false,
          10,
          10,
          "resp",
          false,
        ])
      ).error,
    ).toBe("expired");
    expect((await reserve()).error).toBe("claimed");
    expect((await rpc("trial_read", [h])).turn).toBeNull();
  });
  it("TTL deletion keeps anonymous diagnosis sessions and cost ledger separate", async () => {
    await setup();
    await session();
    await success();
    await pg.exec(
      "update trial_private.sessions set expires_at=now()-interval '1 second'",
    );
    expect((await rpc("trial_read", [h])).error).toBe("expired");
    expect((await rpc("trial_cleanup")).deletedSessions).toBe(1);
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from trial_private.turns",
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pg.query<{ n: number }>(
          "select count(*)::int n from trial_private.calls",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("challenge replay and issuance throttles resist cookie/account replacement", async () => {
    await setup();
    await session();
    expect((await session("d".repeat(64), ip, challenge)).error).toBe(
      "challenge",
    );
    await pg.exec("update trial_private.settings set ip_hour_limit=1");
    expect((await session("d".repeat(64), ip, "e".repeat(64))).error).toBe(
      "rate",
    );
  });
  it("direct anonymous/authenticated table and function access is denied", async () => {
    await setup();
    for (const role of ["anon", "authenticated"]) {
      for (const q of [
        "select * from trial_private.sessions",
        "select public.trial_policy()",
        "select * from public.trial_thread_context",
      ]) {
        await pg.exec("set role " + role);
        await expect(pg.query(q)).rejects.toThrow(/permission denied/);
        await pg.exec("reset role");
      }
    }
    const f = await pg.query<{ n: number }>(
      "select count(*)::int n from pg_proc where proname like 'trial_%' and prosecdef",
    );
    expect(f.rows[0].n).toBe(0);
  });
  it("settles late usage after cleanup without restoring expired plaintext", async () => {
    await setup();
    await session();
    const r = await reserve();
    await pg.exec(
      "update trial_private.sessions set expires_at=now()-interval '1 second';update trial_private.turns set lease_until=now()-interval '1 second'",
    );
    await rpc("trial_cleanup");
    expect(
      (
        await rpc("trial_finish", [
          r.call.id,
          r.lease,
          "late",
          false,
          4000,
          2000,
          "resp_late",
          false,
        ])
      ).error,
    ).toBe("expired");
    const rows = await pg.query<{
      settled_nusd: number;
      turn_id: string | null;
    }>("select settled_nusd,turn_id from trial_private.calls");
    expect(Number(rows.rows[0].settled_nusd)).toBe(1500000);
    expect(rows.rows[0].turn_id).toBeNull();
    expect((await rpc("trial_policy")).enabled).toBe(false);
    await rpc("trial_finish", [
      r.call.id,
      r.lease,
      null,
      false,
      null,
      null,
      null,
      true,
    ]);
    expect(
      (await pg.query("select settled_nusd,turn_id from trial_private.calls"))
        .rows,
    ).toEqual(rows.rows);
  });
  it("midnight and older unresolved calls cannot open another daily budget", async () => {
    await setup();
    await session();
    const r = await reserve();
    await pg.exec(
      "update trial_private.calls set budget_day=budget_day-1;update trial_private.settings set daily_nusd=2000000",
    );
    await session("d".repeat(64), "e".repeat(64), "f".repeat(64));
    expect((await reserve("d".repeat(64))).error).toBe("budget");
    await pg.exec(
      "update trial_private.calls set created_at=now()-interval '2 days',status='uncertain'",
    );
    expect((await reserve("d".repeat(64))).error).toBe("budget");
    expect((await rpc("trial_availability")).enabled).toBe(false);
    expect(r.call.reserved_nusd).toBe(1950000);
  });
  it("heartbeat expiry, failed deletion, recovery and price expiry fail closed", async () => {
    await setup();
    await session();
    await pg.exec(
      "update trial_private.settings set cleaned_at=now()-interval '11 minutes'",
    );
    expect((await rpc("trial_availability")).enabled).toBe(false);
    await rpc("trial_cleanup");
    expect((await rpc("trial_policy")).enabled).toBe(false);
    await pg.exec(
      "update trial_private.settings set enabled=true,cleaned_at=now()-interval '11 minutes';update trial_private.sessions set expires_at=now()-interval '1 second';create function public.fail_purge() returns trigger language plpgsql as $$begin raise exception 'synthetic purge failure';end $$;create trigger fail_purge before delete on trial_private.sessions for each row execute function public.fail_purge();",
    );
    await expect(rpc("trial_cleanup")).rejects.toThrow(
      "synthetic purge failure",
    );
    expect((await rpc("trial_availability")).enabled).toBe(false);
    expect((await rpc("trial_read", [h])).error).toBe("expired");
    await pg.exec("drop trigger fail_purge on trial_private.sessions");
    await rpc("trial_cleanup");
    await pg.exec(
      "update trial_private.settings set enabled=true;update trial_private.prices set valid_until=now()-interval '1 second'",
    );
    expect((await rpc("trial_availability")).enabled).toBe(false);
  });
  it("purging unsettled old liability disables service rather than silently resetting budget", async () => {
    await setup();
    await session();
    await reserve();
    await pg.exec(
      "update trial_private.calls set created_at=now()-interval '36 days'",
    );
    await rpc("trial_cleanup");
    expect((await rpc("trial_policy")).enabled).toBe(false);
  });
  it("claimed foreign turn IDs and deleted content cannot enter a member thread", async () => {
    await setup();
    await session();
    const own = await success();
    const foreign = "d".repeat(64);
    await session(foreign, "e".repeat(64), "f".repeat(64));
    const another = await success(foreign);
    await pg.exec(
      `insert into auth.users(id,email_confirmed_at) values('${user}',now())`,
    );
    expect(
      (
        await rpc("trial_claim", [
          h,
          user,
          another.turnId,
          "foreign",
          "foreign",
          "general",
          {},
        ])
      ).error,
    ).toBe("conflict");
    await rpc("trial_delete_content", [h]);
    expect(
      (
        await rpc("trial_claim", [
          h,
          user,
          own.turnId,
          "own",
          "own",
          "general",
          {},
        ])
      ).error,
    ).toBe("conflict");
    expect(
      (await pg.query("select * from public.consultation_threads")).rows,
    ).toHaveLength(0);
  });
  it("all trial tables enforce RLS and every public trial RPC denies browser roles", async () => {
    await setup();
    const tables = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname,relrowsecurity from pg_class where relkind='r' and (relnamespace='trial_private'::regnamespace or relname='trial_thread_context')",
    );
    expect(tables.rows).toHaveLength(8);
    expect(tables.rows.every((t) => t.relrowsecurity)).toBe(true);
    const grants = await pg.query<{ role: string; allowed: boolean }>(
      "select r.role,has_function_privilege(r.role,p.oid,'EXECUTE') allowed from pg_proc p cross join (values('anon'),('authenticated')) r(role) where p.pronamespace='public'::regnamespace and p.proname like 'trial_%'",
    );
    expect(grants.rows).toHaveLength(22);
    expect(grants.rows.some((g) => g.allowed)).toBe(false);
  });
});
