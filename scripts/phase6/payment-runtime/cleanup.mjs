import { TARGET, insist, hash } from "./policy.mjs";
// Maintenance channel, never reachable through the app broker. No generic DB write helper.
export async function deactivatePrice(request) {
  const env = await request(
    "GET",
    "payment_environment?select=mode,stripe_account_id",
  );
  insist(
    env.length === 1 &&
      env[0].mode === "sandbox" &&
      env[0].stripe_account_id === TARGET.account,
  );
  const before = await request("GET", "price_versions?select=*");
  insist(
    before.length === 6 &&
      before.filter((p) => p.id === TARGET.version).length === 1,
  );
  const p = before.find((p) => p.id === TARGET.version);
  insist(
    p.is_test === true &&
      p.amount === 980 &&
      p.kind === "report" &&
      p.stripe_price_id === TARGET.price &&
      p.stripe_product_id === TARGET.product,
  );
  insist(before.filter((x) => x.id !== p.id).every((x) => x.active === false));
  if (p.active) {
    const rows = await request(
      "PATCH",
      `price_versions?id=eq.${TARGET.version}&active=eq.true&is_test=eq.true&stripe_price_id=eq.${TARGET.price}&stripe_product_id=eq.${TARGET.product}`,
      { active: false },
    );
    insist(
      rows.length === 1 && rows[0].id === p.id && rows[0].active === false,
    );
  }
  const after = await request("GET", "price_versions?select=*");
  insist(after.length === 6 && after.every((x) => x.active === false));
  const canonical = (rows) =>
    JSON.stringify(
      rows
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((x) => Object.fromEntries(Object.entries(x).sort())),
    );
  insist(
    canonical(before.filter((x) => x.id !== p.id)) ===
      canonical(after.filter((x) => x.id !== p.id)),
  );
  const expected = { ...p, active: false };
  const actual = after.find((x) => x.id === p.id);
  // The schema has no modified timestamp on price_versions. All other fields must stay equal.
  insist(canonical([expected]) === canonical([actual]));
  return { state: "verified_inactive" };
}
export async function verifyRevoked(key, accountRequest) {
  const result = await accountRequest(key);
  return {
    fingerprint: hash(key),
    state:
      result.status === 401 &&
      ["api_key_expired", "api_key_invalid", "invalid_api_key"].includes(
        result.code,
      )
        ? "verified_revoked"
        : "unconfirmed",
  };
}
export async function finish({
  stopProcesses,
  deactivate,
  eraseTemporary,
  keys,
  reason,
}) {
  const result = {
    reason,
    processes: "unconfirmed",
    price: "unconfirmed",
    temporary: "unconfirmed",
    keys: keys.map((k) => ({
      fingerprint: hash(k),
      state: "manual_revocation_pending",
    })),
  };
  for (const [name, fn, success] of [
    ["processes", stopProcesses, "stopped"],
    ["price", deactivate, "verified_inactive"],
    ["temporary", eraseTemporary, "deleted"],
  ]) {
    try {
      await fn();
      result[name] = success;
    } catch {
      result[name] = "failed_or_unknown";
    }
  }
  result.complete =
    result.processes === "stopped" &&
    result.price === "verified_inactive" &&
    result.temporary === "deleted" &&
    result.keys.every((k) => k.state === "verified_revoked");
  // Keys need Dashboard expiry + a separate read-only check; local cleanup alone is never "complete".
  return result;
}
