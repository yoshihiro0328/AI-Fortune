import { check } from "./policy.mjs";
import { minimal } from "./minimal-profile.mjs";
import {
  paymentHistory,
  historicalSubscription,
  historicalInvoice,
  retainedUserRows,
} from "./history.mjs";

// A new bounded attempt using explicitly retained identities, never a replay of
// an interrupted mutation. Approval is supplied by the private, reviewed plan.
export function retainedResume(m, attemptId) {
  if (m.resume === undefined) return null;
  const r = m.resume;
  check(minimal(m) && r && typeof r === "object", "RESUME_SCOPE_REQUIRED");
  check(
    Object.keys(r)
      .filter((k) => !["profiles", "history"].includes(k))
      .sort()
      .join(",") === "approval,customer,portal,sourceAttemptId",
    "RESUME_FIELDS_INVALID",
  );
  paymentHistory(m);
  if (r.profiles !== undefined)
    check(
      Object.keys(r.profiles).sort().join(",") === "c,d" &&
        ["c", "d"].every(
          (label) =>
            Array.isArray(r.profiles[label]) &&
            r.profiles[label].length <= 1 &&
            r.profiles[label].every((p) => p.user_id === m[label].id),
        ),
      "RETAINED_PROFILE_MISMATCH",
    );
  check(
    /^[a-f0-9-]{36}$/.test(r.sourceAttemptId) &&
      r.sourceAttemptId !== attemptId &&
      /^cus_[A-Za-z0-9_]+$/.test(r.customer) &&
      /^bpc_[A-Za-z0-9_]+$/.test(r.portal),
    "RESUME_IDENTITY_REQUIRED",
  );
  check(
    r.approval?.resetDedicatedPasswords === true &&
      r.approval?.reactivateRetainedPortal === true &&
      typeof r.approval.reference === "string" &&
      r.approval.reference.length > 0,
    "RESUME_DIFFERENCE_APPROVAL_REQUIRED",
  );
  return r;
}

export function retainedPortal(p, m, active) {
  const f = p?.features;
  check(
    p?.id === m.resume.portal &&
      p.livemode === false &&
      p.active === active &&
      p.metadata?.run === m.run &&
      p.default_return_url === m.app + "/account" &&
      f?.invoice_history?.enabled === true &&
      [
        "subscription_update",
        "customer_update",
        "subscription_cancel",
        "payment_method_update",
      ].every((k) => f?.[k]?.enabled === false),
    "RETAINED_PORTAL_MISMATCH",
  );
}

export async function inspectRetained({ m, get, save, observed }) {
  const r = m.resume;
  const history = paymentHistory(m);
  const users = [];
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
    users.push(user.id);
    for (const table of [
      "diagnoses",
      "payments",
      "subscriptions",
      "subscription_invoices",
    ]) {
      const rows = await get(
        "supabase",
        `/rest/v1/${table}?select=*&user_id=eq.${user.id}`,
        "retained_user_empty",
      );
      check(
        retainedUserRows(m, table, user.id, rows),
        "RETAINED_USER_NOT_EMPTY",
      );
    }
    const bindings = await get(
      "supabase",
      `/rest/v1/billing_customers?select=*&user_id=eq.${user.id}`,
      "identify_retained_binding",
    );
    check(
      Array.isArray(bindings) &&
        (user.id === m.c.id
          ? bindings.length === 1 &&
            bindings[0].user_id === user.id &&
            bindings[0].stripe_customer_id === r.customer &&
            bindings[0].is_test === true &&
            bindings[0].checkout_session_id === (history?.checkout ?? null)
          : bindings.length === 0),
      "RETAINED_BINDING_MISMATCH",
    );
  }
  const customer = await get(
    "stripe",
    "/v1/customers/" + r.customer,
    "identify_retained_customer",
  );
  check(
    customer.id === r.customer &&
      !customer.deleted &&
      customer.livemode === false &&
      customer.test_clock === null &&
      customer.metadata?.run === m.run &&
      customer.metadata?.user_id === m.c.id,
    "RETAINED_CUSTOMER_MISMATCH",
  );
  for (const type of ["subscriptions", "invoices"]) {
    const list = await get(
      "stripe",
      `/v1/${type}?customer=${r.customer}&limit=100${type === "subscriptions" ? "&status=all" : ""}`,
      "retained_customer_empty",
      type === "invoices" ? "app" : "lifecycle",
    );
    check(
      list.has_more === false &&
        Array.isArray(list.data) &&
        (history
          ? list.data.length === 1 &&
            (type === "subscriptions"
              ? historicalSubscription(list.data[0], history)
              : historicalInvoice(list.data[0], history)) &&
            list.data[0].customer === r.customer
          : list.data.length === 0),
      "RETAINED_CUSTOMER_NOT_EMPTY",
    );
  }
  if (history) {
    const c = await get(
      "stripe",
      "/v1/checkout/sessions/" + history.checkout,
      "identify_retained_checkout",
      "app",
    );
    check(
      c.id === history.checkout &&
        c.customer === r.customer &&
        c.livemode === false &&
        c.status === "complete" &&
        c.payment_status === "paid" &&
        c.subscription === history.subscription &&
        c.amount_total === 980 &&
        c.currency === "jpy",
      "HISTORICAL_CHECKOUT_MISMATCH",
    );
  }
  const portal = await get(
    "stripe",
    "/v1/billing_portal/configurations/" + r.portal,
    "identify_retained_portal",
  );
  retainedPortal(portal, m, false);
  check(
    observed.service_settings[0].portal_configuration_id !== r.portal,
    "RETAINED_PORTAL_ALREADY_BOUND",
  );
  check(
    save("retained-before.enc", {
      sourceAttemptId: r.sourceAttemptId,
      users,
      customer,
      portal,
    }).verified,
  );
}
