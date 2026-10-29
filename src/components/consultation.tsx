"use client";
import {
  composeMaterial,
  materialErrors,
  type QuoteRow,
} from "@/lib/screenshot/model";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { exchangeExplanation } from "@/lib/display-copy";
import {
  ConversationDrafts,
  type PendingConsultation,
} from "@/lib/consultation/drafts";
import { accountReturnLink } from "@/lib/auth-return";
import { topics, topicIds } from "@/lib/trial/topics";
import ConsultationEvents from "./consultation-events";
import ConversationViewport from "./conversation-viewport";
import ConsultationAnswer from "./consultation-answer";
import dynamic from "next/dynamic";
const ScreenshotImport = dynamic(() => import("./screenshot-import"));
import { inputGuidance } from "@/lib/consultation/input-guidance";
import ConsultationPurpose from "./consultation-purpose";
import {
  appendChange,
  submissionText,
  type Purpose,
} from "@/lib/consultation/purpose";
import { consultationEntry } from "@/lib/consultation/entry";
import {
  isDefiniteInputRejection,
  RequestError,
  request as apiRequest,
} from "@/lib/client";
import {
  memoryLabels,
  type ConsultationHome,
  type Subject,
  type Thread,
  type Turn,
} from "@/lib/consultation/model";
const date = (s: string) =>
  new Date(s).toLocaleString("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export default function Consultation({
  eventsEnabled = false,
  screenshotPrototype = false,
}: {
  eventsEnabled?: boolean;
  screenshotPrototype?: boolean;
}) {
  const [home, setHome] = useState<ConsultationHome | null>(null),
    [subjectId, setSubjectId] = useState(""),
    [threadId, setThreadId] = useState(""),
    [turns, setTurns] = useState<Turn[]>([]),
    [more, setMore] = useState(false),
    [sidebarOpen, setSidebarOpen] = useState(false),
    [text, setText] = useState(""),
    [nickname, setNickname] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [boot, setBoot] = useState(true),
    [hasPending, setHasPending] = useState(false),
    [memoryEdit, setMemoryEdit] = useState(false),
    [notes, setNotes] = useState(""),
    [moveTarget, setMoveTarget] = useState(""),
    [rename, setRename] = useState(""),
    [diagnosis, setDiagnosis] = useState(""),
    [expanded, setExpanded] = useState(false),
    [search, setSearch] = useState(""),
    [searchResults, setSearchResults] = useState<Thread[] | null>(null),
    [topic, setTopic] = useState(""),
    [returnPath, setReturnPath] = useState("/consult");
  const [purpose, setPurpose] = useState<Purpose | "">("");
  const [material, setMaterial] = useState<QuoteRow[]>([]);
  const [materialBlocked, setMaterialBlocked] = useState(false);
  const [materialRevision, setMaterialRevision] = useState(0);
  const composed = submissionText(composeMaterial(text, material), purpose);
  const materialInvalid =
    materialBlocked ||
    materialErrors(material).length > 0 ||
    composed.length > 4000;
  const sendLock = useRef(false);
  const pending = useRef<PendingConsultation | null>(null);
  const drafts = useRef(new ConversationDrafts());
  const activeKey = useRef("");
  const authEpoch = useRef(0);
  const generation = useRef(0);
  const owner = useRef<string | null>(null);
  const invalidate = useCallback(() => {
    authEpoch.current++;
    generation.current++;
    drafts.current.clear();
    owner.current = null;
  }, []);
  const switchDraft = useCallback((key: string) => {
    activeKey.current = key;
    const draft = drafts.current.get(key);
    setText(draft.text);
    setMaterial(draft.material ?? []);
    setMaterialBlocked(false);
    setPurpose(draft.purpose ?? "");
    pending.current = draft.pending;
    setHasPending(!!draft.pending);
    setExpanded(false);
  }, []);
  const clearPrivate = useCallback(() => {
    invalidate();
    activeKey.current = "";
    pending.current = null;
    setHome(null);
    setTurns([]);
    setText("");
    setMaterial([]);
    setMaterialBlocked(false);
    setMaterialRevision((v) => v + 1);
    setPurpose("");
    setThreadId("");
    setSubjectId("");
    setHasPending(false);
    setNotes("");
    setNickname("");
    setRename("");
    setSearch("");
    setSearchResults(null);
    setBusy(false);
  }, [invalidate]);
  const request = useCallback(
    async <T,>(url: string, data?: unknown): Promise<T> => {
      const epoch = authEpoch.current;
      try {
        const value = await apiRequest<T>(url, data);
        if (epoch !== authEpoch.current)
          throw new Error(
            "ログイン状態が変わりました。ページを開き直してください。",
          );
        return value;
      } catch (e) {
        if (e instanceof RequestError && e.status === 401) clearPrivate();
        throw e;
      }
    },
    [clearPrivate],
  );
  const load = useCallback(async () => {
    const epoch = authEpoch.current;
    const h = await request<ConsultationHome>("/api/consultations");
    if (epoch !== authEpoch.current)
      throw new Error("アカウントが変わりました。ページを開き直してください。");
    if (!h.ownerId)
      throw new Error("アカウントを確認できません。ログインし直してください。");
    if (owner.current && owner.current !== h.ownerId) {
      clearPrivate();
      throw new Error("アカウントが変わりました。ページを開き直してください。");
    }
    owner.current = h.ownerId;
    drafts.current.setOwner(h.ownerId);
    setHome(h);
    return h;
  }, [request, clearPrivate]);
  const open = useCallback(
    async (id: string, expectedSubject?: string) => {
      const seq = ++generation.current;
      setError("");
      const d = await request<{
        thread: Thread;
        subject: Subject;
        turns: Turn[];
        hasMore: boolean;
      }>("/api/consultations?thread=" + id);
      if (seq !== generation.current) return;
      if (expectedSubject && d.subject.id !== expectedSubject)
        throw new Error("指定された相談と相手が一致しません。");
      setThreadId(id);
      setSidebarOpen(false);
      setSubjectId(d.subject.id);
      setTurns(d.turns);
      setMore(d.hasMore);
      switchDraft(id);
      setMemoryEdit(false);
      setRename(d.subject.nickname);
      window.history.replaceState(null, "", "/consult?thread=" + id);
    },
    [switchDraft, request],
  );
  useEffect(() => {
    let alive = true;
    const initialPath = "/consult" + location.search;
    void Promise.resolve().then(() => setReturnPath(initialPath));
    void Promise.resolve()
      .then(load)
      .then(async (h) => {
        if (!alive) return;
        const p = new URLSearchParams(location.search);
        setReturnPath("/consult" + location.search);
        const selectedTopic = p.get("topic");
        if (topicIds.some((id) => id === selectedTopic))
          setTopic(selectedTopic!);
        const entry = consultationEntry(h, p);
        const { linked } = entry;
        setDiagnosis(entry.diagnosis);
        if (entry.threadId)
          await open(entry.threadId, p.get("subject") ?? undefined);
        else if (entry.subject) {
          setSubjectId(entry.subject.id);
          setRename(entry.subject.nickname);
          switchDraft("new:" + entry.subject.id);
        }
        if (linked) setNotice("この診断に紐づく相談相手を開きました。");
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBoot(false);
      });
    return () => {
      alive = false;
      // Also clear retained React UI state when a route is hidden/unmounted.
      // A later history return must not paint the previous account's conversation.
      clearPrivate();
    };
  }, [load, open, switchDraft, clearPrivate]);
  useEffect(() => {
    // Cross-tab identity changes carry no user data or consultation text.
    const changed = () => {
      clearPrivate();
      setError("ログイン状態が変わりました。ページを開き直してください。");
    };
    const channel = new BroadcastChannel("yorisoi-auth-change");
    channel.onmessage = changed;
    window.addEventListener("yorisoi-auth-change", changed);
    const check = () => {
      void request<ConsultationHome>("/api/consultations")
        .then((h) => {
          if (home && h.ownerId !== home.ownerId) changed();
        })
        .catch((e) => {
          if (e instanceof RequestError && e.status === 401) changed();
        });
    };
    window.addEventListener("focus", check);
    return () => {
      channel.close();
      window.removeEventListener("yorisoi-auth-change", changed);
      window.removeEventListener("focus", check);
    };
  }, [clearPrivate, home, request]);
  const subject = home?.subjects.find((s) => s.id === subjectId);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof RequestError && e.status === 401) clearPrivate();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createSubject() {
    await act(async () => {
      const s = await request<{ id: string }>("/api/consultations", {
        action: "create_subject",
        nickname,
      });
      setNickname("");
      if (diagnosis) {
        await request("/api/consultations", {
          action: "link_diagnosis",
          id: diagnosis,
          target: s.id,
        });
        setDiagnosis("");
      }
      const t = await request<{ id: string }>("/api/consultations", {
        action: "create_thread",
        subject: s.id,
      });
      await load();
      await open(t.id);
    });
  }
  async function selectSubject(s: Subject) {
    await act(async () => {
      const t = home?.threads.find((t) => t.subject_id === s.id);
      if (t) await open(t.id);
      else {
        generation.current++;
        switchDraft("new:" + s.id);
        setMore(false);
        setSidebarOpen(false);
        setSubjectId(s.id);
        setThreadId("");
        setTurns([]);
        setRename(s.nickname);
        setMemoryEdit(false);
        window.history.replaceState(
          null,
          "",
          "/consult?subject=" + encodeURIComponent(s.id),
        );
      }
    });
  }
  async function send(retry = false, turn?: Turn) {
    if (sendLock.current) return;
    if (
      !retry &&
      !turn &&
      (materialInvalid || !composeMaterial(text, material).trim())
    ) {
      setError(
        materialErrors(material).join("\n") ||
          "読み取り・変更の確認を終え、合計4000文字以内にしてください。",
      );
      return;
    }
    sendLock.current = true;
    try {
      await act(async () => {
        // Verify the current owner before any send, including retry after a background account change.
        await load();
        let id = threadId;
        if (!id) {
          if (!subjectId)
            throw new Error("相談相手の呼び名を追加してください。");
          const t = await request<{ id: string }>("/api/consultations", {
            action: "create_thread",
            subject: subjectId,
          });
          id = t.id;
          drafts.current.move(activeKey.current, id);
          activeKey.current = id;
          setThreadId(id);
          setSidebarOpen(false);
        }
        if (turn) {
          pending.current = {
            requestId: turn.id,
            text: turn.user_text,
            ...(turn.assistant_text
              ? { regenerate: true, regenerationId: crypto.randomUUID() }
              : {}),
          };
        } else if (!retry) {
          if (pending.current)
            throw new Error(
              "前の送信結果を確認するため、同じ内容の再送をご利用ください。",
            );
          const submitted = composed;
          if (submitted.length > 4000)
            throw new Error(
              "目的の表示を含めて4000文字以内にしてください。下書きは保持しています。",
            );
          pending.current = { requestId: crypto.randomUUID(), text: submitted };
        }
        if (retry && pending.current && id) {
          const existing = await request<{ turns: Turn[] }>(
            "/api/consultations?thread=" + id,
          );
          const resolved = existing.turns.find(
            (t) =>
              t.id === pending.current?.requestId &&
              t.status === "ready" &&
              t.assistant_text,
          );
          if (resolved && !pending.current.regenerate) {
            drafts.current.remove(id);
            pending.current = null;
            setHasPending(false);
            setMaterialRevision((v) => v + 1);
            await open(id);
            setNotice("回答が届きました。");
            return;
          }
        }
        setHasPending(true);
        if (!pending.current?.text)
          throw new Error("相談したいことを入力してください。");
        drafts.current.update(id, { pending: pending.current });
        const epoch = authEpoch.current;
        try {
          await request("/api/consultations/" + id + "/send", pending.current);
        } catch (e) {
          if (isDefiniteInputRejection(e)) {
            pending.current = null;
            setHasPending(false);
            drafts.current.update(id, { pending: null });
          }
          throw e;
        }
        if (epoch !== authEpoch.current) return;
        drafts.current.remove(id);
        pending.current = null;
        setText("");
        setMaterial([]);
        setMaterialBlocked(false);
        setMaterialRevision((v) => v + 1);
        setPurpose("");
        setHasPending(false);
        await load();
        await open(id);
        setNotice("回答が届きました。");
      });
    } finally {
      sendLock.current = false;
    }
  }
  async function manage(action: string, extra: Record<string, unknown> = {}) {
    await request("/api/consultations", { action, id: subjectId, ...extra });
    await load();
  }
  return (
    <main id="main" className="consult-wrap">
      <div className="consult-heading">
        <div>
          <p className="eyebrow">
            {home?.threads.length
              ? "いつでも、前の話の続きから。"
              : "いま気になっていることを、あなたの言葉で。"}
          </p>
          <h1>ふたりのことを相談する</h1>
        </div>
      </div>
      {boot ? (
        <p role="status">相談履歴を読み込んでいます…</p>
      ) : !home ? (
        <div className="panel">
          <p>{error || "継続相談にはログインが必要です。"}</p>
          <Link className="button" href={accountReturnLink(returnPath)}>
            ログイン・無料登録
          </Link>
          <p>初回診断は登録なしで利用できます。</p>
          <Link className="button secondary" href="/diagnosis/partner-mind">
            無料診断を始める
          </Link>
        </div>
      ) : (
        <>
          <p className="notice">
            {home.usage.plan === "plus" ? "Plus" : "無料プラン"} · 残り{" "}
            <strong>{home.usage.remaining}往復</strong> / {home.usage.limit}往復
            · {date(home.usage.period_end)}まで{" "}
            <Link className="button secondary" href="/plans">
              プランの違い
            </Link>
          </p>
          <details className="consultation-usage-details">
            <summary>利用回数と相談のしくみ</summary>
            <p className="fine">{exchangeExplanation}</p>
          </details>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {diagnosis && (
            <section className="panel">
              <h2>この診断の続きから相談する</h2>
              <p>相談相手を選ぶか、新しく呼び名を追加してください。</p>
              <button
                disabled={busy || !subjectId}
                className="button"
                onClick={() =>
                  act(async () => {
                    await manage("link_diagnosis", {
                      id: diagnosis,
                      target: subjectId,
                    });
                    setDiagnosis("");
                    setNotice("この相手の相談に診断を追加しました。");
                  })
                }
              >
                この相手の相談に診断を追加
              </button>
            </section>
          )}
          <div className="consult-grid">
            <aside className="consult-sidebar" aria-label="相談相手と履歴">
              <button
                className="mobile-subject-toggle text-button"
                aria-expanded={sidebarOpen || !subject}
                aria-controls="subject-picker"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                {sidebarOpen || !subject
                  ? "相談相手と履歴"
                  : "相手・相談履歴を選ぶ"}
              </button>
              <div
                id="subject-picker"
                className={
                  sidebarOpen || !subject
                    ? "subject-picker open"
                    : "subject-picker"
                }
              >
                <h2>相談相手</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const epoch = authEpoch.current;
                      const result = await request<{ threads: Thread[] }>(
                        "/api/consultations",
                        { action: "search", query: search },
                      );
                      if (epoch === authEpoch.current)
                        setSearchResults(result.threads);
                    });
                  }}
                >
                  <label htmlFor="history-search">相談履歴を検索</label>
                  <input
                    id="history-search"
                    type="search"
                    minLength={2}
                    maxLength={80}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="呼び名・タイトル・会話の言葉"
                  />
                  <button disabled={busy}>検索する</button>
                </form>
                {searchResults && (
                  <section aria-label="検索結果">
                    <p role="status">
                      {searchResults.length
                        ? "最近一致した相談（最大50件）"
                        : "一致する相談はありません。"}
                    </p>
                    <ul className="thread-list">
                      {searchResults.map((t) => (
                        <li key={t.id}>
                          <button
                            disabled={busy}
                            onClick={() => act(() => open(t.id))}
                          >
                            {
                              home.subjects.find((s) => s.id === t.subject_id)
                                ?.nickname
                            }{" "}
                            · {t.title}
                            <small>{date(t.updated_at)}</small>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      className="text-button"
                      onClick={() => {
                        setSearchResults(null);
                        setSearch("");
                      }}
                    >
                      検索を閉じる
                    </button>
                  </section>
                )}
                <div className="subject-tabs">
                  {home.subjects.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={
                        "subject-tab " + (subjectId === s.id ? "selected" : "")
                      }
                      disabled={busy}
                      aria-pressed={subjectId === s.id}
                      onClick={() => selectSubject(s)}
                    >
                      <span className="subject-name" title={s.nickname}>
                        {s.nickname}
                      </span>
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createSubject();
                  }}
                >
                  <label htmlFor="nickname">
                    呼び名を追加（実名は不要です）
                  </label>
                  <input
                    id="nickname"
                    maxLength={40}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="今の恋人、気になる人 など"
                  />
                  <button className="button secondary" disabled={busy}>
                    相談相手を追加
                  </button>
                </form>
                {subject && (
                  <>
                    <h3>この相手との相談履歴</h3>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const t = await request<{ id: string }>(
                            "/api/consultations",
                            { action: "create_thread", subject: subjectId },
                          );
                          await load();
                          await open(t.id);
                        })
                      }
                    >
                      新しい相談を始める
                    </button>
                    <ul className="thread-list">
                      {home.threads
                        .filter((t) => t.subject_id === subjectId)
                        .map((t) => (
                          <li key={t.id}>
                            <button
                              disabled={busy}
                              aria-current={
                                t.id === threadId ? "page" : undefined
                              }
                              onClick={() => act(() => open(t.id))}
                            >
                              {t.title}
                              <small>{date(t.updated_at)}</small>
                            </button>
                          </li>
                        ))}
                    </ul>
                    {home.links
                      .filter((l) => l.subject_id === subjectId)
                      .map((l) => (
                        <p key={l.diagnosis_id}>
                          <Link
                            className="button secondary"
                            href={"/result/" + l.diagnosis_id}
                          >
                            この相手についての診断を見る
                          </Link>
                        </p>
                      ))}
                  </>
                )}
              </div>
            </aside>
            <section className="chat-panel" aria-label="相談チャット">
              <div className="section-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    if (subject) {
                      document.getElementById("chat-text")?.focus();
                      return;
                    }
                    setSidebarOpen(true);
                    requestAnimationFrame(() => {
                      const target = home.subjects.length
                        ? document.querySelector<HTMLButtonElement>(
                            "#subject-picker .subject-tab",
                          )
                        : document.getElementById("nickname");
                      target?.focus();
                      target?.scrollIntoView({ block: "center" });
                    });
                  }}
                >
                  相談を書く
                </button>
              </div>
              <h2 className="current-subject">
                {subject
                  ? subject.nickname + "について"
                  : home.subjects.length
                    ? "相談相手を選んでください"
                    : "相談相手を追加してください"}
              </h2>
              {subject && (
                <details className="memory-panel">
                  <summary>
                    覚えていること・最近の出来事（メモ{subject.memory.length}
                    件）
                  </summary>
                  <p className="fine">
                    前に話した内容を参考に、続きから相談できます。相談は相手ごとに分けて保存し、その相手のメモと最近の会話を使います。メモはいつでも確認・修正・削除できます。
                  </p>
                  <details>
                    <summary>メモと相談履歴の違い</summary>
                    <p>
                      メモを修正・削除すると、それまでの会話や追加済みの診断は、次の回答に使わなくなります。画面の相談履歴は残ります。
                    </p>
                    <p>
                      相談履歴を削除すると、その会話の本文・回答と、その相手のメモが消えます。ほかの相談履歴は残り、以後の回答に使われることがあります。購入済みレポートと決済記録は消えません。
                    </p>
                    <p>
                      退会や診断データの削除は
                      <Link href="/contact">お問い合わせ</Link>
                      から依頼できます。保存・削除の範囲は
                      <Link href="/legal/privacy">プライバシーポリシー</Link>
                      をご確認ください。
                    </p>
                  </details>
                  {!memoryEdit ? (
                    <>
                      <ul>
                        {subject.memory.map((f, i) => (
                          <li key={i}>
                            <small>
                              {memoryLabels[f.kind]} · {date(f.at)}
                            </small>
                            <p>{f.quote}</p>
                          </li>
                        ))}
                      </ul>
                      {!subject.memory.length && (
                        <p>次の相談に引き継ぐメモは、まだありません。</p>
                      )}
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setNotes(
                            subject.memory.map((f) => f.quote).join("\n"),
                          );
                          setMemoryEdit(true);
                        }}
                      >
                        引き継ぐメモを修正・削除
                      </button>
                    </>
                  ) : (
                    <>
                      <label htmlFor="memory-notes">
                        残したい内容（1行に1項目、24項目まで）
                      </label>
                      <textarea
                        id="memory-notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={7}
                      />
                      <p className="fine">
                        保存後は、このメモと新しい会話から相談を続けます。過去の会話の表示は残りますが、以前の本文をAIの回答には使いません。空欄で保存すると、引き継ぐメモを削除します。
                      </p>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            await manage("memory", {
                              notes: notes
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            });
                            setMemoryEdit(false);
                            setNotice("引き継ぐメモを更新しました。");
                          })
                        }
                      >
                        メモを保存
                      </button>
                    </>
                  )}
                </details>
              )}
              {subject && eventsEnabled && (
                <ConsultationEvents
                  key={home.ownerId + ":" + subject.id}
                  subject={subject.id}
                />
              )}
              <ConversationViewport
                busy={busy}
                threadKey={home.ownerId + ":" + subjectId + ":" + threadId}
                firstId={turns[0]?.id}
              >
                {more && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const d = await request<{
                          turns: Turn[];
                          hasMore: boolean;
                        }>(
                          "/api/consultations?thread=" +
                            threadId +
                            "&before=" +
                            encodeURIComponent(turns[0].created_at) +
                            "&beforeId=" +
                            encodeURIComponent(turns[0].id),
                        );
                        setTurns([...d.turns, ...turns]);
                        setMore(d.hasMore);
                      })
                    }
                  >
                    以前の相談を読む
                  </button>
                )}
                {!turns.length && (
                  <p className="chat-empty">
                    今あったこと、迷っていることを、そのまま話してください。LINEの返信文も一緒に考えられます。
                  </p>
                )}
                {turns.map((t) => (
                  <article
                    className="chat-exchange"
                    key={t.id}
                    id={"turn-" + t.id}
                    tabIndex={-1}
                  >
                    <div className="chat-bubble user-message">
                      <small>あなた · {date(t.created_at)}</small>
                      <p>{t.user_text}</p>
                    </div>
                    {t.assistant_text ? (
                      <div
                        className="chat-bubble assistant-message"
                        id={"answer-" + t.id}
                        tabIndex={-1}
                        role="region"
                        aria-label="よりそいの回答"
                      >
                        <small>
                          よりそい{t.safety ? " · 安全についてのご案内" : ""}
                        </small>
                        <ConsultationAnswer
                          text={t.assistant_text}
                          safety={t.safety}
                        />
                        {!t.safety && t.generation < 3 && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => send(false, t)}
                          >
                            回答をもう一度考える（追加の回数は使いません）
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="notice">
                        <p>
                          {t.status === "pending"
                            ? "回答の作成中、または通信が中断されました。少し待ってから、もう一度お試しください。"
                            : "回答を作成できませんでした。相談回数は使っていません。"}
                        </p>
                        <button disabled={busy} onClick={() => send(false, t)}>
                          この相談をもう一度送る
                        </button>
                      </div>
                    )}
                  </article>
                ))}
                {busy && (
                  <p role="status" className="processing">
                    内容を整理しています。少しお待ちください…
                  </p>
                )}
              </ConversationViewport>
              <form
                className="chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                {topic && (
                  <p className="fine">
                    相談のテーマ：{topics[topic as keyof typeof topics].name}
                  </p>
                )}
                <ConsultationPurpose
                  value={purpose}
                  disabled={busy || hasPending || !subject}
                  onChange={(value) => {
                    setPurpose(value);
                    drafts.current.update(activeKey.current, {
                      purpose: value,
                    });
                  }}
                />
                {screenshotPrototype && subject && (
                  <ScreenshotImport
                    key={
                      home.ownerId +
                      ":" +
                      subjectId +
                      ":" +
                      threadId +
                      ":" +
                      materialRevision
                    }
                    disabled={busy || hasPending}
                    rows={material}
                    onBlocked={setMaterialBlocked}
                    onChange={(next) => {
                      setMaterial(next);
                      drafts.current.update(activeKey.current, {
                        material: next,
                      });
                    }}
                  />
                )}
                <div className="input-heading">
                  <label htmlFor="chat-text">
                    {purpose ? inputGuidance[purpose].label : "相談したいこと"}
                  </label>
                  <button
                    className="text-button"
                    type="button"
                    aria-expanded={expanded}
                    aria-controls="chat-text"
                    onClick={() => {
                      setExpanded(!expanded);
                      document.getElementById("chat-text")?.focus();
                    }}
                  >
                    {" "}
                    {expanded ? "入力欄を小さくする" : "入力欄を広げる"}
                  </button>
                </div>
                <textarea
                  id="chat-text"
                  maxLength={4000 - submissionText("", purpose).length}
                  rows={expanded ? 12 : 4}
                  className={expanded ? "composer-expanded" : ""}
                  value={text}
                  disabled={busy || hasPending || !subject}
                  onChange={(e) => {
                    setText(e.target.value);
                    drafts.current.update(activeKey.current, {
                      text: e.target.value,
                    });
                  }}
                  onKeyDown={(e) => {
                    if (
                      (e.ctrlKey || e.metaKey) &&
                      e.key === "Enter" &&
                      !e.nativeEvent.isComposing &&
                      !busy &&
                      subject &&
                      composeMaterial(text, material).trim() &&
                      !materialInvalid &&
                      !hasPending
                    ) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  aria-describedby="consult-input-help"
                  placeholder={
                    purpose
                      ? inputGuidance[purpose].example
                      : topic
                        ? topics[topic as keyof typeof topics].placeholder
                        : "昨日LINEが来たので、返信を一緒に考えたい…"
                  }
                />
                <p id="consult-input-help" className="fine input-help">
                  {purpose
                    ? inputGuidance[purpose].help
                    : "今あったことや迷っていることを、自由に書いてください。"}
                </p>
                <div className="composer-feedback" aria-live="polite">
                  {busy && (
                    <p role="status">
                      送信中・回答を待っています。下書きは保持しています。
                    </p>
                  )}
                  {error && (
                    <p className="error" role="alert">
                      {error}
                    </p>
                  )}
                  {hasPending && !busy && (
                    <p>
                      前の送信結果が未確認です。履歴を照合し、同じ送信番号で復旧してください。新しい内容は送信しません。
                    </p>
                  )}
                  {!busy && notice === "回答が届きました。" && (
                    <p role="status">{notice}</p>
                  )}
                  {turns.some((t) => t.assistant_text) && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        const last = turns
                          .filter((t) => t.assistant_text)
                          .at(-1);
                        const el = document.getElementById(
                          "answer-" + last?.id,
                        );
                        el?.scrollIntoView({
                          block: "start",
                          behavior: "smooth",
                        });
                        el?.focus({ preventScroll: true });
                      }}
                    >
                      最近の回答を見る
                    </button>
                  )}
                  {!subject && (
                    <p>
                      {home.subjects.length
                        ? "相談相手を選んでから入力してください。「相談を書く」から選択欄へ移動できます。"
                        : "相談相手の呼び名を追加してから入力してください。「相談を書く」から追加欄へ移動できます。"}
                    </p>
                  )}
                  {materialInvalid && (
                    <p>
                      取り込んだ会話の確認箇所と合計文字数を確認してください。
                    </p>
                  )}
                </div>
                <div className="composer-actions">
                  <span className="fine">
                    合計{composed.length}/4000文字（残り
                    {Math.max(0, 4000 - composed.length)}文字）
                    {composed.length > 4000 &&
                      "・上限超過：送る発言を減らしてください"}
                  </span>
                  <button
                    className="button"
                    disabled={
                      busy ||
                      !subject ||
                      !composeMaterial(text, material).trim() ||
                      hasPending ||
                      materialInvalid
                    }
                  >
                    相談を送る
                  </button>
                  {hasPending && (
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => send(true)}
                    >
                      同じ内容を再送する
                    </button>
                  )}
                </div>
                <p className="fine">
                  下書きはこの画面を開いている間、相談ごとに保持します。送信成功・ログアウト・画面を閉じると消えます。失敗時は保持します。Ctrl
                  / ⌘ + Enterで送信できます。
                </p>
                <p className="fine">
                  AIが回答を作るため、必要な相談内容を外部のAIサービスに送信します。氏名・住所・電話番号は書かないでください。
                  <Link href="/legal/privacy">データの扱い</Link>
                </p>
                <p className="fine">
                  AIが回答を作れなかった場合や、同じ送信の再試行・回答の再生成は、追加の回数を使いません。通信が途切れたときは、まず履歴をご確認ください。
                  <Link href="/plans#consultation-count">回数の数え方</Link>
                </p>
                <p className="safety-action">
                  <Link className="button secondary" href="/safety">
                    危険やつらさを感じるとき（回数制限なし）
                  </Link>
                </p>
                {turns.length > 0 && (
                  <details className="change-disclosure">
                    <summary>前回からの変化を伝える（任意）</summary>
                    <fieldset
                      className="change-entry"
                      disabled={busy || hasPending || !subject}
                    >
                      <legend>
                        前回から、何か変化はありましたか？（任意）
                      </legend>
                      <div className="actions">
                        {[
                          "返信が来た",
                          "会って話した",
                          "まだ何もしていない",
                          "自分で入力する",
                        ].map((label) => (
                          <button
                            type="button"
                            className="button secondary"
                            key={label}
                            onClick={() => {
                              if (label !== "自分で入力する") {
                                const next = appendChange(text, label + "。");
                                if (next === null) {
                                  setError(
                                    "入力が長いため追加できません。今の下書きは保持しています。",
                                  );
                                  return;
                                }
                                setText(next);
                                drafts.current.update(activeKey.current, {
                                  text: next,
                                });
                              }
                              document.getElementById("chat-text")?.focus();
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="fine">
                        本文へ追加するだけです。確認して送信するまで、出来事や履歴には保存しません。
                      </p>
                    </fieldset>
                  </details>
                )}
              </form>
              {subject && (
                <details className="organize">
                  <summary>呼び名・相談履歴を整理する</summary>
                  <div className="field-group">
                    <label htmlFor="rename-subject">相談相手の呼び名</label>
                    <input
                      id="rename-subject"
                      value={rename}
                      maxLength={40}
                      onChange={(e) => setRename(e.target.value)}
                    />
                    <button
                      disabled={busy || !rename.trim()}
                      onClick={() =>
                        act(() => manage("rename_subject", { value: rename }))
                      }
                    >
                      呼び名を変更
                    </button>
                  </div>
                  {threadId && (
                    <div className="field-group">
                      <label htmlFor="thread-title">この相談のタイトル</label>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const data = new FormData(e.currentTarget);
                          void act(async () => {
                            await manage("rename_thread", {
                              id: threadId,
                              value: data.get("title"),
                            });
                            setNotice("タイトルを変更しました。");
                          });
                        }}
                      >
                        <input
                          id="thread-title"
                          name="title"
                          maxLength={80}
                          defaultValue={
                            home.threads.find((t) => t.id === threadId)?.title
                          }
                          key={threadId}
                        />
                        <button disabled={busy}>タイトルを保存</button>
                      </form>
                      <div className="field-group">
                        <label htmlFor="move-subject">
                          相談相手を間違えた場合
                        </label>
                        <select
                          id="move-subject"
                          value={moveTarget}
                          onChange={(e) => setMoveTarget(e.target.value)}
                        >
                          <option value="">移動先を選ぶ</option>
                          {home.subjects
                            .filter((s) => s.id !== subjectId)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.nickname}
                              </option>
                            ))}
                        </select>
                        <p className="fine">
                          この相談を選んだ相手の履歴へ移します。移動元と移動先の両方で、引き継ぐメモを消去します。その後の回答には、移動先にある相談履歴だけを使います。
                        </p>
                        <button
                          disabled={busy || !moveTarget}
                          onClick={() =>
                            act(async () => {
                              await manage("move_thread", {
                                id: threadId,
                                target: moveTarget,
                              });
                              await open(threadId);
                              setMoveTarget("");
                            })
                          }
                        >
                          この相談を移動
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="destructive-actions">
                    <h3>相談データの削除</h3>
                    <p className="fine">
                      削除は取り消せません。相談履歴だけの削除と、相手に関する全相談の削除を選び分けてください。利用回数・決済記録・購入済みの診断は残ります。
                    </p>
                    {threadId && (
                      <p>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                "この相談の会話と関連するメモを削除します。取り消せません。利用回数と支払いの記録は残ります。",
                              )
                            )
                              void act(async () => {
                                await manage("delete_thread", { id: threadId });
                                drafts.current.remove(threadId);
                                switchDraft("new:" + subjectId);
                                setThreadId("");
                                setTurns([]);
                              });
                          }}
                        >
                          この相談履歴を削除
                        </button>
                      </p>
                    )}
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            "この相手の会話とメモを削除し、相談に追加した診断を外します。購入済みの診断と支払いの記録は残ります。この操作は取り消せません。",
                          )
                        )
                          void act(async () => {
                            await manage("delete_subject");
                            home.threads
                              .filter((t) => t.subject_id === subjectId)
                              .forEach((t) => drafts.current.remove(t.id));
                            drafts.current.remove("new:" + subjectId);
                            switchDraft("");
                            setSubjectId("");
                            setThreadId("");
                            setTurns([]);
                          });
                      }}
                    >
                      この相手の相談データを削除
                    </button>
                  </div>
                </details>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
