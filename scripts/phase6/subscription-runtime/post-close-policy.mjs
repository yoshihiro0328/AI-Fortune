import { Policy, TARGET, check } from "./policy.mjs";

// A separate continuation for already paid and canceled records. No purchase,
// cancellation, customer creation, event injection or catalog writes are allowed.
export class PostClosePolicy extends Policy {
  constructor(m, reserve) {
    super(m, reserve);
    const p = m.postClose;
    check(
      p && Object.keys(p).sort().join(",") === "endedAt,invoice,subscription",
    );
    check(
      /^sub_[A-Za-z0-9_]+$/.test(p.subscription) &&
        p.subscription !== this.history?.subscription,
    );
    check(
      /^in_[A-Za-z0-9_]+$/.test(p.invoice) &&
        Number.isSafeInteger(p.endedAt) &&
        p.endedAt > 0,
    );
    this.ids.add(p.subscription);
  }
  authorize(r) {
    const u = new URL(r.url);
    if (u.origin === TARGET.stripe) {
      check(
        r.method === "GET" ||
          (r.method === "POST" && u.pathname === "/v1/billing_portal/sessions"),
        "POST_CLOSE_MUTATION_DENIED",
      );
      check(
        !u.pathname.includes("/checkout/") &&
          !u.pathname.includes("test_clocks"),
        "POST_CLOSE_PURCHASE_DENIED",
      );
    }
    if (u.origin === TARGET.supabase && r.method !== "GET") {
      check(
        !["/rest/v1/billing_customers", "/rest/v1/analytics_events"].includes(
          u.pathname,
        ),
        "POST_CLOSE_BINDING_DENIED",
      );
      if (u.pathname === "/rest/v1/rpc/apply_subscription_snapshot") {
        const b = JSON.parse(r.body),
          s = b.p_snapshot;
        check(!b.p_event, "POST_CLOSE_NOT_WEBHOOK");
        if (s.id === this.m.postClose.subscription) {
          check(
            s.status === "canceled" &&
              Date.parse(s.ended_at) === this.m.postClose.endedAt * 1000,
            "POST_CLOSE_STATE_MISMATCH",
          );
          check(
            b.p_invoices.length === 1 &&
              b.p_invoices[0].id === this.m.postClose.invoice,
            "POST_CLOSE_INVOICE_MISMATCH",
          );
        }
      }
    }
    return super.authorize(r);
  }
  accept(t, status, d) {
    if (["subscription", "subscriptions"].includes(t.kind)) {
      const rows = t.kind === "subscriptions" ? d.data : [d];
      check(
        rows.every(
          (s) =>
            s.id === this.history?.subscription ||
            (s.id === this.m.postClose.subscription &&
              s.status === "canceled" &&
              s.ended_at === this.m.postClose.endedAt),
        ),
        "POST_CLOSE_REMOTE_MISMATCH",
      );
    }
    if (
      t.kind === "invoices" &&
      t.subscription === this.m.postClose.subscription
    )
      check(
        d.data.length === 1 &&
          d.data[0].id === this.m.postClose.invoice &&
          d.data[0].status === "paid" &&
          d.data[0].amount_paid === 980 &&
          d.data[0].amount_remaining === 0,
        "POST_CLOSE_INVOICE_MISMATCH",
      );
    return super.accept(t, status, d);
  }
}

// Use only on an already-bound tab; never acquire/snapshot/screenshot a Portal
// tab. Return booleans only: no address, href, text, HTML, title or exception body.
export function portalObservation() {
  const portal =
    location.origin === "https://billing.stripe.com" &&
    location.pathname === "/p/session";
  if (!portal) return { portal: false, returnLink: false };
  const returnLink = [...document.querySelectorAll("a")].some(
    (a) =>
      a.getAttribute("href") === "http://localhost:5218/account" &&
      a.textContent.includes("に戻る"),
  );
  return { portal: true, returnLink };
}
