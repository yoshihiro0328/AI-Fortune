import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
export function hash(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}
export function seal(value: unknown, secret: string, aad: string) {
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) throw new Error("Invalid encryption configuration");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((v) => v.toString("base64url"))
    .join(".");
}
export function unseal<T>(value: string, secret: string, aad: string): T {
  const [iv, tag, payload] = value
    .split(".")
    .map((v) => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(secret, "base64"),
    iv,
  );
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(payload), cipher.final()]).toString("utf8"),
  ) as T;
}
export function runtimeEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return (
    env.TRIAL_ENABLED === "true" &&
    env.TRIAL_ENVIRONMENT === "sandbox" &&
    env.STRIPE_MODE === "sandbox" &&
    env.VERCEL_ENV !== "production" &&
    env.TRIAL_RETENTION_VERIFIED === "true" &&
    env.TRIAL_BUDGET_VERIFIED === "true" &&
    /^proj_[A-Za-z0-9_-]+$/.test(env.TRIAL_OPENAI_PROJECT_ID ?? "")
  );
}
export function trustedIp(
  req: Request,
  env: Record<string, string | undefined> = process.env,
) {
  if (env.VERCEL === "1" && env.VERCEL_ENV === "preview") {
    const ip = req.headers.get("x-vercel-forwarded-for");
    if (!ip || ip.includes(",") || !/^[\da-f.:]+$/i.test(ip))
      throw new Error("Untrusted network identity");
    return ip;
  }
  const host = new URL(req.url).hostname;
  if (
    env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(host)
  )
    return "local-development";
  throw new Error("Unsupported network identity");
}
