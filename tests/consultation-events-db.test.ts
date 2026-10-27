import { beforeAll, afterAll, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { isolatedDb } from "./helpers/isolated-db";
import type { PGlite } from "@electric-sql/pglite";
let pg: PGlite;
const user = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002",
  subject = "20000000-0000-4000-8000-000000000001",
  otherSubject = "20000000-0000-4000-8000-000000000002",
  id = "30000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  pg = await isolatedDb();
  await pg.exec(
    await readFile(
      "supabase/migrations/20261027162006_consultation_manual_events.sql",
      "utf8",
    ),
  );
  await pg.query("insert into auth.users(id) values($1),($2)", [user, other]);
  await pg.query(
    "insert into consultation_subjects(id,user_id,nickname) values($1,$2,'A'),($3,$4,'B')",
    [subject, user, otherSubject, other],
  );
});
afterAll(async () => {
  await pg?.close();
});
async function call(
  who: string,
  action: string,
  target = id,
  s = subject,
  text = "手入力の出来事",
  revision: number | null = null,
) {
  await pg.exec("set role service_role");
  try {
    return (
      await pg.query<{ r: Record<string, unknown> }>(
        "select manage_consultation_event($1,$2,$3,$4,$5,$6,$7) r",
        [who, action, target, s, "2026-10-27", text, revision],
      )
    ).rows[0].r;
  } finally {
    await pg.exec("reset role");
  }
}
it("serializes create, prevents duplicates and cross-owner edits; optimistic edit never overwrites a newer revision", async () => {
  expect((await call(user, "create")).revision).toBe(1);
  expect((await call(user, "create")).revision).toBe(1);
  expect(
    (await pg.query("select * from consultation_events")).rows,
  ).toHaveLength(1);
  expect((await call(other, "update", id, subject, "bad", 1)).error).toBe(
    "not_found",
  );
  expect(
    (
      await call(
        user,
        "create",
        "30000000-0000-4000-8000-000000000002",
        otherSubject,
      )
    ).error,
  ).toBe("not_found");
  expect((await call(user, "update", id, subject, "修正", 1)).revision).toBe(2);
  expect((await call(user, "update", id, subject, "古い編集", 1)).error).toBe(
    "conflict",
  );
  expect((await call(user, "delete", id, subject, "", 1)).error).toBe(
    "conflict",
  );
  expect(
    (await pg.query("select text,source_type from consultation_events")).rows,
  ).toEqual([{ text: "修正", source_type: "manual" }]);
});
it("RLS reads belong to their owner only, client roles cannot mutate or call the internal function", async () => {
  for (const who of [user, other]) {
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      who,
    ]);
    await pg.exec("set role authenticated");
    try {
      expect(
        (await pg.query("select * from consultation_events")).rows.length,
      ).toBe(who === user ? 1 : 0);
    } finally {
      await pg.exec("reset role");
    }
  }
  const privileges = await pg.query<{ r: boolean }>(
    "select has_function_privilege('authenticated','manage_consultation_event(uuid,text,uuid,uuid,date,text,integer)','EXECUTE') or has_table_privilege('anon','consultation_events','SELECT') or has_table_privilege('authenticated','consultation_events','UPDATE') r",
  );
  expect(privileges.rows[0].r).toBe(false);
});
it("soft deleting a subject removes its manual events without changing other subjects", async () => {
  await pg.exec("set role service_role");
  try {
    await pg.query(
      "update consultation_subjects set nickname='[削除済み]' where id=$1",
      [subject],
    );
  } finally {
    await pg.exec("reset role");
  }
  expect(
    (await pg.query("select * from consultation_events")).rows,
  ).toHaveLength(0);
  expect((await call(user, "create")).error).toBe("not_found");
  expect(
    (
      await pg.query("select nickname from consultation_subjects where id=$1", [
        otherSubject,
      ])
    ).rows,
  ).toEqual([{ nickname: "B" }]);
});
