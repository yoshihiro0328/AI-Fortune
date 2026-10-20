import Stripe from "stripe";
import { check, TARGET, sha } from "./policy.mjs";
// Auth responses and signed payloads stay in parent memory, never in control output.
// The JWT used for RLS is the token returned by that user's actual login.
export function sessionEvidence({ m, wire, save }) {
  const tokens = new Map(),
    events = new Map();
  let seq = 0,
    replayed = false;
  const record = (value) =>
    check(save(`verification-${++seq}.enc`, value).verified);
  const read = (path, user, signal) =>
    wire({
      provider: "supabase",
      role: user ? "user" : "anon",
      path,
      bearer: user ? tokens.get(user) : undefined,
      operation: "verify_owner_rls",
      signal,
    });
  return {
    accepted(type, value) {
      if (type.kind !== "login") return;
      check(
        [m.c.id, m.d.id].includes(type.user) &&
          value.user?.id === type.user &&
          value.user.email_confirmed_at &&
          typeof value.access_token === "string",
      );
      tokens.set(type.user, value.access_token);
    },
    delivered(raw) {
      const e = JSON.parse(raw);
      const previous = events.get(e.id);
      check(!previous || sha(previous) === sha(raw), "EVENT_CHANGED");
      check(events.has(e.id) || events.size < 40, "EVENT_LIMIT");
      events.set(e.id, raw);
    },
    async logins(signal) {
      for (const user of [m.c, m.d]) {
        check(tokens.has(user.id), "OWNER_LOGIN_REQUIRED");
        const observed = await read("/auth/v1/user", user.id, signal);
        check(
          observed.id === user.id && observed.email_confirmed_at,
          "JWT_IDENTITY_MISMATCH",
        );
      }
      record({ ownerLogins: "verified" });
      return true;
    },
    hasDelivery(type, subscription, objectId) {
      return [...events.values()].some((raw) => {
        const e = JSON.parse(raw),
          o = e.data.object;
        const id = e.type.startsWith("customer.subscription.")
          ? o.id
          : e.type.startsWith("invoice.")
            ? o.parent?.subscription_details?.subscription
            : o.subscription;
        return (
          e.type === type &&
          id === subscription &&
          (!objectId || o.id === objectId)
        );
      });
    },
    async rls(subscriptionCount, invoiceCount, signal) {
      await this.logins(signal);
      const result = {};
      for (const user of [m.c.id, m.d.id, null]) {
        result[user ?? "anonymous"] = {};
        for (const [table, count] of [
          ["subscriptions", subscriptionCount],
          ["subscription_invoices", invoiceCount],
        ]) {
          let rows;
          try {
            rows = await read(
              `/rest/v1/${table}?select=*&limit=5`,
              user,
              signal,
            );
          } catch (e) {
            if (
              user === null &&
              (e.message === "42501" || [401, 403].includes(e.httpStatus))
            ) {
              rows = [];
            } else throw e;
          }
          check(
            Array.isArray(rows) && rows.every((r) => r.user_id === user),
            "RLS_OTHER_USER_VISIBLE",
          );
          check(
            rows.length === (user === m.c.id ? count : 0),
            "RLS_COUNT_MISMATCH",
          );
          result[user ?? "anonymous"][table] = rows.length;
        }
      }
      record({ rls: result });
      return true;
    },
    async replay(runtime, subscription, signal) {
      check(!replayed, "REPLAY_ALREADY_USED");
      const raw = [...events.values()].find((raw) => {
        const e = JSON.parse(raw);
        return (
          e.type === "customer.subscription.created" &&
          e.data.object.id === subscription
        );
      });
      check(raw, "REAL_DELIVERY_REQUIRED_BEFORE_REPLAY");
      // Two local injections of one already-delivered event: duplicate and older snapshot.
      // These are NOT Stripe event resend or real delivery evidence.
      const id = JSON.parse(raw).id;
      check(runtime.policy.events.get(id)?.count === 1, "EVENT_REPLAY_BUDGET");
      replayed = true;
      for (let i = 0; i < 2; i++) {
        const signature = Stripe.webhooks.generateTestHeaderString({
          payload: raw,
          secret: runtime.secret,
        });
        const res = await fetch(TARGET.broker + "/webhook", {
          method: "POST",
          headers: { "stripe-signature": signature },
          body: raw,
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        });
        check(res.status === 200, "LOCAL_REPLAY_FAILED");
      }
      record({
        localReplay: { duplicate: 1, olderSnapshot: 1, eventHash: sha(id) },
      });
    },
    erase() {
      tokens.clear();
      events.clear();
    },
  };
}
