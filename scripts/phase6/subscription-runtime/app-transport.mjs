import { TARGET, check } from "./policy.mjs";
import { requestCategory } from "./diagnostics.mjs";
// Called behind the existing request/body/identity policy. Only the parent owns secrets.
// A single Customer Portal permission is assigned to lifecycle, not added to the app key.
export function appTransport({ wire, operations, signal, login }) {
  return async (r) => {
    check(!operations.state().stopped && !signal?.aborted, "STOPPED");
    const u = new URL(r.url),
      headers = new Headers(r.headers);
    check(
      [TARGET.stripe, TARGET.supabase].includes(u.origin) &&
        !u.username &&
        !u.password &&
        !u.hash,
    );
    const isStripe = u.origin === TARGET.stripe;
    const bearer = headers.get("authorization")?.replace(/^Bearer /, "");
    const role = isStripe
      ? u.pathname.startsWith("/v1/billing_portal/")
        ? "lifecycle"
        : "app"
      : bearer && !["local-service", "local-anon"].includes(bearer)
        ? "user"
        : headers.get("apikey") === "local-service"
          ? "service"
          : "anon";
    try {
      const out = await wire({
        provider: isStripe ? "stripe" : "supabase",
        role,
        method: r.method,
        path: u.pathname + u.search,
        body: (login ? login.body(r) : r.body) || undefined,
        bearer,
        accept: headers.get("accept") || "application/json",
        signal,
        operation: requestCategory(r.url, r.method),
      });
      if (
        isStripe &&
        r.method === "POST" &&
        u.pathname === "/v1/checkout/sessions"
      )
        await operations.bindCheckout(out.id);
      return out === undefined
        ? { status: 204, text: "" }
        : { status: 200, text: JSON.stringify(out) };
    } catch {
      operations.runtimeFailed();
      throw Error("RUNTIME_TRANSPORT_STOP");
    }
  };
}
