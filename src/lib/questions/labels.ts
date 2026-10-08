export type Phase =
  "common" | "relationship" | "concern" | "ai_followup" | "paid_followup";
export const phaseLabels: Record<Phase, string> = {
  common: "基本情報",
  relationship: "今の関係",
  concern: "気になっていること",
  ai_followup: "最終確認",
  paid_followup: "あと少しだけ",
};
