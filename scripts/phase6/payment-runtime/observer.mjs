import Stripe from "stripe";
import { insist, hash } from "./policy.mjs";

// Secrets stay in this parent-process closure; the app cannot invoke these checks.
export function createObserver({ manifest, record, request, replay, secret }) {
  const tokens = new Map();
  let notification, replayReserved = false, rlsReserved = false;
  return {
    accepted(ticket, data) {
      if (ticket.kind === "login") {
        insist([manifest.a.id, manifest.b.id].includes(ticket.user));
        tokens.set(ticket.user, data.access_token);
        record("login_observed", { user: ticket.user === manifest.a.id ? "A" : "B" });
      }
    },
    webhook(raw, signature) {
      if (!notification) notification = { raw, signature };
      else insist(hash(raw) === hash(notification.raw), "WEBHOOK_CHANGED");
      record("webhook_response_success");
    },
    async duplicate() {
      insist(notification && !replayReserved, "DUPLICATE_NOT_READY_OR_RESERVED");
      // Normal SDK timestamp tolerance: do not refresh or forge the signature.
      new Stripe("rk_test_local_proxy").webhooks.constructEvent(notification.raw, notification.signature, secret());
      replayReserved = true;
      record("duplicate_reserved", { bodyHash: hash(notification.raw) });
      await replay(notification.raw, notification.signature);
      record("duplicate_response_success");
    },
    async rls(paymentId) {
      insist(!rlsReserved && paymentId && tokens.size === 2, "RLS_NOT_READY_OR_RESERVED");
      rlsReserved = true;
      record("rls_observation_reserved");
      for (const [label, user] of [["A",manifest.a.id],["B",manifest.b.id]]) {
        for (const table of ["payments","paid_reports"]) {
          const rows = await request(tokens.get(user), `${table}?diagnosis_id=eq.${manifest.diagnosis}&select=id,diagnosis_id${table === "payments" ? ",user_id,status" : ",payment_id,status"}`);
          insist(Array.isArray(rows));
          if (label === "B") insist(rows.length === 0, "RLS_CROSS_ACCOUNT_LEAK");
          else {
            insist(rows.length === 1 && rows[0].diagnosis_id === manifest.diagnosis);
            if (table === "payments") insist(rows[0].id === paymentId && rows[0].user_id === user && rows[0].status === "paid");
            else insist(rows[0].payment_id === paymentId && rows[0].status === "ready");
          }
          record("rls_observed",{user:label,table,rows:rows.length});
        }
      }
    },
    clear() { tokens.clear(); notification = undefined; },
  };
}
