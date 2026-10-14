import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db, checked } from "@/lib/supabase/admin";
import { authClient, boundedText, csrf, HttpError } from "@/lib/http";
import { required, appUrl } from "@/lib/config";
import { hash, seal, unseal, runtimeEnabled, trustedIp } from "./security";
import {
  answerSchema,
  consentVersion,
  intakeSchema,
  topics,
  type Intake,
} from "./topics";
import { structured, GenerationFailure } from "@/lib/ai-engine/structured";
import { trialAvailability } from "./availability";
import { localSafety, trialPrompt, safetyFallback } from "./prompt";
const cookie = "yorisoi_trial";
export class TrialError extends HttpError {
  constructor(
    public code: string,
    status: number,
    message: string,
  ) {
    super(status, message);
  }
}
const errors: Record<string, [number, string]> = {
  paused: [503, "登録なし相談は現在準備中です。無料診断をご利用いただけます。"],
  expired: [410, "お試しの保存期限が終了しました。"],
  quota: [
    429,
    "今回のお試し枠を利用済みです。登録後の無料相談は別枠で利用できます。",
  ],
  rate: [429, "利用が集中しています。時間をおいてお試しください。"],
  busy: [409, "回答を準備しています。少し待ってから確認してください。"],
  budget: [503, "本日のお試し受付は終了しました。無料診断をご利用ください。"],
  pricing: [503, "回答の準備が整っていません。時間をおいてお試しください。"],
  provider: [
    503,
    "回答を完了できませんでした。入力は残っています。再送できます。",
  ],
  conflict: [409, "送信内容が変更されています。入力を確認してください。"],
  ownership: [403, "この相談を引き継げません。"],
  auth: [401, "メール認証を完了したアカウントでログインしてください。"],
  challenge: [403, "確認をやり直してから送信してください。"],
  claimed: [409, "このお試しは引き継ぎ済み、または削除済みです。"],
  invalid: [422, "入力内容をご確認ください。"],
};
export function fail(code: string): never {
  const [status, message] = errors[code] ?? errors.provider;
  throw new TrialError(code, status, message);
}
export async function trialApi(fn: () => Promise<unknown>) {
  try {
    return Response.json(await fn(), {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  } catch (e) {
    const known = e instanceof HttpError;
    return Response.json(
      {
        code: e instanceof TrialError ? e.code : "unavailable",
        error: known ? e.message : errors.provider[1],
        safetyHelp: safetyFallback,
      },
      {
        status: known ? e.status : 503,
        headers: {
          "Cache-Control": "private, no-store",
          ...(known && e.status === 429 ? { "Retry-After": "3600" } : {}),
        },
      },
    );
  }
}
export async function rpc<T>(name: string, args: Record<string, unknown> = {}) {
  const data = checked(await db().rpc(name, args)) as T & { error?: string };
  if (data?.error) fail(data.error);
  return data;
}
export type Policy = {
  enabled: boolean;
  model: string;
  retention_seconds: number;
  text_limit: number;
  input_limit: number;
  output_limit: number;
  success_limit: number;
};
export async function policy() {
  return rpc<Policy>("trial_policy");
}
export function enabled() {
  if (!runtimeEnabled()) fail("paused");
}
export async function parse<T>(req: Request, schema: z.ZodType<T>) {
  const raw = await boundedText(req, 12000);
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    fail("invalid");
  }
}
export async function token(requiredToken = true) {
  const value = (await cookies()).get(cookie)?.value;
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    if (requiredToken) fail("expired");
    return null;
  }
  return hash(value, required("TRIAL_SESSION_SECRET"));
}
type StoredTurn = {
  id: string;
  request_id: string;
  topic: string;
  payload: string | null;
  answer: string | null;
  safety: boolean;
  status: string;
};
type Stored = {
  expiresAt: string;
  remaining: number;
  claimed?: boolean;
  deleted?: boolean;
  turn?: StoredTurn | null;
};
const decryptInput = (t: StoredTurn, h: string) =>
  unseal<Intake>(
    t.payload!,
    required("TRIAL_ENCRYPTION_KEY"),
    `${h}:${t.request_id}:input`,
  );
const decryptAnswer = (t: StoredTurn, h: string) =>
  unseal<string>(
    t.answer!,
    required("TRIAL_ENCRYPTION_KEY"),
    `${h}:${t.request_id}:answer`,
  );
