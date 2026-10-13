import "server-only";
import { checked, db } from "@/lib/supabase/admin";
import { required } from "@/lib/config";
import { stripe } from "./client";
import { stripeMode } from "./mode";
// No cache: a missing or changed DB binding must close the next operation.
export async function paymentEnvironment() {
  const mode = stripeMode();
  const setting = checked(
    await db().from("payment_environment").select("*").single(),
  );
  if (
    !setting ||
    setting.mode !== mode ||
    setting.stripe_account_id !== required("STRIPE_ACCOUNT_ID")
  )
    throw new Error("Payment database environment mismatch");
  return { ...setting, mode, isTest: mode === "sandbox" };
}
export async function stripeEnvironment() {
  const environment = await paymentEnvironment();
  const account = await stripe().accounts.retrieve(null);
  if (account.id !== environment.stripe_account_id)
    throw new Error("Stripe account mismatch");
  return environment;
}
