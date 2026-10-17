/** Preparation-only executable. Deliberately has NO hosted execution/credential path. */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { project, tables } from "./step10-fixtures.mjs";
export const externalFlags = [
  "RUN_CONSULTATION_LIVE",
  "RUN_FOLLOWUP_LIVE",
  "DYNAMIC_DIAGNOSTIC",
  "RUN_EDITORIAL_LIVE",
  "RUN_EDITORIAL_BACKFILL",
  "RUN_SUBSCRIPTION_LIVE",
];
export function preparation(args, env) {
  if (args.length !== 1 || args[0] !== "--plan")
    throw new Error(
      "Only --plan is supported; hosted writes are not authorized",
    );
  if (externalFlags.some((k) => env[k] && !["0", "false"].includes(env[k])))
    throw new Error("External test flag rejected");
  if (
    Object.keys(env).some(
      (k) =>
        /^(PG|DATABASE_URL|NEXT_PUBLIC_SUPABASE|SUPABASE_|STRIPE_|OPENAI_|NODE_OPTIONS|DOTENV_)/.test(
          k,
        ) && env[k],
    )
  )
    throw new Error("Credential or injected runtime environment rejected");
  return {
    mode: "plan-only",
    project,
    hostedExecution: false,
    networkCalls: 0,
    authUsersCreated: 0,
    profilesCreated: 0,
    plannedRows: Object.fromEntries(tables.map((t) => [t, 2])),
    total: 12,
    requiredApproval: [
      "fixture manifest UUIDs and two existing user UUIDs",
      "12 inserts and bounded claim/rate-limit updates",
      "separate UUID-only cleanup",
    ],
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(preparation(process.argv.slice(2), process.env), null, 2),
    );
  } catch {
    console.error(
      "STEP10 preparation refused: use a clean environment and --plan only. No network or write executed.",
    );
    process.exitCode = 1;
  }
}
