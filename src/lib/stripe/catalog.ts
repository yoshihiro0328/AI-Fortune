import "server-only";
import { checked, db } from "@/lib/supabase/admin";
import { stripe } from "./client";
import { pricing } from "@/lib/pricing";
import { stripeEnvironment } from "./environment";
import { assertStripeMode } from "./mode";
export async function offer(kind: "report" | "plus") {
  const environment = await stripeEnvironment();
  const row = checked(
    await db()
      .from("price_versions")
      .select("*")
      .eq("kind", kind)
      .eq("is_test", environment.isTest)
      .eq("active", true)
      .single(),
  );
  const price = await stripe().prices.retrieve(row.stripe_price_id);
  assertStripeMode(price, environment.mode);
  if (
    row.is_test !== environment.isTest ||
    price.product !== row.stripe_product_id ||
    !price.active ||
    price.currency !== "jpy" ||
    price.unit_amount !== row.amount ||
    row.amount !== pricing[kind] ||
    (kind === "plus"
      ? price.recurring?.interval !== "month" ||
        price.recurring.interval_count !== 1
      : price.type !== "one_time")
  )
    throw new Error("Invalid catalog price");
  return { row, price, environment };
}
