import { randomBytes } from "node:crypto";
import {
  monthlyOperations,
  MONTHLY_PRICE,
  MONTHLY_PRODUCT,
  MONTHLY_VERSION,
} from "./monthly-operations.mjs";
import { monthlyScenario } from "./monthly-scenario.mjs";
import { TARGET, check } from "./policy.mjs";
import { API_VERSION, listener } from "./listener.mjs";
import { startRuntime } from "./runtime.mjs";
import { appTransport } from "./app-transport.mjs";
import { runtimeDiagnostics } from "./diagnostics.mjs";

// No automatic entry, environment fallback or credentials in return values.
// A private interactive owner must supply the already-received keys and handle
// revocation/deletion afterwards. Does not create keys or use any browser tab.
export async function executeMonthly({
  run,
  users,
  secrets,
  wire,
  cli,
  deadline,
  checkpoint,
  record,
  signal,
  continuation = false,
}) {
  const runtimes = new Set(),
    deliveries = new Map();
  let current,
    activeLabel,
    stopped = false,
    diagnosticSequence = 0;
  const deadlineSignal = AbortSignal.any([
    AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    ...(signal ? [signal] : []),
  ]);
  const ops = monthlyOperations({
    run,
    users,
    wire,
    deadline,
    checkpoint,
    signal: deadlineSignal,
    continuation,
  });
  const recordDiagnostic = runtimeDiagnostics((_name, value) => {
    record("runtime-" + ++diagnosticSequence, value);
    return { verified: true };
  });
  const stop = async (bundle) => {
    if (!bundle) return;
    const outcomes = await Promise.allSettled([
      bundle.listener.stop(),
      bundle.runtime?.stop(),
    ]);
    check(
      outcomes.every((o) => o.status === "fulfilled"),
      "MONTHLY_PROCESS_STOP_UNCONFIRMED",
    );
    runtimes.delete(bundle);
    if (current === bundle) current = undefined;
  };
  const start = async (label, f) => {
    check(!stopped && Date.now() < deadline);
    const other = label === "e" ? "f" : "e";
    const m = {
      run,
      project: TARGET.ref,
      account: TARGET.account,
      app: TARGET.app,
      scenario: "remaining-monthly-v1",
      synthetic: false,
      amount: 980,
      currency: "jpy",
      interval: "month",
      c: {
        id: users[label].id,
        email: users[label].email,
        cookie: randomBytes(24).toString("hex"),
      },
      d: {
        id: users[other].id,
        email: users[other].email,
        cookie: randomBytes(24).toString("hex"),
      },
      protectedUsers: [
        "74a7ac25-66f2-450e-a6a4-c72e498fd638",
        "ff82e4fe-6de5-4dde-887f-9ae7e8caf89b",
      ],
      customer: f.customer,
      clock: f.clock,
      price: MONTHLY_PRICE,
      product: MONTHLY_PRODUCT,
      version: MONTHLY_VERSION,
      portal: null,
      sessionSecret: randomBytes(32).toString("hex"),
    };
    const receiver = listener({
      ...cli,
      key: secrets.listener,
      run,
      apiVersion: API_VERSION,
      readAccount: () =>
        wire({
          provider: "stripe",
          role: "listener",
          path: "/v1/account",
          operation: "monthly_listener_account",
          signal: deadlineSignal,
        }),
    });
    const bundle = { listener: receiver, runtime: null };
    runtimes.add(bundle);
    try {
      const ready = await receiver.start();
      const evidence = {
        accepted() {}, // Policy response validation is already complete; no raw response logging.
        delivered(raw) {
          const e = JSON.parse(raw),
            o = e.data.object;
          const subscription = e.type.startsWith("customer.subscription.")
            ? o.id
            : o.parent?.subscription_details?.subscription;
          check(
            typeof subscription === "string" &&
              /^sub_[A-Za-z0-9]+$/.test(subscription),
          );
          // Drop raw payload, headers and all provider URLs. No payload persistence.
          const entry = {
            id: e.id,
            type: e.type,
            objectId: o.id,
            subscription,
            receivedAt: Date.now(),
            created: e.created,
            status: o.status,
            scheduled: o.cancel_at_period_end === true,
            signatureVerified: true,
            httpStatus: 200,
          };
          deliveries.set(e.id, entry);
          record("delivery", entry);
        },
      };
      const transport = appTransport({
        wire,
        signal: deadlineSignal,
        operations: {
          state: () => ({ stopped }),
          runtimeFailed: () => {
            stopped = true;
          },
        },
      });
      bundle.runtime = await startRuntime({
        m,
        transport,
        webhookSecret: ready.secret,
        signal: deadlineSignal,
        evidence,
        record: recordDiagnostic,
        onStop: () => {
          stopped = true;
        },
      });
      current = bundle;
      activeLabel = label;
      return bundle;
    } catch {
      await stop(bundle);
      throw Error("MONTHLY_RECEIVER_START_FAILED");
    }
  };
  const read = async (path, body, cleanup = false) =>
    wire({
      provider: "supabase",
      role: "service",
      path: "/rest/v1/" + path,
      method: body ? "POST" : "GET",
      body,
      operation: "monthly_evidence_read",
      signal: cleanup
        ? AbortSignal.timeout(
            Math.max(1, Math.min(5000, ops.cleanupRemaining())),
          )
        : deadlineSignal,
    });
  const observe = async (label, type, expected) => {
    check(current && activeLabel === label && !stopped);
    const f = ops.state().fixtures[label],
      until = Math.min(deadline, Date.now() + 60000);
    for (let n = 0; n < 12 && Date.now() < until; n++) {
      check(current.runtime.alive() && current.listener.alive() && !stopped);
      const stateRows = await read(
        `subscriptions?select=id,status,paid_through,cancel_at_period_end,period_start,period_end&user_id=eq.${users[label].id}&id=eq.${f.subscription}`,
      );
      const invoices = await read(
        `subscription_invoices?select=id,status,amount,period_end&user_id=eq.${users[label].id}&subscription_id=eq.${f.subscription}&order=period_end.desc&limit=3`,
      );
      check(invoices.length <= 2);
      const state = stateRows[0],
        paid = invoices.filter((i) => i.status === "paid" && i.amount === 980);
      const event = [...deliveries.values()]
        .reverse()
        .find(
          (e) =>
            e.subscription === f.subscription &&
            e.type === type &&
            (!expected.scheduled || e.scheduled) &&
            (!expected.status || e.status === expected.status) &&
            (type !== "invoice.paid" || e.objectId === paid[0]?.id) &&
            (type !== "invoice.payment_failed" ||
              invoices.some((i) => i.id === e.objectId && i.status === "open")),
        );
      if (
        state &&
        event &&
        (expected.paidInvoices === undefined ||
          paid.length === expected.paidInvoices) &&
        (!expected.status || state.status === expected.status) &&
        (!expected.scheduled || state.cancel_at_period_end)
      ) {
        const committed = await read(
          `stripe_events?select=stripe_event_id,event_type,processed_at&stripe_event_id=eq.${event.id}`,
        );
        const ent = await read("rpc/consultation_entitlement", {
          p_user: users[label].id,
        });
        const writer = current.runtime.policy.writers.find(
          (w) => w.event === event.id && w.subscription === f.subscription,
        );
        if (
          committed.length === 1 &&
          committed[0].event_type === type &&
          writer &&
          (!expected.plan || ent.plan === expected.plan)
        ) {
          const witness = {
            kind: "sandbox",
            state,
            plan: ent.plan,
            invoiceCount: invoices.length,
            eventId: event.id,
            eventType: type,
            sameEvent: committed[0].stripe_event_id === event.id,
            signatureVerified: true,
            httpStatus: 200,
            committed: true,
            noOtherWriter: current.runtime.policy.writers.every(
              (w) => w.source === "webhook",
            ),
            receivedAt: event.receivedAt,
            observedAt: Date.now(),
          };
          record("witness", witness);
          return witness;
        }
      }
      await new Promise((r) =>
        setTimeout(r, Math.min(5000, Math.max(0, until - Date.now()))),
      );
    }
    throw Error("MONTHLY_NOTIFICATION_EVIDENCE_TIMEOUT");
  };
  let result;
  try {
    result = await monthlyScenario({
      ops,
      start,
      observe,
      record,
      stop,
      deadline,
    });
  } finally {
    // Also runs if checkpointing or startup fails before the scenario can close.
    for (const bundle of [...runtimes]) {
      try {
        await stop(bundle);
      } catch {
        record("process-stop", { verified: false });
      }
    }
  }
  const closure = {};
  for (const label of ["e", "f"]) {
    const f = ops.state().fixtures[label];
    if (!f.user) {
      closure[label] = "not_created";
      continue;
    }
    try {
      check(ops.cleanupRemaining() > 0, "CLEANUP_DEADLINE");
      const ent = await read(
        "rpc/consultation_entitlement",
        { p_user: f.user },
        true,
      );
      closure[label] = ent.plan === "free" ? "free" : "unconfirmed";
    } catch {
      closure[label] = "unconfirmed";
    }
  }
  record("post-cleanup-entitlements", closure);
  return { result, closure, state: ops.state() };
}
