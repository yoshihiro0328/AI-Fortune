import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const result = await db.auth.admin.createUser({
  email: "qa-race-" + randomUUID() + "@example.invalid",
  email_confirm: true,
  user_metadata: { test_fixture: true },
});
if (result.error) throw result.error;
const user = result.data.user.id;
try {
  const s = await db
    .from("consultation_subjects")
    .insert({ user_id: user, nickname: "並行テスト" })
    .select("id")
    .single();
  if (s.error) throw s.error;
  const t = await db
    .from("consultation_threads")
    .insert({ user_id: user, subject_id: s.data.id, title: "並行テスト" })
    .select("id")
    .single();
  if (t.error) throw t.error;
  const inputs = Array.from({ length: 8 }, () => ({
    p_user: user,
    p_thread: t.data.id,
    p_id: randomUUID(),
    p_text: "同時送信テスト",
    p_token: randomUUID(),
    p_regenerate: false,
    p_safety: false,
    p_regeneration_key: null,
  }));
  const reserved = await Promise.all(
    inputs.map((p) => db.rpc("reserve_consultation", p)),
  );
  for (const r of reserved) if (r.error) throw r.error;
  assert.equal(reserved.filter((r) => r.data.turn).length, 1);
  assert.equal(reserved.filter((r) => r.data.error === "busy").length, 7);
  const entitlement = await db.rpc("consultation_entitlement", {
    p_user: user,
  });
  assert.equal(entitlement.data.used, 0);
  assert.equal(entitlement.data.remaining, 2);
  console.log(
    JSON.stringify({
      ok: true,
      simultaneousRequests: 8,
      reserved: 1,
      rejectedBusy: 7,
      used: 0,
      remaining: 2,
    }),
  );
} finally {
  await db.from("consultation_subjects").delete().eq("user_id", user);
  const r = await db.auth.admin.deleteUser(user);
  if (r.error) throw r.error;
}