export async function readSession() {
  const availability = await trialAvailability();
  const h = await token(false);
  if (!h)
    return {
      active: false,
      ...availability,
      siteKey: process.env.NEXT_PUBLIC_TRIAL_TURNSTILE_SITE_KEY ?? null,
    };
  let stored: Stored;
  try {
    stored = await rpc<Stored>("trial_read", { p_hash: h });
  } catch (e) {
    if (e instanceof TrialError && e.code === "expired")
      return {
        active: false,
        ...availability,
        expired: true,
      };
    throw e;
  }
  const cfg = await policy();
  return {
    active: true,
    enabled: availability.enabled,
    maxLength: cfg.text_limit,
    retentionHours: cfg.retention_seconds / 3600,
    ...stored,
    turn: stored.turn
      ? {
          id: stored.turn.id,
          status: stored.turn.status,
          safety: stored.turn.safety,
          ...(stored.turn.payload
            ? { input: decryptInput(stored.turn, h) }
            : {}),
          ...(stored.turn.answer
            ? { answer: decryptAnswer(stored.turn, h) }
            : {}),
        }
      : null,
  };
}
export async function createSession(req: Request) {
  csrf(req);
  enabled();
  const input = await parse(
    req,
    z
      .object({
        consentVersion: z.literal(consentVersion),
        challengeToken: z.string().min(1).max(2048),
      })
      .strict(),
  );
  const existing = await token(false);
  if (existing) {
    try {
      const current = await readSession();
      if (current.active) return current;
    } catch (e) {
      if (!(e instanceof TrialError) || e.code !== "expired") throw e;
    }
  }
  const ip = trustedIp(req);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: required("TRIAL_TURNSTILE_SECRET"),
        response: input.challengeToken,
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) fail("challenge");
  const verified = (await response.json()) as {
    success?: boolean;
    hostname?: string;
    action?: string;
    challenge_ts?: string;
  };
  const age = Date.now() - Date.parse(verified.challenge_ts ?? "");
  if (
    !verified.success ||
    verified.hostname !== new URL(appUrl()).hostname ||
    verified.action !== "trial_session" ||
    !Number.isFinite(age) ||
    age < -30000 ||
    age > 300000
  )
    fail("challenge");
  const raw = randomBytes(32).toString("base64url"),
    h = hash(raw, required("TRIAL_SESSION_SECRET"));
  const cfg = await policy();
  const result = await rpc<{ expiresAt: string }>("trial_create", {
    p_hash: h,
    p_ip: hash(ip, required("TRIAL_ABUSE_SECRET")),
    p_challenge: hash(input.challengeToken, required("TRIAL_ABUSE_SECRET")),
    p_consent: consentVersion,
  });
  (await cookies()).set(cookie, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: cfg.retention_seconds,
  });
  return {
    active: true,
    enabled: true,
    maxLength: cfg.text_limit,
    remaining: cfg.success_limit,
    ...result,
  };
}
type Reservation = {
  cached?: boolean;
  turn?: StoredTurn;
  call: {
    id: string;
    model: string;
    input_limit: number;
    output_limit: number;
  };
  lease: string;
};
export async function sendTurn(req: Request) {
  csrf(req);
  enabled();
  const h = (await token())!;
  const cfg = await policy();
  const input = await parse(req, intakeSchema(cfg.text_limit));
  const plaintext = JSON.stringify({
    topicId: input.topicId,
    topicVersion: input.topicVersion,
    text: input.text,
    fields: Object.fromEntries(Object.entries(input.fields).sort()),
  });
  const key = required("TRIAL_ENCRYPTION_KEY");
  const r = await rpc<Reservation>("trial_reserve", {
    p_hash: h,
    p_request: input.requestId,
    p_body_hash: hash(plaintext, required("TRIAL_SESSION_SECRET")),
    p_topic: input.topicId,
    p_payload: seal(input, key, `${h}:${input.requestId}:input`),
  });
  if (r.cached) return readSession();
  let answer: string | null = null,
    safety = false,
    usage: { input: number; output: number; providerId: string } | undefined,
    notSent = false,
    anomaly = false;
  try {
    const safe = localSafety(
      [input.text, ...Object.values(input.fields)].join("\n"),
    );
    if (safe) {
      answer = safe.answer;
      safety = true;
      usage = { input: 0, output: 0, providerId: "local-safety" };
    } else {
      const result = await structured({
        apiKey: required("TRIAL_OPENAI_API_KEY"),
        projectId: required("TRIAL_OPENAI_PROJECT_ID"),
        model: r.call.model,
        prompt: trialPrompt(input),
        input,
        schema: answerSchema,
        inputLimit: r.call.input_limit,
        outputLimit: r.call.output_limit,
      });
      answer = result.value.safety ? safetyFallback : result.value.answer;
      safety = result.value.safety;
      usage = result.usage;
    }
  } catch (e) {
    if (e instanceof GenerationFailure) {
      usage = e.usage;
      notSent = e.notSent;
      anomaly = e.anomaly;
    }
  }
  if (anomaly) await rpc("trial_pause");
  await rpc("trial_finish", {
    p_call: r.call.id,
    p_lease: r.lease,
    p_answer: answer
      ? seal(answer, key, `${h}:${input.requestId}:answer`)
      : null,
    p_safety: safety,
    p_input: usage?.input ?? null,
    p_output: usage?.output ?? null,
    p_provider: usage?.providerId ?? null,
    p_not_sent: notSent,
  });
  return readSession();
}
export async function claimSession(req: Request) {
  csrf(req);
  const approval = await parse(
    req,
    z.object({ consent: z.literal(true), expectedEmail: z.email() }).strict(),
  );
  const auth = await authClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (error || !user?.email_confirmed_at) fail("auth");
  if (user.email?.toLowerCase() !== approval.expectedEmail.toLowerCase())
    fail("ownership");
  const h = (await token())!,
    stored = await rpc<Stored>("trial_read", { p_hash: h });
  const t = stored.turn;
  // Replay still goes through the transactional ownership check, including after content was erased.
  if (stored.claimed)
    return rpc("trial_claim", {
      p_hash: h,
      p_user: user.id,
      p_turn: null,
      p_text: null,
      p_answer: null,
      p_topic: null,
      p_fields: {},
    });
  if (!t?.payload || !t.answer || t.status !== "ready") fail("conflict");
  const input = decryptInput(t, h),
    answer = decryptAnswer(t, h);
  const notes = topics[input.topicId].fields
    .filter((f) => input.fields[f.key])
    .map((f) => `${f.label}：${input.fields[f.key]}`)
    .join("\n");
  return rpc("trial_claim", {
    p_hash: h,
    p_user: user.id,
    p_turn: t.id,
    p_text: [input.text, notes].filter(Boolean).join("\n\n"),
    p_answer: answer,
    p_topic: input.topicId,
    p_fields: input.fields,
  });
}
export async function deleteContent(req: Request) {
  csrf(req);
  return rpc("trial_delete_content", { p_hash: await token() });
}
