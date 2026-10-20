// CI tests use only explicit synthetic credentials, migrated PGlite and loopback.
// This is an accidental-fetch guard, not a replacement for the macOS OS sandbox.
import fs from "node:fs";
const credentialNames = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_API_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "OPENAI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "PGPASSWORD",
  "PGPASSFILE",
];
if (
  credentialNames.some((name) => process.env[name]) ||
  fs
    .readdirSync(process.cwd())
    .some((name) => name.startsWith(".env") && name !== ".env.example")
)
  throw Error("PAYMENT_CI_REQUIRES_CREDENTIAL_FREE_DIRECTORY");
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw Error("PAYMENT_CI_EXTERNAL_FETCH_DENIED");
  return original(input, { ...init, redirect: "error" });
};
