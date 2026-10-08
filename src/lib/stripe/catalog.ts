import "server-only";
import { checked, db } from "@/lib/supabase/admin";
import { stripe } from "./client";
import { pricing } from "@/lib/pricing";
export async function offer(kind: "report" | "plus") {
  const row = checked(
    await db()
      .from("price_versions")
      .select("*")
      .eq("kind", kind)
      .eq("active", true)
      .single(),
  );
  const price = await stripe().prices.retrieve(row.stripe_price_id);
  if (
    !row.is_test ||
    price.livemode ||
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
  return { row, price };
}
