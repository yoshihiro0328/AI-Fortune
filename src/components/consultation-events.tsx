"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/client";
import type { ManualEvent } from "@/lib/consultation/events";
export default function ConsultationEvents({ subject }: { subject: string }) {
  const [events, setEvents] = useState<ManualEvent[]>([]),
    [date, setDate] = useState(""),
    [text, setText] = useState(""),
    [editing, setEditing] = useState<ManualEvent | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false);
  const load = async () => {
    const r = await request<{ events: ManualEvent[] }>(
      "/api/consultation-events?subject=" + subject,
    );
    setEvents(r.events);
  };
  useEffect(() => {
    let alive = true;
    void request<{ events: ManualEvent[] }>(
      "/api/consultation-events?subject=" + subject,
    )
      .then((r) => {
        if (alive) setEvents(r.events);
      })
      .catch(() => {
        if (alive) setError("出来事を読み込めませんでした。");
      });
    return () => {
      alive = false;
    };
  }, [subject]);
  async function save(
    method: "POST" | "PATCH" | "DELETE",
    event?: ManualEvent,
  ) {
    setBusy(true);
    setError("");
    try {
      const data =
        method === "DELETE"
          ? { id: event!.id, revision: event!.revision }
          : editing
            ? { id: editing.id, revision: editing.revision, date, text }
            : { id: crypto.randomUUID(), subject, date, text };
      const res = await fetch("/api/consultation-events", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        if (res.status >= 500) setUncertain(true);
        throw new Error(
          res.status === 409
            ? "別の更新と重なりました。一覧を再確認してください。"
            : "保存・削除できませんでした。一覧を確認してください。",
        );
      }
      setDate("");
      setText("");
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      setUncertain(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="memory-panel">
      <summary>日付付きの出来事（自分で記録）</summary>
      <p className="fine">
        自分で入力した記録です。AIの提案や覚えているメモとは別に保存します。この記録はAIの回答には自動で使われません。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul>
        {events.map((e) => (
          <li key={e.id}>
            <time>{e.event_date}</time> · 自分の記録<p>{e.text}</p>
            <button
              type="button"
              disabled={busy || uncertain}
              onClick={() => {
                setEditing(e);
                setDate(e.event_date);
                setText(e.text);
              }}
            >
              編集
            </button>{" "}
            <button
              type="button"
              disabled={busy || uncertain}
              onClick={() => {
                if (confirm("この出来事を削除しますか？"))
                  void save("DELETE", e);
              }}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
      {!events.length && <p>日付付きの出来事はまだありません。</p>}
      {uncertain ? (
        <p>
          結果を確認するまで再送しません。
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void load().catch(() => setError("一覧を確認できませんでした。"));
            }}
          >
            一覧を読み直す
          </button>
          画面を開き直し、保存済みか確認してから操作してください。
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(editing ? "PATCH" : "POST");
          }}
        >
          <label htmlFor="event-date">出来事の日付</label>
          <input
            id="event-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <label htmlFor="event-text">あったこと</label>
          <textarea
            id="event-text"
            maxLength={1000}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="button secondary" disabled={busy}>
            {busy ? "保存中…" : editing ? "変更を保存" : "出来事を保存"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDate("");
                setText("");
              }}
            >
              編集をやめる
            </button>
          )}
        </form>
      )}
    </details>
  );
}
