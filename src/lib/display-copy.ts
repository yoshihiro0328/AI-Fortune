// Public wording is separate from operator-provided values and billing logic.
export const testPaymentNotice = "現在はテスト決済のみで実請求は発生しません。";
export function sentence(value: string) {
  const text = value.trim();
  return /[。！？.!?]$/.test(text) ? text : text + "。";
}
export function responseTimeLabel(value: string) {
  return "お問い合わせへの回答目安：" + value.trim().replace(/[。.]$/, "");
}
