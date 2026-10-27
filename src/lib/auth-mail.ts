import { productionRuntime } from "@/lib/production/config";

/** App-side stop only. Supabase SMTP/provider controls are separate. */
export function authMailAllowed(
  action: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!["signup", "resend", "reset"].includes(action)) return true;
  if (env.AUTH_EMAIL_ENABLED === "false") return false;
  return !productionRuntime(env) || env.AUTH_EMAIL_ENABLED === "true";
}
