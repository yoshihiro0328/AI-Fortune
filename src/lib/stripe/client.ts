import "server-only";
import Stripe from "stripe";
import { required } from "../config";
export function stripe() {
  const key = required("STRIPE_SECRET_KEY");
  if (!/^(sk|rk)_test_/.test(key))
    throw new Error("Only Stripe sandbox keys are allowed");
  return new Stripe(key, { maxNetworkRetries: 2 });
}
