"use client";
import { useEffect, useState, useRef } from "react";
import { request } from "@/lib/client";
type Contact = {
  id: string;
  name: string;
  email: string;
  message: string;
  status: string;
  admin_note: string | null;
  created_at: string;
  first_response_at: string | null;
  replied_at: string | null;
  resolved_at: string | null;
  contact_mail: {
    id: string;
    kind: string;
    status: string;
    attempts: number;
  }[];
};
const statuses: Record<string, string> = {
  open: "未対応",
  in_progress: "対応中",
  resolved: "完了",
  spam: "迷惑送信",
};
const mailStatuses: Record<string, string> = {
  queued: "送信待ち",
  sending: "送信中",
  accepted: "送信サービス受付済み（到達未確認）",
  failed: "送信失敗",
  manual_review: "要確認：自動再送停止",
};
export default function ContactAdmin() {
  const [data, setData] = useState<{
      messages: Contact[];
      mailConfigured: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [offset, setOffset] = useState(0),
    [filter, setFilter] = useState("open");
  const requests = useRef<Record<string, { text: string; id: string }>>({});
  useEffect(() => {
    let current = true;
    request<{ messages: Contact[]; mailConfigured: boolean }>(
      `/api/admin/contact?offset=${offset}&status=${filter}`,
    )
      .then((d) => {
        if (current) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [offset, filter]);
  async function action(payload: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/api/admin/contact", payload);
      setData(
        await request(`/api/admin/contact?offset=${offset}&status=${filter}`),
      );
      setNotice("変更を保存しました。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="flow">
      <h1>お問い合わせ管理</h1>
      <p>許可された運営担当者だけが閲覧できます。</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <>
          <p>
            {data.mailConfigured
              ? "メール送信設定あり。実際の到達は送信サービスと受信箱で確認してください。"
              : "メール送信は未設定です。内容の確認・対応状況の保存は利用できます。"}
          </p>
          <p className="fine">
            毎営業日に未対応・対応中を確認し、返金や削除の依頼を優先して対応してください。返信は普段お使いの運営用メールから行い、送信後に「別途返信したことを記録」を押せます。
          </p>
          {data.mailConfigured && (
            <p className="fine">
              「要確認」のメールは送信サービスの履歴を確認してください。受信箱への到達は自動判定していません。
            </p>
          )}
          <label>
            表示するお問い合わせ
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setOffset(0);
                setData(null);
              }}
            >
              {Object.entries({ ...statuses, all: "すべて" }).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <p className="fine">受付が古い順に表示します。</p>
          {data.messages.length === 0 && (
            <p>該当するお問い合わせはありません。</p>
          )}
          {data.messages.map((c) => (
            <article className="panel" key={c.id}>
              <h2>{c.name}さんのお問い合わせ</h2>
              <p>
                {c.email}
                <br />
                受付番号：{c.id}
              </p>
              <dl className="contact-dates">
                <dt>受付日時</dt>
                <dd>{new Date(c.created_at).toLocaleString("ja-JP")}</dd>
                <dt>対応開始</dt>
                <dd>
                  {c.first_response_at
                    ? new Date(c.first_response_at).toLocaleString("ja-JP")
                    : "未対応"}
                </dd>
                <dt>別途返信した日時</dt>
                <dd>
                  {c.replied_at
                    ? new Date(c.replied_at).toLocaleString("ja-JP")
                    : "未記録"}
                </dd>
                <dt>完了日時</dt>
                <dd>
                  {c.resolved_at
                    ? new Date(c.resolved_at).toLocaleString("ja-JP")
                    : "未完了"}
                </dd>
              </dl>
              <p className="admin-message">{c.message}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void action({
                    action: "update",
                    id: c.id,
                    status: f.get("status"),
                    note: f.get("note"),
                  });
                }}
              >
                <label>
                  対応状況
                  <select name="status" defaultValue={c.status}>
                    {Object.entries(statuses).map(([v, t]) => (
                      <option value={v} key={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  運営メモ
                  <textarea
                    name="note"
                    defaultValue={c.admin_note ?? ""}
                    maxLength={5000}
                  />
                </label>
                <button className="button secondary" disabled={busy}>
                  対応状況を保存
                </button>
              </form>
              <p>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void action({ action: "external_reply", id: c.id })
                  }
                >
                  別途返信したことを記録
                </button>
              </p>
              <p className="fine">
                このボタンからメールは送信されません。実際に返信した後に押してください。解決したら対応状況を「完了」にします。
              </p>
              <ul>
                {c.contact_mail.map((m) => (
                  <li key={m.id}>
                    {
                      {
                        receipt: "受付通知",
                        notification: "運営通知",
                        reply: "返信",
                      }[m.kind]
                    }
                    ：{mailStatuses[m.status]}／試行{m.attempts}回
                  </li>
                ))}
              </ul>
              {data.mailConfigured && (
                <>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const text = String(
                        new FormData(e.currentTarget).get("reply"),
                      );
                      let r = requests.current[c.id];
                      if (!r || r.text !== text)
                        r = requests.current[c.id] = {
                          text,
                          id: crypto.randomUUID(),
                        };
                      void action({
                        action: "reply",
                        id: c.id,
                        requestId: r.id,
                        message: text,
                      });
                    }}
                  >
                    <label>
                      返信内容
                      <textarea
                        name="reply"
                        required
                        maxLength={5000}
                        disabled={!data.mailConfigured}
                      />
                    </label>
                    <p className="fine">
                      上記のメールアドレスへ送信します。送信後も同じ文面を連打して二重送信しない仕組みです。
                    </p>
                    <button
                      className="button"
                      disabled={busy || !data.mailConfigured}
                    >
                      この内容で返信を送信
                    </button>
                  </form>
                  <button
                    className="button secondary"
                    disabled={busy || !data.mailConfigured}
                    onClick={() => void action({ action: "retry", id: c.id })}
                  >
                    送信待ち・失敗メールを再試行
                  </button>
                </>
              )}
            </article>
          ))}
          <button
            disabled={offset === 0 || busy}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            前の20件
          </button>{" "}
          <button
            disabled={data.messages.length < 20 || busy}
            onClick={() => setOffset(offset + 20)}
          >
            次の20件
          </button>
        </>
      )}
    </main>
  );
}
