// Display only. Never grants permission to charge or enables sales.
export type PaymentDisplayMode = "live" | "test" | "synthetic" | "unavailable";
export function paymentDisplayMode(
  env: Record<string, string | undefined>,
): PaymentDisplayMode {
  if (env.VERCEL_ENV === "production" || env.APP_RUNTIME === "production")
    return env.STRIPE_MODE === "live" ? "live" : "unavailable";
  if (env.LOCAL_REVIEW_ISOLATED === "true") return "synthetic";
  if (
    env.STRIPE_MODE === "sandbox" ||
    env.PAYMENT_INTEGRATION_LOCAL === "true" ||
    env.SUBSCRIPTION_INTEGRATION_LOCAL === "true"
  )
    return "test";
  return "unavailable";
}
export function paymentDisplay(mode: PaymentDisplayMode) {
  return {
    notice:
      mode === "synthetic"
        ? "合成データでの画面確認です。購入・契約変更は実行できません。"
        : mode === "test"
          ? "現在はテスト決済のみで実請求は発生しません。"
          : mode === "live"
            ? "お申し込みを確定すると表示料金が請求されます。料金・自動更新・解約条件をご確認ください。"
            : "決済の提供状況を確認中です。お申し込みはまだ完了していません。",
    checkoutLabel:
      mode === "test" ? "Plusのテスト契約へ" : "Plusのお申し込みへ",
  };
}
