// No arbitrary payloads, identifiers, URLs, error names, provider codes or messages.
export type SafeEvent =
  | "ai_stage_failed"
  | "request_failed"
  | "analytics_event_failed"
  | "paid_report_failed"
  | "webhook_processing_failed"
  | "subscription_reconciliation_failed"
  | "retry_report_failed"
  | "production_ai_stopped"
  | "production_ai_stop_unconfirmed";
export function safeOperationalLog(event: SafeEvent) {
  console.error(event);
}
