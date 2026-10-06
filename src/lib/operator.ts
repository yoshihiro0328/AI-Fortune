export const operator = {
  name: process.env.OPERATOR_NAME || "【未設定】正式な運営者名",
  representative:
    process.env.OPERATOR_REPRESENTATIVE || "【未設定】運営責任者名",
  address: process.env.OPERATOR_ADDRESS || "【未設定】所在地",
  phone: process.env.OPERATOR_PHONE || "【未設定】電話番号",
  email: process.env.OPERATOR_EMAIL || "【未設定】問い合わせメールアドレス",
  retention:
    process.env.DATA_RETENTION_POLICY ||
    "【未設定】データ別の保存期間と削除方針。本番公開前に確定します。",
  refundDeadline:
    process.env.REFUND_REQUEST_PERIOD || "【未設定】返金の申請期限",
  responseTime:
    process.env.SUPPORT_RESPONSE_TIME || "【未設定】問い合わせ・返金の対応期限",
};
