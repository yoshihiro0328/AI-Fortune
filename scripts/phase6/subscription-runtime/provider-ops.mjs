import { check, sha, TARGET } from "./policy.mjs";
import { validTestPassword } from "./test-password.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { API_VERSION } from "./listener.mjs";
import { minimal, MINIMAL_LIMITS } from "./minimal-profile.mjs";
import {
  retainedResume,
  retainedPortal,
  inspectRetained,
} from "./retained-resume.mjs";
import { LIMITS } from "./journal.mjs";
// Scoped provisioning and closure; never accepts caller-supplied endpoints or SQL.
// m contains dedicated C/D identities (new or explicitly retained), not credentials.
export function providerOperations({
  m,
  wire,
  save,
  record = () => {},
  signal,
  human,
  attemptId,
  clockApproval,
}) {
  const isMinimal = minimal(m);
  const resume = retainedResume(m, attemptId);
  const limits = resume
    ? {
        ...MINIMAL_LIMITS,
        createUsers: 0,
        createCustomer: 0,
        createPortalConfiguration: 0,
        bindCustomer: 0,
        resetDedicatedPasswords: 2,
        reactivateRetainedPortal: 1,
      }
    : isMinimal
      ? MINIMAL_LIMITS
      : LIMITS;
  const contractLimit = isMinimal ? 1 : 2;
  const invoiceLimit = isMinimal ? 1 : 4;
  check(m.apiVersion === API_VERSION, "API_VERSION_MISMATCH");
  check(
    isMinimal || (Number.isSafeInteger(m.frozenTime) && m.frozenTime > 0),
    "CLOCK_TIME_REQUIRED",
  );
  check(
    m.project === TARGET.ref &&
      m.account === TARGET.account &&
      m.app === TARGET.app,
  );
  check(
    /^[a-f0-9-]{36}$/.test(attemptId) && attemptId !== m.run,
    "NEW_ATTEMPT_REQUIRED",
  );
  check(
    m.protectedUsers.length === 2 &&
      m.c.id !== m.d.id &&
      [m.c.id, m.d.id].every(
        (id) => /^[a-f0-9-]{36}$/.test(id) && !m.protectedUsers.includes(id),
      ),
  );
  for (const value of [m.price, m.version])
    check(/^[A-Za-z0-9_-]+$/.test(value));
  // Supplied from the retained Stripe catalog, independently of DB availability.
  const initialStripePriceActive = m.stripePriceInitiallyActive ?? false;
  check(
    typeof initialStripePriceActive === "boolean",
    "PRICE_BASELINE_REQUIRED",
  );
  check(
    Object.keys(m.retained).sort().join(",") ===
      "diagnoses,diagnosis_answers,free_reports,paid_reports,payments",
  );
  for (const id of Object.values(m.retained)) check(/^[a-f0-9-]{36}$/.test(id));
  check(
    !isMinimal || (initialStripePriceActive === true && clockApproval == null),
    "MINIMAL_BASELINE_REQUIRED",
  );
  const advanceLimit = isMinimal
    ? 0
    : (clockApproval?.limit ?? LIMITS.advanceClock);
  check(
    (isMinimal && advanceLimit === 0) ||
      advanceLimit === 3 ||
      (advanceLimit === 5 &&
        clockApproval?.explicit === true &&
        typeof clockApproval.reference === "string" &&
        clockApproval.reference.length > 0),
    "CLOCK_APPROVAL_REQUIRED",
  );
  const state = {
    attemptId,
    fixtureRun: m.run,
    previousAttemptId: resume?.sourceAttemptId ?? m.previousAttemptId ?? null,
    clockAdvanceLimit: advanceLimit,
    clockApprovalReference: clockApproval?.reference ?? null,
    users: [],
    clock: null,
    customer: null,
    portal: null,
    binding: false,
    dbPrice: false,
    portalRef: false,
    stripePrice: false,
    subscriptions: [],
    checkouts: [],
    reservations: [],
    unknown: [],
    stopped: false,
  };
  let priceBefore;
  let seq = 0,
    baseline,
    checked = false,
    frozen = m.frozenTime;
  const runtimeCounts = new Map();
  const counts = new Map(),
    invoiceIds = new Set();
  const humanPrice = async (active, cleanup = false) => {
    const waitSignal = AbortSignal.any([
      AbortSignal.timeout(60000),
      ...(!cleanup && signal ? [signal] : []),
    ]);
    let abort;
    try {
      check(!waitSignal.aborted, "HUMAN_WAIT_ABORTED");
      return await Promise.race([
        Promise.resolve().then(() => {
          check(!waitSignal.aborted, "HUMAN_WAIT_ABORTED");
          return human.price(active, waitSignal);
        }),
        new Promise((_, reject) => {
          abort = () => reject(Error("HUMAN_WAIT_ABORTED"));
          waitSignal.addEventListener("abort", abort, { once: true });
        }),
      ]);
    } finally {
      if (abort) waitSignal.removeEventListener("abort", abort);
    }
  };
  const snapshot = () => structuredClone(state);
  const persist = () =>
    check(
      save(`state-${String(++seq).padStart(4, "0")}.enc`, snapshot()).verified,
      "STATE_BACKUP_UNVERIFIED",
    );
  const get = (
    provider,
    path,
    operation,
    role = provider === "stripe" ? "lifecycle" : "service",
    cleanup = false,
  ) =>
    wire({
      provider,
      path,
      operation,
      role,
      signal: cleanup ? undefined : signal,
    });
  async function change(
    operation,
    scope,
    fn,
    { cleanup = false, limit = limits[operation] ?? 1 } = {},
  ) {
    check(cleanup || (!state.stopped && !signal?.aborted), "STOPPED");
    const key = `${cleanup ? "cleanup:" : ""}${operation}:${scope}`;
    check(!state.reservations.includes(key), "ALREADY_RESERVED");
    if (operation === "advanceClock") limit = advanceLimit;
    const countKey = `${cleanup ? "cleanup:" : ""}${operation}`,
      count = (counts.get(countKey) ?? 0) + 1;
    check(count <= limit, "OPERATION_LIMIT");
    counts.set(countKey, count);
    state.reservations.push(key);
    persist();
    try {
      const out = await fn();
      persist();
      record({ operation, outcome: "verified" });
      return out;
    } catch {
      state.stopped = true;
      state.unknown.push(key);
      persist();
      record({ operation, outcome: "failed_or_unknown" });
      throw Error("RESULT_UNKNOWN_STOP");
    }
  }
  const stripe = (
    method,
    path,
    body,
    operation,
    role = "lifecycle",
    cleanup = false,
  ) =>
    wire({
      provider: "stripe",
      role,
      method,
      path,
      body,
      operation,
      signal: cleanup ? undefined : signal,
      idempotencyKey: `${attemptId}-${operation}-${sha([method, path, body]).slice(0, 24)}`,
    });
  const db = (method, path, body, operation, cleanup = false) =>
    wire({
      provider: "supabase",
      role: "service",
      method,
      path,
      body,
      operation,
      signal: cleanup ? undefined : signal,
    });
  const exactRow = (rows, id, field = "id") => {
    check(
      Array.isArray(rows) && rows.length === 1 && rows[0][field] === id,
      "ROW_MISMATCH",
    );
    return rows[0];
  };
  const customerCheck = (c) =>
    check(
      c.id === state.customer &&
        c.livemode === false &&
        c.test_clock === state.clock &&
        c.metadata?.run === m.run &&
        c.metadata?.user_id === m.c.id,
      "CUSTOMER_MISMATCH",
    );
  const subCheck = (s) =>
    check(
      state.subscriptions.includes(s.id) &&
        s.customer === state.customer &&
        s.livemode === false &&
        s.metadata?.user_id === m.c.id &&
        s.items?.data?.length === 1 &&
        s.items.data[0].price.id === m.price,
      "SUBSCRIPTION_MISMATCH",
    );
  async function observation(cleanup = false) {
    const read = (provider, path, op) =>
      get(
        provider,
        path,
        op,
        provider === "stripe" ? "lifecycle" : "service",
        cleanup,
      );
    const out = {
      payment_environment: await read(
        "supabase",
        "/rest/v1/payment_environment?select=*&order=id",
        "identify_database",
      ),
    };
    check(
      out.payment_environment.length === 1 &&
        out.payment_environment[0].stripe_account_id === TARGET.account &&
        out.payment_environment[0].mode === "sandbox",
      "DATABASE_MISMATCH",
    );
    for (const table of ["price_versions", "service_settings"])
      out[table] = await read(
        "supabase",
        `/rest/v1/${table}?select=*&order=id`,
        "observe_" + table,
      );
    for (const [table, id] of Object.entries(m.retained))
      out[table] = await read(
        "supabase",
        `/rest/v1/${table}?select=*&id=eq.${id}`,
        "observe_retained",
      );
    for (const id of m.protectedUsers) {
      check(/^[a-f0-9-]{36}$/.test(id));
      out["profile:" + id] = await read(
        "supabase",
        `/rest/v1/profiles?select=*&user_id=eq.${id}`,
        "observe_profile",
      );
      out["subscriptions:" + id] = await read(
        "supabase",
        `/rest/v1/subscriptions?select=*&user_id=eq.${id}&order=id`,
        "observe_subscriptions",
      );
    }
    return out;
  }
  let authPrepared = false;
  const resetPasswords = async (passwords) => {
    check(
      [passwords?.c, passwords?.d].every(validTestPassword),
      "PASSWORD_CLASSES_REQUIRED",
    );
    for (const [label, user] of [
      ["c", m.c],
      ["d", m.d],
    ]) {
      check(
        typeof passwords[label] === "string" && passwords[label].length >= 12,
      );
      await change("resetDedicatedPasswords", user.id, async () => {
        const raw = await db(
          "PUT",
          "/auth/v1/admin/users/" + user.id,
          { password: passwords[label] },
          "reset_retained_password",
        );
        const u = raw.user ?? raw;
        check(
          u.id === user.id &&
            u.email === user.email &&
            u.email_confirmed_at &&
            u.app_metadata?.integration_run === m.run,
          "RETAINED_USER_MISMATCH",
        );
      });
    }
    authPrepared = true;
  };
  const api = {
    state: snapshot,
    observe: observation,
    reserveRuntime(key, number) {
      check(!state.stopped && !signal?.aborted, "STOPPED");
      const operation =
        key === "checkout"
          ? "checkout"
          : key === "portal"
            ? "portal"
            : key.startsWith("cancel:")
              ? "cancelPeriodEnd"
              : null;
      if (operation) {
        const n = (runtimeCounts.get(operation) ?? 0) + 1;
        check(n <= limits[operation], "OPERATION_LIMIT");
        runtimeCounts.set(operation, n);
      }
      state.reservations.push("runtime:" + key + ":" + number);
      persist();
    },
    runtimeFailed() {
      state.stopped = true;
      state.unknown.push("runtime:failed_or_unknown");
      persist();
    },
    async compatibilityPortal() {
      check(!isMinimal, "MINIMAL_OPERATION_DENIED");
      check(state.customer && state.portal && !state.stopped);
      const n = (runtimeCounts.get("portal") ?? 0) + 1;
      check(n <= limits.portal, "OPERATION_LIMIT");
      runtimeCounts.set("portal", n);
      return change("compatibilityPortal", state.customer, async () => {
        const p = await stripe(
          "POST",
          "/v1/billing_portal/sessions",
          {
            customer: state.customer,
            configuration: state.portal,
            return_url: TARGET.app + "/account",
          },
          "compatibility_portal",
        );
        check(
          p.customer === state.customer &&
            p.configuration === state.portal &&
            p.return_url === TARGET.app + "/account",
        );
        const u = new URL(p.url);
        check(
          u.protocol === "https:" &&
            u.hostname === "billing.stripe.com" &&
            !u.username &&
            !u.password,
        );
        return { url: p.url }; // One-time navigation returned only to the browser, never to the audit log.
      });
    },
    async prepareAuthentication(expected, passwords) {
      check(resume && !authPrepared && !checked, "PREKEY_AUTH_STATE");
      const observed = await observation();
      check(expected && sha(observed) === sha(expected), "BASELINE_MISMATCH");
      check(
        observed.payment_environment.length === 1 &&
          observed.payment_environment[0].stripe_account_id ===
            TARGET.account &&
          observed.payment_environment[0].mode === "sandbox" &&
          observed.price_versions.every((p) => p.active === false),
        "PREKEY_TARGET_MISMATCH",
      );
      for (const user of [m.c, m.d]) {
        const raw = await get(
          "supabase",
          "/auth/v1/admin/users/" + user.id,
          "identify_retained_user",
        );
        const u = raw.user ?? raw;
        check(
          u.id === user.id &&
            u.email === user.email &&
            u.email_confirmed_at &&
            u.app_metadata?.integration_run === m.run,
          "RETAINED_USER_MISMATCH",
        );
        for (const table of [
          "profiles",
          "diagnoses",
          "payments",
          "subscriptions",
          "subscription_invoices",
        ]) {
          const rows = await get(
            "supabase",
            `/rest/v1/${table}?select=user_id&user_id=eq.${user.id}`,
            "prekey_user_empty",
          );
          check(rows.length === 0, "RETAINED_USER_NOT_EMPTY");
        }
        const rows = await get(
          "supabase",
          `/rest/v1/billing_customers?select=*&user_id=eq.${user.id}`,
          "prekey_binding",
        );
        check(
          user.id === m.c.id
            ? rows.length === 1 &&
                rows[0].stripe_customer_id === resume.customer &&
                rows[0].is_test === true &&
                rows[0].checkout_session_id === null
            : rows.length === 0,
          "RETAINED_BINDING_MISMATCH",
        );
      }
      baseline = observed;
      await resetPasswords(passwords);
    },
    async inspect(expected) {
      check(!checked && !state.stopped);
      for (const role of ["app", "listener", "lifecycle"])
        check(
          (await get("stripe", "/v1/account", "identify_account", role)).id ===
            TARGET.account,
          "ACCOUNT_MISMATCH",
        );
      const observed = await observation();
      check(expected && sha(observed) === sha(expected), "BASELINE_MISMATCH");
      check(
        observed.payment_environment.length === 1 &&
          observed.payment_environment[0].stripe_account_id ===
            TARGET.account &&
          observed.payment_environment[0].mode === "sandbox",
      );
      const price = exactRow(
        observed.price_versions.filter((p) => p.id === m.version),
        m.version,
      );
      check(
        price.kind === "plus" &&
          price.amount === 980 &&
          price.currency === "jpy" &&
          price.is_test &&
          price.stripe_price_id === m.price &&
          price.stripe_product_id === m.product,
      );
      check(
        observed.price_versions.every((p) => p.active === false),
        "ACTIVE_PRICE",
      );
      check(
        observed.service_settings.length === 1 &&
          observed.service_settings[0].id === true,
      );
      for (const [table, id] of Object.entries(m.retained))
        exactRow(observed[table], id);
      for (const user of [m.c, m.d]) {
        const rows = await get(
          "supabase",
          `/rest/v1/profiles?select=user_id&user_id=eq.${user.id}`,
          "planned_user_absent",
        );
        check(
          rows.length === (authPrepared ? 1 : 0) &&
            rows.every((r) => r.user_id === user.id),
          "USER_ALREADY_EXISTS",
        );
      }
      const p = await get("stripe", "/v1/prices/" + m.price, "identify_price");
      check(
        p.id === m.price &&
          p.product === m.product &&
          p.livemode === false &&
          p.active === initialStripePriceActive &&
          p.unit_amount === 980 &&
          p.currency === "jpy" &&
          p.recurring?.interval === "month" &&
          p.recurring?.interval_count === 1,
        "PRICE_MISMATCH",
      );
      check(save("stripe-price-before.enc", p).verified);
      if (resume) await inspectRetained({ m, get, save, observed });
      priceBefore = p;
      baseline = observed;
      check(save("baseline.enc", baseline).verified);
      checked = true;
      return { matched: true };
    },
    async prepare(passwords) {
      check(checked && !state.stopped, "PREFLIGHT_REQUIRED");
      if (resume) {
        state.users = [m.c.id, m.d.id];
        state.customer = resume.customer;
        state.portal = resume.portal;
        state.binding = true;
        persist();
        if (!authPrepared) await resetPasswords(passwords);
        await change("reactivateRetainedPortal", state.portal, async () => {
          const p = await stripe(
            "POST",
            "/v1/billing_portal/configurations/" + state.portal,
            { active: true },
            "reactivate_retained_portal",
          );
          retainedPortal(p, m, true);
        });
      } else {
        for (const [label, user] of [
          ["c", m.c],
          ["d", m.d],
        ]) {
          check(
            typeof passwords[label] === "string" &&
              passwords[label].length >= 12,
          );
          await change("createUsers", user.id, async () => {
            const raw = await db(
              "POST",
              "/auth/v1/admin/users",
              {
                id: user.id,
                email: user.email,
                password: passwords[label],
                email_confirm: true,
                app_metadata: { integration_run: m.run },
              },
              "create_user",
            );
            const u = raw.user ?? raw;
            check(
              u.id === user.id &&
                u.email === user.email &&
                u.email_confirmed_at,
              "USER_RESPONSE_MISMATCH",
            );
            state.users.push(u.id);
          });
        }
        if (!isMinimal)
          await change("createClock", m.run, async () => {
            const c = await stripe(
              "POST",
              "/v1/test_helpers/test_clocks",
              { frozen_time: m.frozenTime, name: "yorisoi-plus-" + m.run },
              "create_clock",
            );
            check(
              /^clock_[A-Za-z0-9_]+$/.test(c.id) &&
                c.livemode === false &&
                c.status === "ready" &&
                c.frozen_time === m.frozenTime,
              "CLOCK_RESPONSE_MISMATCH",
            );
            state.clock = c.id;
          });
        await change("createCustomer", m.c.id, async () => {
          const c = await stripe(
            "POST",
            "/v1/customers",
            {
              ...(!isMinimal ? { test_clock: state.clock } : {}),
              metadata: { run: m.run, user_id: m.c.id },
            },
            "create_customer",
          );
          check(/^cus_[A-Za-z0-9_]+$/.test(c.id));
          state.customer = c.id;
          customerCheck(c);
        });
        await change("createPortalConfiguration", m.run, async () => {
          const c = await stripe(
            "POST",
            "/v1/billing_portal/configurations",
            {
              business_profile: { headline: "よりそい検証" },
              default_return_url: TARGET.app + "/account",
              metadata: { run: m.run },
              features: {
                subscription_update: { enabled: false },
                customer_update: { enabled: false },
                subscription_cancel: isMinimal
                  ? { enabled: false }
                  : { enabled: true, mode: "at_period_end" },
                invoice_history: { enabled: true },
                payment_method_update: { enabled: !isMinimal },
              },
            },
            "create_portal_configuration",
          );
          check(
            /^bpc_[A-Za-z0-9_]+$/.test(c.id) &&
              c.active &&
              c.livemode === false &&
              c.metadata?.run === m.run,
            "PORTAL_RESPONSE_MISMATCH",
          );
          state.portal = c.id;
        });
        await change("bindCustomer", m.c.id, async () => {
          const rows = await db(
            "POST",
            "/rest/v1/billing_customers",
            {
              user_id: m.c.id,
              stripe_customer_id: state.customer,
              is_test: true,
            },
            "bind_customer",
          );
          check(
            exactRow(rows, m.c.id, "user_id").stripe_customer_id ===
              state.customer,
          );
          state.binding = true;
        });
      }
      await change("bindPortal", m.run, async () => {
        const old = baseline.service_settings[0].portal_configuration_id;
        const condition =
          old === null ? "is.null" : "eq." + encodeURIComponent(old);
        const rows = await db(
          "PATCH",
          "/rest/v1/service_settings?id=eq.true&portal_configuration_id=" +
            condition,
          { portal_configuration_id: state.portal },
          "bind_portal",
        );
        check(exactRow(rows, true).portal_configuration_id === state.portal);
        state.portalRef = true;
      });
      await change("activatePrice", m.price, async () => {
        const before = await get(
          "stripe",
          "/v1/prices/" + m.price,
          "read_price_before_enable",
        );
        check(
          before.id === m.price &&
            before.livemode === false &&
            before.active === initialStripePriceActive,
          "PRICE_BASELINE_CHANGED",
        );
        state.stripePrice = true;
        persist(); // Human outcome can be unknown; always inspect at cleanup.
        if (!before.active)
          check(await humanPrice(true), "HUMAN_PRICE_UNCONFIRMED");
        const p = await get("stripe", "/v1/prices/" + m.price, "confirm_price");
        check(p.id === m.price && p.livemode === false && p.active === true);
        const rows = await db(
          "PATCH",
          `/rest/v1/price_versions?id=eq.${m.version}&active=eq.false`,
          { active: true },
          "activate_db_price",
        );
        check(exactRow(rows, m.version).active === true);
        state.dbPrice = true;
      });
      return {
        ...m,
        customer: state.customer,
        clock: state.clock,
        portal: state.portal,
      };
    },
    async bindCheckout(id) {
      check(
        /^cs_test_[A-Za-z0-9_]+$/.test(id) && !state.stopped && state.customer,
      );
      check(
        state.checkouts.includes(id) || state.checkouts.length < contractLimit,
      );
      const c = await get(
        "stripe",
        "/v1/checkout/sessions/" + id,
        "bind_checkout",
        "app",
      );
      check(
        c.id === id &&
          c.customer === state.customer &&
          c.mode === "subscription" &&
          c.livemode === false &&
          c.amount_total === 980 &&
          c.currency === "jpy" &&
          c.metadata?.user_id === m.c.id,
        "CHECKOUT_MISMATCH",
      );
      if (!state.checkouts.includes(id)) state.checkouts.push(id);
      persist();
      if (c.subscription) {
        const sid =
          typeof c.subscription === "string"
            ? c.subscription
            : c.subscription.id;
        check(
          /^sub_[A-Za-z0-9_]+$/.test(sid) &&
            (state.subscriptions.includes(sid) ||
              state.subscriptions.length < contractLimit),
        );
        const s = await get(
          "stripe",
          "/v1/subscriptions/" + sid,
          "bind_subscription",
        );
        if (!state.subscriptions.includes(sid)) state.subscriptions.push(sid);
        subCheck(s);
        persist();
      }
      return { status: c.status, paid: c.payment_status === "paid" };
    },
    async inspectSubscription(id) {
      check(state.subscriptions.includes(id));
      const subscription = await get(
        "stripe",
        "/v1/subscriptions/" + id,
        "observe_subscription",
      );
      subCheck(subscription);
      const invoices = await get(
        "stripe",
        "/v1/invoices?subscription=" + id + "&limit=5",
        "observe_invoices",
        "app",
      );
      check(invoices.has_more === false && Array.isArray(invoices.data));
      for (const i of invoices.data) {
        check(
          /^in_[A-Za-z0-9_]+$/.test(i.id) &&
            i.livemode === false &&
            i.customer === state.customer &&
            i.parent?.subscription_details?.subscription === id,
        );
        check(
          i.currency === "jpy" &&
            i.total === 980 &&
            Number.isInteger(i.attempt_count) &&
            i.attempt_count >= 0 &&
            i.attempt_count <= 1,
          "INVOICE_OR_RETRY_MISMATCH",
        );
        invoiceIds.add(i.id);
      }
      check(invoiceIds.size <= invoiceLimit, "INVOICE_LIMIT");
      check(
        save(`invoice-observation-${String(++seq).padStart(4, "0")}.enc`, {
          subscription,
          invoices,
        }).verified,
      );
      return { subscription, invoices: invoices.data };
    },
    async advanceClock(target) {
      check(!isMinimal, "MINIMAL_OPERATION_DENIED");
      check(
        checked &&
          state.clock &&
          !state.stopped &&
          Number.isSafeInteger(target) &&
          target > frozen &&
          target - frozen <= 32 * 86400,
        "CLOCK_ADVANCE_DENIED",
      );
      const path = "/v1/test_helpers/test_clocks/" + state.clock;
      const before = await get("stripe", path, "read_clock");
      check(
        before.id === state.clock &&
          before.livemode === false &&
          before.status === "ready" &&
          before.frozen_time === frozen,
      );
      await change("advanceClock", String(target), async () => {
        const c = await stripe(
          "POST",
          path + "/advance",
          { frozen_time: target },
          "advance_clock",
        );
        check(
          c.id === state.clock &&
            c.livemode === false &&
            ["advancing", "ready"].includes(c.status),
        );
        // At most 12 reads / 60 seconds. Never repeat advance if processing is uncertain.
        const deadline = Date.now() + 60000;
        for (let i = 0; i < 12 && Date.now() < deadline; i++) {
          const observed = await wire({
            provider: "stripe",
            role: "lifecycle",
            path,
            operation: "confirm_clock",
            signal: AbortSignal.any([
              ...(signal ? [signal] : []),
              AbortSignal.timeout(Math.max(1, deadline - Date.now())),
            ]),
          });
          check(observed.id === state.clock && observed.livemode === false);
          if (observed.status === "ready") {
            check(observed.frozen_time === target);
            frozen = target;
            return;
          }
          check(observed.status === "advancing");
          if (i < 11) await delay(5000, undefined, { signal });
        }
        throw Error("CLOCK_NOT_READY");
      });
    },
    async paymentMethod(id, failing) {
      check(!isMinimal, "MINIMAL_OPERATION_DENIED");
      check(
        state.subscriptions.includes(id) &&
          typeof failing === "boolean" &&
          !state.stopped,
      );
      const s = await get(
        "stripe",
        "/v1/subscriptions/" + id,
        "read_payment_subscription",
      );
      subCheck(s);
      check(!["canceled", "incomplete_expired"].includes(s.status));
      if (failing) {
        check(
          state.originalMethod === undefined &&
            typeof s.default_payment_method === "string" &&
            /^pm_[A-Za-z0-9_]+$/.test(s.default_payment_method),
          "RESTORE_METHOD_REQUIRED",
        );
        state.originalMethod = {
          subscription: id,
          id: s.default_payment_method,
        };
        persist();
        await change("attachFailureMethod", id, async () => {
          const pm = await stripe(
            "POST",
            "/v1/payment_methods/pm_card_chargeCustomerFail/attach",
            { customer: state.customer },
            "attach_failure_method",
          );
          check(
            /^pm_[A-Za-z0-9_]+$/.test(pm.id) &&
              pm.customer === state.customer &&
              pm.livemode === false,
          );
          state.failingMethod = pm.id;
          persist();
        });
      } else
        check(
          state.originalMethod?.subscription === id,
          "RESTORE_METHOD_REQUIRED",
        );
      const method = failing ? state.failingMethod : state.originalMethod.id;
      await change(
        failing ? "setFailingMethod" : "setGoodMethod",
        id,
        async () => {
          const out = await stripe(
            "POST",
            "/v1/subscriptions/" + id,
            { default_payment_method: method },
            failing ? "set_failure_method" : "restore_method",
          );
          subCheck(out);
          check(out.default_payment_method === method);
        },
      );
    },
    async endSubscription(id) {
      check(state.subscriptions.includes(id) && !state.stopped);
      const before = await get(
        "stripe",
        "/v1/subscriptions/" + id,
        "read_before_cancel",
      );
      subCheck(before);
      if (["canceled", "incomplete_expired"].includes(before.status)) return;
      await change("cancelImmediate", id, async () => {
        const out = await stripe(
          "DELETE",
          "/v1/subscriptions/" + id,
          { invoice_now: false, prorate: false },
          "cancel_subscription",
        );
        subCheck(out);
        check(out.status === "canceled");
      });
    },
    async inspectAfter() {
      const after = await observation(true);
      for (const [key, value] of Object.entries(baseline)) {
        if (["price_versions", "service_settings"].includes(key)) {
          const omitTime = (rows) =>
            rows.map((row) =>
              key === "service_settings" || row.id === m.version
                ? Object.fromEntries(
                    Object.entries(row).filter(
                      ([field]) => field !== "updated_at",
                    ),
                  )
                : row,
            );
          check(
            sha(omitTime(after[key])) === sha(omitTime(value)),
            "SETTINGS_NOT_RESTORED",
          );
          continue;
        }
        check(sha(after[key]) === sha(value), "PROTECTED_DATA_CHANGED");
      }
      check(save("after.enc", after).verified);
      return { protectedUnchanged: true };
    },
    stop() {
      state.stopped = true;
      persist();
    },
    async cleanupAuthentication() {
      state.stopped = true;
      const observed = await observation();
      check(
        baseline && sha(observed) === sha(baseline),
        "PREKEY_BASELINE_CHANGED",
      );
      check(
        state.checkouts.length === 0 &&
          state.subscriptions.length === 0 &&
          !checked,
        "PREKEY_ONLY_CLOSURE_REQUIRED",
      );
      check(save("auth-only-after.enc", observed).verified);
      persist();
      return state.unknown.length === 0;
    },
    async cleanup() {
      state.stopped = true;
      persist();
      const result = {};
      const step = async (name, fn) => {
        try {
          await fn();
          result[name] = "verified";
        } catch {
          result[name] = "failed_or_unknown";
        }
      };
      // No repeated end/expire/restore even if caller invokes cleanup a second time.
      // Refresh only known Checkout IDs first: payment may complete just before interruption.
      // A failed resource must not prevent closure of the remaining known resources.
      const contractResults = [];
      const independent = async (fn) => {
        try {
          await fn();
          contractResults.push(true);
        } catch {
          contractResults.push(false);
        }
      };
      for (const id of state.checkouts)
        await independent(async () => {
          const c = await get(
            "stripe",
            "/v1/checkout/sessions/" + id,
            "cleanup_read_checkout",
            "app",
            true,
          );
          check(
            c.id === id &&
              c.customer === state.customer &&
              c.livemode === false,
          );
          if (c.subscription) {
            const sid =
              typeof c.subscription === "string"
                ? c.subscription
                : c.subscription.id;
            check(/^sub_[A-Za-z0-9_]+$/.test(sid));
            if (!state.subscriptions.includes(sid)) {
              check(state.subscriptions.length < contractLimit);
              state.subscriptions.push(sid);
              persist();
            }
          }
          if (["complete", "expired"].includes(c.status)) return;
          check(c.status === "open");
          await change(
            "expireCheckout",
            id,
            async () => {
              const out = await stripe(
                "POST",
                "/v1/checkout/sessions/" + id + "/expire",
                {},
                "cleanup_expire",
                "app",
                true,
              );
              check(
                out.id === id &&
                  out.status === "expired" &&
                  out.customer === state.customer &&
                  out.livemode === false,
              );
            },
            { cleanup: true },
          );
        });
      for (const id of state.subscriptions)
        await independent(async () => {
          const s = await get(
            "stripe",
            "/v1/subscriptions/" + id,
            "cleanup_read_subscription",
            "lifecycle",
            true,
          );
          subCheck(s);
          if (["canceled", "incomplete_expired"].includes(s.status)) return;
          check(
            !state.unknown.some((k) => k.endsWith(":" + id)),
            "UNKNOWN_SUBSCRIPTION_MUTATION",
          );
          await change(
            "cleanupCancel",
            id,
            async () => {
              const out = await stripe(
                "DELETE",
                "/v1/subscriptions/" + id,
                { invoice_now: false, prorate: false },
                "cleanup_cancel",
                "lifecycle",
                true,
              );
              subCheck(out);
              check(out.status === "canceled");
            },
            { cleanup: true },
          );
        });
      result.endContracts = contractResults.every(Boolean)
        ? "verified"
        : "failed_or_unknown";
      await step("invoiceSafety", async () => {
        check(
          result.endContracts === "verified" && state.unknown.length === 0,
          "UNKNOWN_RESOURCE_OR_CONTRACT",
        );
        for (const id of state.subscriptions) {
          const invoices = await get(
            "stripe",
            `/v1/invoices?subscription=${id}&limit=5`,
            "cleanup_invoice_safety",
            "app",
            true,
          );
          check(invoices.has_more === false && Array.isArray(invoices.data));
          for (const i of invoices.data) {
            check(
              /^in_[A-Za-z0-9_]+$/.test(i.id) &&
                i.livemode === false &&
                i.customer === state.customer &&
                i.parent?.subscription_details?.subscription === id &&
                i.currency === "jpy" &&
                i.total === 980 &&
                Number.isInteger(i.attempt_count) &&
                i.attempt_count <= 1 &&
                i.attempt_count >= 0,
              "CLEANUP_INVOICE_MISMATCH",
            );
            invoiceIds.add(i.id);
            check(invoiceIds.size <= invoiceLimit, "INVOICE_LIMIT");
            check(
              ["paid", "void", "uncollectible"].includes(i.status) ||
                (["open", "draft"].includes(i.status) &&
                  i.auto_advance === false &&
                  i.next_payment_attempt === null),
              "INVOICE_COLLECTION_NOT_STOPPED",
            );
          }
          check(
            save(
              `invoice-safety-${String(++seq).padStart(4, "0")}.enc`,
              invoices,
            ).verified,
          );
        }
      });
      await step("deactivateStripePrice", async () => {
        if (!checked) return;
        const p = await get(
          "stripe",
          "/v1/prices/" + m.price,
          "cleanup_read_price",
          "lifecycle",
          true,
        );
        check(p.id === m.price && p.livemode === false);
        if (isMinimal) {
          check(sha(p) === sha(priceBefore), "CATALOG_CHANGED");
          check(save("stripe-price-after.enc", p).verified);
          return;
        }
        if (p.active)
          await change(
            "deactivateStripePrice",
            m.price,
            async () => {
              check(await humanPrice(false, true));
              const p = await get(
                "stripe",
                "/v1/prices/" + m.price,
                "cleanup_confirm_price",
                "lifecycle",
                true,
              );
              check(
                p.id === m.price && p.livemode === false && p.active === false,
              );
            },
            { cleanup: true },
          );
      });
      await step("deactivateDatabasePrice", async () => {
        if (!checked) return;
        const rows = await get(
          "supabase",
          `/rest/v1/price_versions?select=*&id=eq.${m.version}`,
          "cleanup_read_db_price",
          "service",
          true,
        );
        const row = exactRow(rows, m.version);
        check(row.stripe_price_id === m.price);
        if (row.active)
          await change(
            "deactivateDBPrice",
            m.version,
            async () => {
              const out = await db(
                "PATCH",
                `/rest/v1/price_versions?id=eq.${m.version}&active=eq.true`,
                { active: false },
                "cleanup_db_price",
                true,
              );
              check(exactRow(out, m.version).active === false);
            },
            { cleanup: true },
          );
      });
      await step("restoreDatabasePortal", async () => {
        if (!state.portal) return;
        const rows = await get(
          "supabase",
          "/rest/v1/service_settings?select=*&id=eq.true",
          "cleanup_read_settings",
          "service",
          true,
        );
        const row = exactRow(rows, true),
          old = baseline.service_settings[0].portal_configuration_id;
        check(
          row.portal_configuration_id === old ||
            row.portal_configuration_id === state.portal,
          "PORTAL_BINDING_CHANGED",
        );
        if (row.portal_configuration_id === state.portal)
          await change(
            "restorePortal",
            state.portal,
            async () => {
              const out = await db(
                "PATCH",
                "/rest/v1/service_settings?id=eq.true&portal_configuration_id=eq." +
                  state.portal,
                { portal_configuration_id: old },
                "cleanup_restore_portal",
                true,
              );
              check(exactRow(out, true).portal_configuration_id === old);
            },
            { cleanup: true },
          );
      });
      await step("disablePortalConfiguration", async () => {
        if (!state.portal) return;
        const p = await get(
          "stripe",
          "/v1/billing_portal/configurations/" + state.portal,
          "cleanup_read_portal",
          "lifecycle",
          true,
        );
        check(
          p.id === state.portal &&
            p.livemode === false &&
            p.metadata?.run === m.run,
        );
        if (resume) retainedPortal(p, m, p.active);
        if (p.active)
          await change(
            "disablePortal",
            state.portal,
            async () => {
              const out = await stripe(
                "POST",
                "/v1/billing_portal/configurations/" + state.portal,
                { active: false },
                "cleanup_disable_portal",
                "lifecycle",
                true,
              );
              if (resume) retainedPortal(out, m, false);
              check(
                out.id === state.portal &&
                  out.active === false &&
                  out.livemode === false,
              );
            },
            { cleanup: true },
          );
      });
      result.deactivatePrice = [
        result.deactivateStripePrice,
        result.deactivateDatabasePrice,
      ].every((x) => x === "verified")
        ? "verified"
        : "failed_or_unknown";
      result.restorePortalBinding = [
        result.restoreDatabasePortal,
        result.disablePortalConfiguration,
      ].every((x) => x === "verified")
        ? "verified"
        : "failed_or_unknown";
      result.unresolvedOperations = state.unknown.length;
      result.complete = Object.values(result).every(
        (v) => v === "verified" || v === 0,
      );
      state.cleanupResult = result;
      persist();
      return result;
    },
  };
  for (const name of [
    "inspect",
    "prepareAuthentication",
    "prepare",
    "bindCheckout",
    "compatibilityPortal",
    "inspectSubscription",
    "advanceClock",
    "paymentMethod",
    "endSubscription",
  ]) {
    const method = api[name];
    api[name] = async (...args) => {
      check(!state.stopped && !signal?.aborted, "STOPPED");
      try {
        return await method(...args);
      } catch (error) {
        state.stopped = true;
        persist();
        throw error;
      }
    };
  }
  return api;
}
