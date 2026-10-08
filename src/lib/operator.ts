const fields = {
  name: ["OPERATOR_NAME", "正式な運営者名"],
  representative: ["OPERATOR_REPRESENTATIVE", "運営責任者名"],
  address: ["OPERATOR_ADDRESS", "所在地"],
  phone: ["OPERATOR_PHONE", "電話番号"],
  email: ["OPERATOR_EMAIL", "問い合わせメールアドレス"],
  retention: ["DATA_RETENTION_POLICY", "データ別の保存期間と削除方針"],
  refundPolicy: ["REFUND_REQUEST_PERIOD", "返金・キャンセルの受付方針"],
  responseTime: ["SUPPORT_RESPONSE_TIME", "問い合わせ・返金の回答目安"],
} as const;

export function getOperatorConfig(env: Record<string, string | undefined>) {
  const missingKeys: string[] = [];
  const values = Object.fromEntries(
    Object.entries(fields).map(([field, [key, label]]) => {
      const value = env[key]?.trim();
      if (!value) missingKeys.push(key);
      return [field, value || `【未設定】${label}`];
    }),
  ) as Record<keyof typeof fields, string>;
  return { values, isComplete: missingKeys.length === 0, missingKeys };
}

const config = getOperatorConfig(process.env);
export const operator = config.values;
export const operatorInfoComplete = config.isComplete;
