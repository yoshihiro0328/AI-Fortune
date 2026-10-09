import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
export function sessionHash(token: string, secret: string) {
  return createHmac("sha256", secret).update(token).digest("hex");
}
export function newSession() {
  return randomBytes(32).toString("base64url");
}
export function owns(
  d: { user_id: string | null; anonymous_session_id: string },
  session: string | null,
  userId: string | null,
) {
  return !!(
    (userId && d.user_id === userId) ||
    (!d.user_id && session && d.anonymous_session_id === session)
  );
}
export function sameOrigin(origin: string | null, expected: string) {
  return origin !== null && origin === new URL(expected).origin;
}
export function secureEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
