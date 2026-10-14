import type { Subscription, Usage } from "./model";

export function japanDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function subscriptionDisplay(sub: Subscription, plan: Usage["plan"]) {
  // A terminal status takes priority over historical cancellation flags.
  if (["canceled", "incomplete_expired"].includes(sub.status)) {
    return {
      status: sub.status === "canceled" ? "解約済み" : "手続き終了",
      dateLabel: "契約終了日",
      date: japanDate(sub.ended_at),
    };
  }
  const scheduled = sub.cancel_at_period_end || !!sub.cancel_at;
  const status = scheduled
    ? "解約予約済み"
    : ((
        {
          active: "契約中",
          trialing: "試用中",
          past_due: "支払いを確認中",
          incomplete: "手続き中",
          unpaid: "未払い",
          paused: "一時停止",
        } as Record<string, string>
      )[sub.status] ?? "確認中");
  return {
    status: plan === "free" ? `${status}（現在は無料プラン）` : status,
    dateLabel: scheduled ? "契約終了予定日" : "次回更新日",
    date: scheduled
      ? japanDate(sub.cancel_at ?? sub.period_end)
      : ["active", "trialing"].includes(sub.status)
        ? japanDate(sub.period_end)
        : null,
  };
}
