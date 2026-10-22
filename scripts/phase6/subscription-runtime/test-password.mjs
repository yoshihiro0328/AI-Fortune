import { randomBytes } from "node:crypto";

// Preserve 256 random bits while guaranteeing every configured character class.
// This stays below bcrypt's 72-byte input ceiling. Never log the returned value.
export function testPassword() {
  return "Aa1!" + randomBytes(32).toString("base64url");
}

export function validTestPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 12 &&
    Buffer.byteLength(value) < 72 &&
    [/[a-z]/, /[A-Z]/, /[0-9]/, /[!@#$%^&*()]/].every((r) => r.test(value))
  );
}
