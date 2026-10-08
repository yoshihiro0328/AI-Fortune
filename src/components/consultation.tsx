"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { request } from "@/lib/client";
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
export default function Consultation() {
  const [home, setHome] = useState<ConsultationHome | null>(null),
    [subjectId, setSubjectId] = useState(""),
    [threadId, setThreadId] = useState(""),
    [turns, setTurns] = useState<Turn[]>([]),
    [more, setMore] = useState(false),
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
    [diagnosis, setDiagnosis] = useState("");
  const pending = useRef<{
    requestId: string;
    text: string;
    regenerate?: boolean;
    regenerationId?: string;
  } | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const h = await request<ConsultationHome>("/api/consultations");
    setHome(h);
    return h;
  }, []);
  const open = useCallback(async (id: string) => {
    const seq = ++generation.current;
    setError("");
    const d = await request<{
      thread: Thread;
      subject: Subject;
      turns: Turn[];
      hasMore: boolean;
    }>("/api/consultations?thread=" + id);
    if (seq !== generation.current) return;
    setThreadId(id);
    setSubjectId(d.subject.id);
    setTurns(d.turns);
    setMore(d.hasMore);
    setText("");
    pending.current = null;
    setHasPending(false);
    setMemoryEdit(false);
    setRename(d.subject.nickname);
    window.history.replaceState(null, "", "/consult?thread=" + id);
  }, []);
  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(load)
      .then(async (h) => {
        if (!alive) return;
        const p = new URLSearchParams(location.search);
        setDiagnosis(p.get("diagnosis") ?? "");
        const id =
          p.get("thread") ??
          (!p.has("diagnosis") ? h.threads[0]?.id : undefined);
        if (id) await open(id);
        else if (h.subjects[0]) {
          setSubjectId(h.subjects[0].id);
          setRename(h.subjects[0].nickname);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBoot(false);
      });
    return () => {
      alive = false;
    };
  }, [load, open]);
  const subject = home?.subjects.find((s) => s.id === subjectId);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
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
        setSubjectId(s.id);
        setThreadId("");
        setTurns([]);
        setRename(s.nickname);
        setMemoryEdit(false);
      }
    });
  }
  async function send(retry = false, turn?: Turn) {
    await act(async () => {
      let id = threadId;
      if (!id) {
        if (!subjectId) throw new Error("相談相手の呼び名を追加してください。");
        const t = await request<{ id: string }>("/api/consultations", {
          action: "create_thread",
          subject: subjectId,
        });
        id = t.id;
        setThreadId(id);
      }
      if (turn) {
        pending.current = {
          requestId: turn.id,
          text: turn.user_text,
          ...(turn.assistant_text
            ? { regenerate: true, regenerationId: crypto.randomUUID() }
            : {}),
        };
      } else if (!retry)
        pending.current = { requestId: crypto.randomUUID(), text: text.trim() };
      setHasPending(true);
      if (!pending.current?.text)
        throw new Error("相談したいことを入力してください。");
      await request("/api/consultations/" + id + "/send", pending.current);
      pending.current = null;
      setHasPending(false);
      await load();
      await open(id);
    });
  }
  async function manage(action: string, extra: Record<string, unknown> = {}) {
    await request("/api/consultations", { action, id: subjectId, ...extra });
    await load();
  }
  return (
    <main id="main" className="consult-wrap">
      <div className="consult-heading">
        <div>
          <p className="eyebrow">いつでも、前の話の続きから。</p>
          <h1>ふたりのことを相談する</h1>
        </div>
        <Link href="/account">マイページ</Link>
      </div>
      {boot ? (
        <p role="status">相談履歴を読み込んでいます…</p>
      ) : !home ? (
        <div className="panel">
          <p>{error || "継続相談にはログインが必要です。"}</p>
          <Link className="button" href="/account">
            ログイン・無料登録
          </Link>
          <p>初回診断は登録なしで利用できます。</p>
          <Link href="/diagnosis/partner-mind">無料診断を始める</Link>
        </div>
      ) : (
        <>
          <p className="notice">
            {home.usage.plan === "plus" ? "Plus" : "無料プラン"} · 残り{" "}
            <strong>{home.usage.remaining}回</strong> / {home.usage.limit}回 ·{" "}
            {date(home.usage.period_end)}まで{" "}
            <Link href="/plans">プランの違い</Link>
          </p>
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
                    setNotice("診断を相談相手に保存しました。");
                  })
                }
              >
                選んだ相手に診断を保存
              </button>
            </section>
          )}
          <div className="consult-grid">
            <aside className="consult-sidebar" aria-label="相談相手と履歴">
              <h2>相談相手</h2>
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
                    {s.nickname}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void createSubject();
                }}
              >
                <label htmlFor="nickname">呼び名を追加（実名は不要です）</label>
                <input
                  id="nickname"
                  maxLength={40}
                  required
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
                  <h3>{subject.nickname}との相談履歴</h3>
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
                        <Link href={"/result/" + l.diagnosis_id}>
                          紐づけた診断・詳細レポートを見る
                        </Link>
                      </p>
                    ))}
                </>
              )}
            </aside>
            <section className="chat-panel" aria-label="相談チャット">
              <h2>
                {subject
                  ? subject.nickname + "について"
                  : "相談相手を追加してください"}
              </h2>
              {subject && (
                <details className="memory-panel">
                  <summary>覚えていること・最近の出来事</summary>
                  <p className="fine">
                    あなたが話した内容と以前の提案です。引用した時点の情報として扱います。
                  </p>
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
                      {!subject.memory.length && <p>まだ記憶はありません。</p>}
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
                        記憶を修正・削除
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
                        保存後は、このメモと新しい会話から相談を続けます。過去の会話の表示は残りますが、以前の本文をAIの回答には使いません。空欄で保存すると記憶を削除します。
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
                            setNotice("記憶を更新しました。");
                          })
                        }
                      >
                        記憶を保存
                      </button>
                    </>
                  )}
                </details>
              )}
              <div
                className="chat-messages"
                aria-live="polite"
                aria-busy={busy}
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
                            encodeURIComponent(turns[0].created_at),
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
                  <article className="chat-exchange" key={t.id}>
                    <div className="chat-bubble user-message">
                      <small>あなた · {date(t.created_at)}</small>
                      <p>{t.user_text}</p>
                    </div>
                    {t.assistant_text ? (
                      <div className="chat-bubble assistant-message">
                        <small>
                          よりそい{t.safety ? " · 安全についてのご案内" : ""}
                        </small>
                        <p>{t.assistant_text}</p>
                        {!t.safety && t.generation < 3 && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => send(false, t)}
                          >
                            回答をもう一度考える（回数は減りません）
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="notice">
                        <p>
                          {t.status === "pending"
                            ? "回答の作成中、または通信が中断されました。少し待って再試行できます。"
                            : "回答を作成できませんでした。相談回数は使っていません。"}
                        </p>
                        <button disabled={busy} onClick={() => send(false, t)}>
                          この相談を再試行
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
              </div>
              <form
                className="chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label htmlFor="chat-text">相談したいこと</label>
                <textarea
                  id="chat-text"
                  maxLength={4000}
                  required
                  rows={4}
                  value={text}
                  disabled={busy || !subject}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="昨日LINEが来たので、返信を一緒に考えたい…"
                />
                <div className="actions">
                  <button
                    className="button"
                    disabled={busy || !subject || !text.trim()}
                  >
                    相談を送る
                  </button>
                  {hasPending && error && (
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
                  AIによる回答のため、必要な相談内容を外部サービスで処理します。氏名・住所・電話番号は書かないでください。
                  <Link href="/legal/privacy">データの扱い</Link>
                </p>
                <p className="fine">
                  回答が届いた1往復を1回と数えます。失敗・再送・再生成では追加消費しません。
                  <Link href="/safety">
                    危険やつらさを感じるとき（回数制限なし）
                  </Link>
                </p>
              </form>
              {subject && (
                <details className="organize">
                  <summary>呼び名・相談履歴を整理する</summary>
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
                  {threadId && (
                    <>
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
                          required
                          maxLength={80}
                          defaultValue={
                            home.threads.find((t) => t.id === threadId)?.title
                          }
                          key={threadId}
                        />
                        <button disabled={busy}>タイトルを保存</button>
                      </form>
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
                        この相談を移動し、両方の相手の要約記憶を消去します。その後の回答は移動先の履歴だけを使います。
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
                      <p>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                "この相談本文と関連する記憶を削除します。取り消せません。利用回数と決済記録は残ります。",
                              )
                            )
                              void act(async () => {
                                await manage("delete_thread", { id: threadId });
                                setThreadId("");
                                setTurns([]);
                              });
                          }}
                        >
                          この相談履歴を削除
                        </button>
                      </p>
                    </>
                  )}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "この相手の相談本文・記憶・診断の紐づけを削除します。購入済み診断と決済記録は残ります。取り消せません。",
                        )
                      )
                        void act(async () => {
                          await manage("delete_subject");
                          setSubjectId("");
                          setThreadId("");
                          setTurns([]);
                        });
                    }}
                  >
                    この相手の相談データを削除
                  </button>
                </details>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
