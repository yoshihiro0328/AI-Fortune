import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { TARGET, insist } from "../payment-runtime/policy.mjs";
import { isDeepStrictEqual } from "node:util";
export function authCookie(session) {
  return createChunks(
    "sb-" + TARGET.ref + "-auth-token",
    "base64-" + stringToBase64URL(JSON.stringify(session)),
  )
    .map((x) => x.name + "=" + x.value)
    .join("; ");
}
export async function verifyAccess(
  m,
  e,
  body,
  sessions,
  transport,
  record,
  request = fetch,
) {
  insist(sessions.size === 2, "BOTH_LOGINS_REQUIRED");
  const endpoint = TARGET.app + "/api/diagnoses/" + m.diagnosis + "/report";
  for (const label of ["A", "B", "anonymous"]) {
    const id = label === "A" ? m.a.id : m.b.id,
      cookie = label === "anonymous" ? "" : authCookie(sessions.get(id));
    const r = await request(endpoint, {
        headers: { cookie, host: "localhost:5208" },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      }),
      data = await r.json();
    if (label === "A")
      insist(
        r.status === 200 &&
          data.status === "ready" &&
          isDeepStrictEqual(data.report, body),
        "A_REPORT_FAILED",
      );
    else
      insist(
        [401, 403, 404].includes(r.status) && !data.report,
        "BODY_DISCLOSURE",
      );
    record("application_access", {
      user: label,
      httpStatus: r.status,
      bodyReturned: label === "A",
    });
  }
  for (const [label, id] of [
    ["A", m.a.id],
    ["B", m.b.id],
  ])
    for (const table of ["payments", "paid_reports"]) {
      const response = await transport({
        url:
          TARGET.supabase +
          "/rest/v1/" +
          table +
          "?diagnosis_id=eq." +
          m.diagnosis +
          "&select=id,diagnosis_id," +
          (table === "payments" ? "user_id,status" : "payment_id,status"),
        method: "GET",
        headers: {
          apikey: "local-anon",
          authorization: "Bearer " + sessions.get(id).access_token,
        },
        body: "",
      });
      insist(response.status === 200, "RLS_HTTP_FAILED");
      const rows = JSON.parse(response.text);
      insist(Array.isArray(rows));
      if (label === "B") insist(rows.length === 0, "RLS_LEAK");
      else {
        insist(rows.length === 1 && rows[0].diagnosis_id === m.diagnosis);
        if (table === "payments")
          insist(
            rows[0].id === e.payment &&
              rows[0].user_id === id &&
              rows[0].status === "paid",
          );
        else
          insist(
            rows[0].id === e.report &&
              rows[0].payment_id === e.payment &&
              rows[0].status === "ready",
          );
      }
      record("rls_access", {
        user: label,
        table,
        rows: rows.length,
        credential: "anon_plus_user_jwt",
      });
    }
}
