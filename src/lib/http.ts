import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { db, checked } from "./supabase/admin";
import { required, appUrl } from "./config";
import { sessionHash, newSession, owns, sameOrigin } from "./security";
import { z } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function identity(create = false) {
  const jar = await cookies();
  let token = jar.get("yorisoi_session")?.value;
  if (!token && create) {
    token = newSession();
    jar.set("yorisoi_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
  }
  let userId: string | null = null;
  if (jar.getAll().some((c) => c.name.startsWith("sb-"))) {
    const auth = await authClient();
    const { data } = await auth.auth.getUser();
    userId = data.user?.email_confirmed_at ? data.user.id : null;
  }
  return {
    session: token ? sessionHash(token, required("SESSION_SECRET")) : null,
    userId,
  };
}
export async function authClient() {
  const jar = await cookies();
  return createServerClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (cs) =>
          cs.forEach(({ name, value, options }) =>
            jar.set(name, value, {
              ...options,
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "lax",
            }),
          ),
      },
    },
  );
}
export function csrf(req: Request) {
  if (!sameOrigin(req.headers.get("origin"), appUrl()))
    throw new HttpError(403, "このリクエストは許可されていません。");
}
export async function body<T>(req: Request, schema: z.ZodType<T>) {
  const text = await boundedText(req, 30000);
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new HttpError(400, "入力内容をご確認ください。");
  }
}
export async function owned(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new HttpError(404, "診断が見つかりません。");
  const who = await identity();
  if (!who.session && !who.userId)
    throw new HttpError(401, "このブラウザの診断セッションが見つかりません。");
  const d = checked(
    await db().from("diagnoses").select("*").eq("id", id).maybeSingle(),
  );
  if (!d || !owns(d, who.session, who.userId))
    throw new HttpError(404, "診断が見つかりません。");
  return d;
}
export async function rate(key: string, limit: number, seconds: number) {
  if (
    !checked(
      await db().rpc("consume_limit", {
        p_key: key,
        p_limit: limit,
        p_seconds: seconds,
      }),
    )
  )
    throw new HttpError(429, "時間をおいて、もう一度お試しください。");
}
export async function event(
  name: string,
  diagnosisId?: string,
  metadata: Record<string, string> = {},
) {
  try {
    const who = await identity();
    checked(
      await db()
        .from("analytics_events")
        .insert({
          event_name: name,
          anonymous_session_id: who.session,
          user_id: who.userId,
          metadata: {
            ...metadata,
            ...(diagnosisId ? { diagnosis_id: diagnosisId } : {}),
          },
          is_test: true,
        }),
    );
  } catch {
    console.error("analytics_event_failed", { event_name: name });
  }
}
export async function api(fn: () => Promise<unknown>) {
  try {
    return Response.json(await fn(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    if (e instanceof HttpError)
      return Response.json(
        { error: e.message },
        { status: e.status, headers: { "Cache-Control": "private, no-store" } },
      );
    console.error("request_failed", {
      type: e instanceof Error ? e.name : "unknown",
    });
    return Response.json(
      {
        error:
          "ただいま処理を完了できませんでした。時間をおいて再度お試しください。",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export async function rateIP(
  req: Request,
  namespace: string,
  limit: number,
  seconds: number,
) {
  const ip = process.env.VERCEL
    ? (req.headers.get("x-vercel-forwarded-for") ?? "unknown")
    : "local";
  await rate(
    namespace + ":ip:" + sessionHash(ip, required("SESSION_SECRET")),
    limit,
    seconds,
  );
}

export async function boundedText(req: Request, maxBytes: number) {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "入力が長すぎます。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
