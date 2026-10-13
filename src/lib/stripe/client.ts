import "server-only";
import Stripe from "stripe";
import { required } from "../config";
import { stripeMode } from "./mode";
export function stripe() {
  const key = required("STRIPE_SECRET_KEY");
  const mode = stripeMode();
  const prefix = mode === "live" ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/;
  if (!prefix.test(key)) throw new Error("Stripe key environment mismatch");
  return new Stripe(key, { maxNetworkRetries: 2 });
}
