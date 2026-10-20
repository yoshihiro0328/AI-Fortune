// Only explicitly reviewed codes are persisted; messages/details/URLs never are.
const codes = new Set([
  "42703",
  "42501",
  "42P01",
  "57014",
  "PGRST100",
  "PGRST116",
  "PGRST204",
  "PGRST301",
  "api_key_expired",
  "api_key_invalid",
  "invalid_api_key",
  "permission_missing",
  "RESPONSE_SHAPE_INVALID",
  "HTTP_FAILED",
  "TRANSPORT_FAILED",
  "TIMEOUT",
  "ENVIRONMENT_MISMATCH",
  "PRICES_MISMATCH",
  "RETAINED_FIXTURE_MISMATCH",
  "PREEXISTING_PAYMENT_DATA",
  "POLICY_DENIED",
  "RUNTIME_STOPPING",
  "LISTENER_ACCOUNT_UNVERIFIED",
  "LISTENER_NOT_READY",
  "LISTENER_START_FAILED",
  "LISTENER_EARLY_EXIT",
  "START_TIMEOUT",
  "CHILD_START_FAILED",
  "CHILD_EARLY_EXIT",
  "INTERACTIVE_INPUT_REQUIRED",
  "CONTROL_INPUT_CLOSED",
  "RATE_BASELINE_CHANGED",
  "VERIFY_STAGE",
  "NO_DATABASE_INPUT",
  "BROWSER_OBSERVATION_MISSING",
  "ACCOUNT_UI_ERROR",
  "A_LIST_MISMATCH",
  "B_LIST_LEAK",
  "A_BROWSER_BODY_FAILED",
  "B_BROWSER_BODY_LEAK",
  "ANON_BROWSER_BODY_LEAK",
  "UNEXPECTED_RATE_CHANGE",
  "RATE_ROW_REMOVED",
]);
export function diagnostic(error) {
  const raw = error?.safeCode ?? error?.code ?? error?.message;
  return {
    httpStatus:
      Number.isInteger(error?.httpStatus) &&
      error.httpStatus >= 100 &&
      error.httpStatus <= 599
        ? error.httpStatus
        : null,
    errorCode: codes.has(raw) ? raw : "UNCLASSIFIED",
  };
}
export async function checkedJson(
  transport,
  request,
  { stage, operation, record },
) {
  let response;
  try {
    response = await transport(request);
    let data;
    try {
      data = JSON.parse(response.text);
    } catch {
      throw Object.assign(new Error("RESPONSE_SHAPE_INVALID"), {
        httpStatus: response.status,
      });
    }
    if (response.status < 200 || response.status >= 300) {
      const raw = data?.code ?? data?.error?.code;
      throw Object.assign(new Error("HTTP_FAILED"), {
        httpStatus: response.status,
        safeCode: codes.has(raw) ? raw : "HTTP_FAILED",
      });
    }
    record("operation_response", {
      stage,
      operation,
      httpStatus: response.status,
      errorCode: null,
    });
    return data;
  } catch (error) {
    const safe = diagnostic(error);
    if (!response && safe.errorCode === "UNCLASSIFIED")
      safe.errorCode =
        error?.name === "TimeoutError" || error?.name === "AbortError"
          ? "TIMEOUT"
          : "TRANSPORT_FAILED";
    record("operation_failed", { stage, operation, ...safe });
    throw Object.assign(new Error(safe.errorCode), {
      safeCode: safe.errorCode,
      httpStatus: safe.httpStatus,
    });
  }
}
