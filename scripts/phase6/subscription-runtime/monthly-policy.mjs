import { Policy, TARGET, check } from "./policy.mjs";

// Lifecycle writes belong to the supervisor. The actual app can only consume
// signed notifications for one new E/F Customer, or read owner state. No GET
// billing reconciliation is admitted during the notification evidence interval.
export class MonthlyPolicy extends Policy {
  constructor(m, reserve) {
    super(m, reserve);
    check(m.scenario === "remaining-monthly-v1" && !m.resume && !m.postClose);
    this.contractLimit = 1;
    this.invoiceLimit = 2;
    this.cleanup = false;
    this.writers = [];
  }
  authorize(r) {
    const u = new URL(r.url);
    if (u.origin === TARGET.stripe) {
      check(
        r.method === "GET" &&
          !u.pathname.includes("checkout") &&
          !u.pathname.includes("billing_portal") &&
          !u.pathname.includes("test_clocks"),
        "MONTHLY_APP_WRITE_DENIED",
      );
    }
    if (u.origin === TARGET.supabase && r.method !== "GET") {
      check(
        !["/rest/v1/billing_customers", "/rest/v1/analytics_events"].includes(
          u.pathname,
        ),
      );
      if (u.pathname === "/rest/v1/rpc/apply_subscription_snapshot") {
        const b = JSON.parse(r.body);
        check(
          (b.p_event && this.events.has(b.p_event)) ||
            (this.cleanup && b.p_snapshot?.status === "canceled"),
          "DIRECT_WRITER_DENIED",
        );
        this.writers.push({
          event: b.p_event ?? null,
          source: b.p_event ? "webhook" : "cleanup",
          subscription: b.p_snapshot?.id,
        });
      }
    }
    return super.authorize(r);
  }
  signed(e, raw) {
    check(e.type !== "checkout.session.completed");
    if (e.type.startsWith("customer.subscription."))
      check(e.data.object.metadata?.run === this.m.run);
    return super.signed(e, raw);
  }
}
