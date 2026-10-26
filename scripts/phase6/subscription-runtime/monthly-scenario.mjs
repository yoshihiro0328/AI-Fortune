import { check } from "./policy.mjs";
import { cancellationVerdict } from "./remaining-plan.mjs";

// Identical sequencing for the real adapter and credential-free regression.
// start/observe are injected, but the real adapter must use the actual signed
// handler and commit row. No event synthesis, GET billing or direct snapshot here.
export async function monthlyScenario({
  ops,
  start,
  observe,
  record,
  stop,
  deadline,
  now = Date.now,
}) {
  const results = {};
  let active;
  const time = () => check(now() < deadline, "MONTHLY_DEADLINE");
  try {
    await ops.identify();
    for (const label of ["e", "f"]) {
      time();
      await ops.prepare(label);
      await ops.attach(label);
      active = await start(label, ops.state().fixtures[label]);
      await ops.createSubscription(label);
      const initial = await observe(label, "invoice.paid", { paidInvoices: 1 });
      const first = await ops.subscription(label);
      await ops.invoices(label);
      check(initial.state.status === "active" && initial.invoiceCount === 1);
      if (label === "f") {
        await ops.attach(label, true);
        await ops.switchFailureMethod();
      }
      const boundary = first.items.data[0].current_period_end;
      check(
        boundary + 3600 <= Math.floor(now() / 1000),
        "INITIAL_CLOCK_WINDOW_INVALID",
      );
      await ops.advance(label, boundary);
      await ops.advance(label, boundary + 3600);
      if (label === "e") {
        const renewal = await observe(label, "invoice.paid", {
          paidInvoices: 2,
          plan: "plus",
        });
        const current = await ops.subscription(label);
        const invoices = await ops.invoices(label);
        check(
          invoices.length === 2 &&
            invoices.every((i) => i.status === "paid") &&
            Date.parse(renewal.state.paid_through) >
              Date.parse(initial.state.paid_through),
        );
        results.renewal = {
          verified: true,
          invoiceCount: 2,
          plan: renewal.plan,
        };
        await record("renewal", results.renewal);
        await ops.scheduleEnd();
        const before = await observe(label, "customer.subscription.updated", {
          scheduled: true,
          plan: "plus",
        });
        await ops.advance(label, current.items.data[0].current_period_end);
        const after = await observe(label, "customer.subscription.deleted", {
          status: "canceled",
          plan: "free",
        });
        const verdict = cancellationVerdict({
          kind: after.kind,
          beforePlan: before.plan,
          afterPlan: after.plan,
          beforeStatus: before.state.status,
          afterStatus: after.state.status,
          sameSubscription: before.state.id === after.state.id,
          eventType: after.eventType,
          sameEvent: after.sameEvent,
          signatureVerified: after.signatureVerified,
          httpStatus: after.httpStatus,
          committed: after.committed,
          noOtherWriter: after.noOtherWriter,
          chronological:
            before.observedAt <= after.receivedAt &&
            after.receivedAt <= after.observedAt,
        });
        check(verdict.verified, "CANCELLATION_WITNESS_INCOMPLETE");
        check(
          (await ops.invoices(label)).length === 2,
          "EXTRA_RENEWAL_INVOICE",
        );
        results.periodEnd = {
          ...verdict,
          plan: after.plan,
          extraInvoice: false,
        };
        await record("period-end", results.periodEnd);
      } else {
        const failed = await observe(label, "invoice.payment_failed", {
          failed: true,
          plan: "free",
        });
        check(
          failed.state.paid_through === initial.state.paid_through,
          "FAILED_PAYMENT_EXTENDED_ACCESS",
        );
        results.failure = {
          verified: true,
          paidThroughExtended: false,
          plan: failed.plan,
        };
        await record("failure", results.failure);
        for (;;) {
          time();
          const s = await ops.subscription(label),
            invoices = await ops.invoices(label);
          const failedInvoice = invoices.find((i) => i.status !== "paid");
          if (s.status === "canceled") {
            const end = await observe(label, "customer.subscription.deleted", {
              status: "canceled",
              plan: "free",
            });
            results.retryExhaustion = {
              verified: end.committed && end.sameEvent,
              status: "canceled",
            };
            break;
          }
          check(
            failedInvoice?.status === "open" && invoices.length === 2,
            "FAILED_INVOICE_REQUIRED",
          );
          const next = failedInvoice.next_payment_attempt;
          const f = ops.state().fixtures.f;
          if (
            !Number.isSafeInteger(next) ||
            next <= f.frozen ||
            next >= f.periodEnd ||
            failedInvoice.attempt_count >= 9 ||
            f.advances >= 12
          ) {
            results.retryExhaustion = {
              verified: false,
              reason: "no_safe_scheduled_attempt_within_cap",
            };
            break;
          }
          await ops.advance(label, next);
        }
        await record("retry-exhaustion", results.retryExhaustion);
      }
      // E is already terminal. F's listener remains alive through cleanup.
      if (label === "e") {
        await stop(active);
        active = undefined;
      }
    }
  } catch {
    results.stopped = true;
    await record("trial-stop", {
      verified: false,
      reason: "read_or_write_or_evidence_failed",
    });
  } finally {
    results.cleanup = {};
    try {
      await ops.beginCleanup();
    } catch {
      // The gate is latched before persistence. Independent cleanup still runs;
      // every mutation must independently persist its own reservation.
      results.cleanup.journal = "unconfirmed";
    }
    for (const label of ["e", "f"]) {
      try {
        await ops.reconcileUnknownSubscription(label);
        await ops.closeSubscription(label);
        results.cleanup[label] = "canceled_or_not_created";
      } catch {
        results.cleanup[label] = "unconfirmed";
      }
    }
    try {
      await ops.voidFailureInvoice();
      results.cleanup.invoice = "void_or_none";
    } catch {
      results.cleanup.invoice = "unconfirmed";
    }
    try {
      if (active) await stop(active);
      results.cleanup.processes = "stopped";
    } catch {
      results.cleanup.processes = "unconfirmed";
    }
    await record("cleanup", results.cleanup);
  }
  return results;
}
