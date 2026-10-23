// One explicitly reconciled previous payment. These IDs never enter this
// attempt's creation/cancellation counters and cannot authorize Stripe writes.
export function paymentHistory(m) {
  const h = m.resume?.history;
  if (h === undefined) return null;
  const valid =
    m.scenario === "minimal-plus-v1" &&
    m.resume.approval?.recontractOnce === true &&
    Object.keys(h).sort().join(",") ===
      "checkout,endedAt,invoice,subscription" &&
    /^cs_test_[A-Za-z0-9_]+$/.test(h.checkout) &&
    /^sub_[A-Za-z0-9_]+$/.test(h.subscription) &&
    /^in_[A-Za-z0-9_]+$/.test(h.invoice) &&
    Number.isSafeInteger(h.endedAt) &&
    h.endedAt > 0;
  if (!valid) throw Error("HISTORY_APPROVAL_OR_ID_MISMATCH");
  return h;
}
export function historicalSubscription(s, h) {
  return (
    s?.id === h?.subscription &&
    s.status === "canceled" &&
    s.ended_at === h.endedAt &&
    s.livemode === false
  );
}
export function historicalInvoice(i, h) {
  return (
    i?.id === h?.invoice &&
    i.status === "paid" &&
    i.amount_paid === 980 &&
    i.amount_remaining === 0 &&
    i.currency === "jpy" &&
    i.livemode === false &&
    i.parent?.subscription_details?.subscription === h.subscription
  );
}
export function historicalRow(table, row, h, owner) {
  if (!h || row.user_id !== owner || row.is_test !== true) return false;
  if (table === "subscriptions")
    return (
      row.id === h.subscription &&
      row.status === "canceled" &&
      Date.parse(row.ended_at) === h.endedAt * 1000
    );
  return (
    table === "subscription_invoices" &&
    row.id === h.invoice &&
    row.subscription_id === h.subscription &&
    row.status === "paid" &&
    row.amount === 980 &&
    row.currency === "jpy"
  );
}

// A previous read may already have synchronized the explicitly retained paid,
// canceled history. This is not a new subscription and must not be deleted or
// counted as a new purchase. Every other retained user's row remains forbidden.
export function retainedUserRows(m, table, owner, rows) {
  if (!Array.isArray(rows)) return false;
  if (rows.length === 0) return true;
  const h = paymentHistory(m);
  return (
    owner === m.c.id &&
    rows.length === 1 &&
    historicalRow(table, rows[0], h, owner) &&
    (table !== "subscriptions" ||
      (rows[0].stripe_customer_id === m.customer &&
        rows[0].price_version === m.version &&
        rows[0].amount === 980))
  );
}

// An unpaid expired Checkout is separate from paid subscription history. It is
// retained only as a binding reference and never receives a write reservation.
export function expiredCheckout(m) {
  const e = m.resume?.expiredCheckout;
  if (e === undefined) return null;
  if (
    m.scenario !== "minimal-plus-v1" ||
    m.resume.approval?.replaceExpiredCheckoutOnce !== true ||
    m.resume.approval?.recontractOnce !== true ||
    Object.keys(e).sort().join(",") !== "id,sourceAttemptId" ||
    !/^cs_test_[A-Za-z0-9_]+$/.test(e.id) ||
    !/^[a-f0-9-]{36}$/.test(e.sourceAttemptId) ||
    e.id === paymentHistory(m)?.checkout
  )
    throw Error("EXPIRED_CHECKOUT_APPROVAL_OR_ID_MISMATCH");
  return e;
}
export function retainedCheckoutId(m) {
  return expiredCheckout(m)?.id ?? paymentHistory(m)?.checkout ?? null;
}
export function isRetainedExpiredCheckout(c, m) {
  return (
    c?.id === expiredCheckout(m)?.id &&
    c?.status === "expired" &&
    c.payment_status === "unpaid" &&
    c.subscription === null &&
    c.invoice === null &&
    c.livemode === false &&
    c.customer === m.customer &&
    c.mode === "subscription" &&
    c.amount_total === 980 &&
    c.currency === "jpy" &&
    c.metadata?.user_id === m.c.id
  );
}
