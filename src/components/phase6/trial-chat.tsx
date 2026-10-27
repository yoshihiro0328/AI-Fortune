"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import TrialRetention from "./trial-retention";
import {
  ArrowLeft,
  ArrowUp,
  ChatCircleDots,
  ClockCounterClockwise,
  Copy,
  CheckCircle,
} from "@phosphor-icons/react";
import {
  topics,
  topicIds,
  consentVersion,
  type TopicId,
  type Intake,
} from "@/lib/trial/topics";
type Session = {
  active: boolean;
  enabled: boolean;
  maxLength: number;
  remaining?: number;
  expiresAt?: string;
  claimed?: boolean;
  deleted?: boolean;
  siteKey?: string;
  turn?: { status: string; input?: Intake; answer?: string; safety?: boolean };
};
type Turnstile = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
async function request<T>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers:
      method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: "no-store",
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "処理を完了できませんでした。");
  return result;
}
export default function TrialChat({
  initialTopic,
  siteKey,
}: {
  initialTopic: TopicId;
  siteKey: string | null;
}) {
  const router = useRouter();
  const [memberEmail, setMemberEmail] = useState<string | null>(null);
  const [topic, setTopic] = useState(initialTopic),
    [text, setText] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({}),
    [session, setSession] = useState<Session | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [challenge, setChallenge] = useState(""),
    [scriptReady, setScriptReady] = useState(false),
    [claimConsent, setClaimConsent] = useState(false),
    [notice, setNotice] = useState("");
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null),
    challengeElement = useRef<HTMLDivElement>(null),
    widget = useRef<string | null>(null),
    chatRoot = useRef<HTMLElement>(null);
  const config = topics[topic],
    answer = session?.turn?.answer,
    used =
      session?.remaining === 0 ||
      !!answer ||
      session?.claimed ||
      session?.deleted;
  const refresh = useCallback(async () => {
    const data = await request<Session>("/api/trial/session");
    setSession(data);
    if (data.turn?.input) {
      setTopic(data.turn.input.topicId);
      setFields(data.turn.input.fields);
      setText(data.turn.input.text);
    }
    return data;
  }, []);
  useEffect(() => {
    let alive = true;
    void request<Session>("/api/trial/session")
      .then((data) => {
        if (!alive) return;
        setSession(data);
        if (data.turn?.input) {
          setTopic(data.turn.input.topicId);
          setFields(data.turn.input.fields);
          setText(data.turn.input.text);
        }
      })
      .catch(() => {
        if (alive) {
          setSession({ active: false, enabled: false, maxLength: 800 });
          setError(
            "お試しの状態を確認できません。時間をおいてページを開き直してください。",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [initialTopic]);
  useEffect(() => {
    if (!session?.expiresAt) return;
    const timeout = setTimeout(
      () => {
        setSession(null);
        setText("");
        setFields({});
        setNotice("お試しの閲覧・引き継ぎ期限が終了しました。");
        void refresh().catch(() => {});
      },
      Math.max(0, Date.parse(session.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [session?.expiresAt, refresh]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () =>
      chatRoot.current?.style.setProperty(
        "--trial-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    resize();
    viewport?.addEventListener("resize", resize);
    return () => viewport?.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (
      !scriptReady ||
      !siteKey ||
      !session?.enabled ||
      session.active ||
      !challengeElement.current ||
      !window.turnstile
    )
      return;
    widget.current = window.turnstile.render(challengeElement.current, {
      sitekey: siteKey,
      action: "trial_session",
      callback: (v: string) => setChallenge(v),
      "expired-callback": () => setChallenge(""),
      "error-callback": () => setChallenge(""),
    });
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [scriptReady, siteKey, session?.active, session?.enabled]);
  async function send() {
    if (busy || !text.trim() || !consent || used || !session?.enabled) return;
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify({ topic, text, fields });
    if (requestRef.current?.fingerprint !== fingerprint)
      requestRef.current = { fingerprint, id: crypto.randomUUID() };
    try {
      if (!session.active) {
        const s = await request<Session>("/api/trial/session", "POST", {
          consentVersion,
          challengeToken: challenge,
        });
        setSession(s);
      }
      const s = await request<Session>("/api/trial/turns", "POST", {
        requestId: requestRef.current.id,
        topicId: topic,
        topicVersion: 1,
        text,
        fields,
      });
      setSession(s);
      setNotice("回答が届きました。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信できませんでした。");
      if (widget.current) {
        window.turnstile?.reset(widget.current);
        setChallenge("");
      }
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!answer) return;
    let alive = true;
    void request<{ user: { email: string; confirmed: boolean } | null }>(
      "/api/auth",
    )
      .then((r) => {
        if (alive) setMemberEmail(r.user?.confirmed ? r.user.email : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [answer]);
  async function claim() {
    setBusy(true);
    setError("");
    try {
      const r = await request<{ threadId: string }>(
        "/api/trial/claim",
        "POST",
        { consent: claimConsent, expectedEmail: memberEmail },
      );
      router.push("/consult?thread=" + encodeURIComponent(r.threadId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function erase() {
    setBusy(true);
    setError("");
    try {
      await request("/api/trial/session/content", "DELETE");
      setText("");
      setFields({});

      await refresh();
      setNotice(
        "サービス上の本文と回答を削除しました。バックアップ等の即時削除は保証しません。利用枠は戻りません。",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="p6-chat" ref={chatRoot}>
      {siteKey && session?.enabled && !session.active && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          onReady={() => setScriptReady(true)}
        />
      )}
      <div className="p6-chat-heading">
        <Link href="/" aria-label="ホームに戻る">
          <ArrowLeft size={24} />
        </Link>
        <div>
          <h1>すぐ相談</h1>
          <span className="p6-small">相手はあとで整理できます</span>
        </div>
        <Link href="/consult">
          <ClockCounterClockwise size={21} />
          相談・履歴
        </Link>
      </div>
      <div className="p6-chat-meta">
        <span>
          {session?.enabled
            ? "登録なし・1回答無料"
            : session
              ? "登録なし相談は準備中"
              : "受付状況を確認中"}
        </span>
        <span>AIによる相談サポート</span>
      </div>
      {session && !session.enabled && !answer && (
        <div className="p6-service-note">
          <p>
            登録なし相談は現在準備中です。入力内容をAIへ送信することはありません。
          </p>
          <Link href="/diagnosis/partner-mind">じっくり無料診断する</Link>
        </div>
      )}
      <div className="p6-conversation" tabIndex={0} aria-label="相談内容">
        {!answer && !session?.claimed && (
          <section className="p6-chat-welcome">
            <ChatCircleDots size={40} aria-hidden />
            <h2>{config.title}</h2>
            <p>{config.guide}</p>
            <p className="p6-policy">{config.policy}</p>
            <label className="p6-small">
              相談のテーマ
              <select
                value={topic}
                disabled={busy || !!used}
                onChange={(e) => {
                  setTopic(e.target.value as TopicId);
                  setFields({});
                }}
              >
                {topicIds.map((t) => (
                  <option key={t} value={t}>
                    {topics[t].name}
                  </option>
                ))}
              </select>
            </label>
            {config.fields.length > 0 && (
              <details className="p6-topic-fields" open>
                <summary>
                  もう少し教える <small>任意・分かる範囲で大丈夫です</small>
                </summary>
                {config.fields.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    {f.options ? (
                      <select
                        disabled={busy || !!used}
                        value={fields[f.key] ?? ""}
                        onChange={(e) =>
                          setFields({ ...fields, [f.key]: e.target.value })
                        }
                      >
                        <option value="">選ばなくても大丈夫です</option>
                        {f.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        disabled={busy || !!used}
                        maxLength={160}
                        value={fields[f.key] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) =>
                          setFields({ ...fields, [f.key]: e.target.value })
                        }
                      />
                    )}
                  </label>
                ))}
              </details>
            )}
          </section>
        )}
        {answer && (
          <>
            <div className="p6-message p6-user-message">
              <span className="p6-small">あなた</span>
              <p>{session?.turn?.input?.text}</p>
            </div>
            <div className="p6-message">
              <span className="p6-small">よりそい</span>
              <p>{answer}</p>
              <button
                className="p6-text-button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(answer)
                    .then(() => setNotice("回答をコピーしました。"))
                    .catch(() =>
                      setNotice(
                        "コピーできませんでした。本文を選択してコピーしてください。",
                      ),
                    )
                }
              >
                <Copy size={18} />
                回答をコピー
              </button>
            </div>
            <section className="p6-trial-complete">
              <CheckCircle size={26} />
              <h2>この話の続きも、あなたのペースで。</h2>
              <p>
                登録は任意です。メール認証後、下の操作でこの相談だけを引き継げます。お試しの1回答は、登録後の無料月3往復とは別枠です。
              </p>
              <Link className="p6-button" href="/account?trial=1">
                無料登録・ログインへ
              </Link>
              <label className="p6-check">
                <input
                  type="checkbox"
                  checked={claimConsent}
                  onChange={(e) => setClaimConsent(e.target.checked)}
                />
                この相談を、次のアカウントへ保存する：
                {memberEmail ?? "未ログイン（メール認証後に戻ってください）"}
              </label>
              <button
                className="p6-button p6-outlined"
                disabled={!claimConsent || !memberEmail || busy}
                onClick={() => void claim()}
              >
                認証済みアカウントへ引き継ぐ
              </button>
            </section>
          </>
        )}
        {session?.claimed && (
          <div className="p6-trial-complete">
            <h2>この相談は引き継ぎ済みです。</h2>
            <p>保存したアカウントでログインして、履歴から続きを話せます。</p>
            <Link className="p6-button" href="/consult">
              相談・履歴へ
            </Link>
          </div>
        )}
        {session?.deleted && !session.claimed && (
          <p>お試しの本文は削除済みです。利用枠は期限まで維持されます。</p>
        )}

        {error && (
          <p role="alert" className="p6-error">
            {error}
          </p>
        )}
        <p className="p6-small" role="status" aria-live="polite">
          {notice}
        </p>
        {session?.expiresAt && (
          <p className="p6-small">
            お試しの閲覧・引き継ぎ期限：
            {new Date(session.expiresAt).toLocaleString("ja-JP")}
            （この端末の時刻）
          </p>
        )}
        {session?.active && !session.deleted && !session.claimed && (
          <button
            className="p6-text-button"
            disabled={busy}
            onClick={() => void erase()}
          >
            サービス上の本文・回答を削除する
          </button>
        )}
        <Link className="p6-safety-link" href="/safety">
          危険や強いつらさを感じるとき
        </Link>
        {used && <TrialRetention />}
      </div>
      {!used && (
        <form
          className="p6-composer-dock"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="p6-composer">
            <label htmlFor="trial-text">{config.label}</label>
            <textarea
              id="trial-text"
              value={text}
              maxLength={session?.maxLength ?? 800}
              disabled={busy}
              placeholder={config.placeholder}
              rows={3}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  (e.ctrlKey || e.metaKey) &&
                  e.key === "Enter" &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="p6-composer-actions">
              <span>
                {text.length}/{session?.maxLength ?? 800}文字
              </span>
              <button
                className="p6-button"
                disabled={
                  busy ||
                  !text.trim() ||
                  !consent ||
                  !session?.enabled ||
                  (!session.active && !challenge)
                }
              >
                {busy ? "回答を準備中…" : "登録なしで試す"}
                <ArrowUp size={20} />
              </button>
            </div>
          </div>
          <label className="p6-check">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              18歳以上で、<Link href="/legal/terms">利用規約</Link>と
              <Link href="/legal/privacy">プライバシー</Link>
              を確認し、入力のOpenAIへの送信に同意します。
            </span>
          </label>
          <p className="p6-small">
            閲覧・引き継ぎは開始から最大24時間です。すべての保存先からの24時間以内の完全削除は保証していません。登録は任意です。
          </p>
          <TrialRetention />
          <div ref={challengeElement} />
        </form>
      )}
    </main>
  );
}
