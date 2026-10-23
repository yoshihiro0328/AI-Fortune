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
