// Display-only approved policy preview; does not enable retention jobs or publication.
export function privacyPresentation(env: Record<string, string | undefined>) {
  const local =
    env.NODE_ENV === "development" && env.LOCAL_REVIEW_ISOLATED === "true";
  return {
    local,
    retention:
      env.DATA_RETENTION_POLICY?.trim() ||
      (local
        ? "採用済みの保存方針：相談・診断・有料結果は最終利用から1年、未完了診断は30日、問い合わせ記録は対応完了から1年、本文を含まない運用ログは30日。削除依頼を優先し、購入済み・紛争中の案件は解決を優先します。"
        : "保存期間と削除の運用は公開準備中です。確定した期間は公開前にこのページでご案内します。"),
    responseTime:
      env.SUPPORT_RESPONSE_TIME?.trim() ||
      (local
        ? "平日10:00〜18:00（日本時間）。初回回答は原則2営業日以内。"
        : "受付時間・回答目安は公開準備中です。"),
  };
}
