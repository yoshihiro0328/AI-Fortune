// New offers only. Historical purchases and subscriptions keep their saved prices.
export const pricing = {
  report: 980,
  plus: 980,
  currency: "jpy",
  reportVersion: "report-2026-10-980",
  plusVersion: "plus-2026-10-980",
} as const;
export const yen = (amount: number) => amount.toLocaleString("ja-JP") + "円";
export const defaultLimits = { free: 3, plus: 30 } as const;
