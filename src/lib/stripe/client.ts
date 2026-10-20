import "server-only";
import { localPaymentIntegration } from "./local-integration";
import Stripe from "stripe";
import { required } from "../config";
import { stripeMode } from "./mode";
export function stripe() {
  const key = required("STRIPE_SECRET_KEY");
  const mode = stripeMode();
  const prefix = mode === "live" ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/;
  if (!prefix.test(key)) throw new Error("Stripe key environment mismatch");
  const local = localPaymentIntegration();
  if (local && !key.startsWith("rk_test_"))
    throw new Error(
      "Local payment verification requires a restricted Sandbox key",
    );
  return new Stripe(key, {
    maxNetworkRetries: local ? 0 : 2,
    ...(local
      ? { timeout: 15000, httpClient: Stripe.createFetchHttpClient() }
      : {}),
  });
}
