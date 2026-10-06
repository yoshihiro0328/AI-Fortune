"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { request } from "@/lib/client";
export default function Account() {
  const [email, setEmail] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [rows, setRows] = useState<
      { id: string; status: string; created_at: string }[]
    >([]);
  useEffect(() => {
    request<typeof rows>("/api/diagnoses")
      .then(setRows)
      .catch(() => {});
  }, []);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await request("/api/auth", { email });
      setMessage(
        "確認メールを送信しました。このブラウザでリンクを開くと、匿名で行った診断をアカウントに紐づけます。",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="flow">
      <h1>診断を、あとから振り返る。</h1>
      <div className="panel">
        <p>
          メールで登録・ログインすると、このブラウザで行った診断を保存できます。
        </p>
        <form onSubmit={send}>
          <label htmlFor="email">メールアドレス</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p>
            <button className="button" disabled={busy}>
              確認メールを送る
            </button>
          </p>
        </form>
        {message && <p role="status">{message}</p>}
      </div>
      {rows.map((r) => (
        <p key={r.id}>
          <Link href={"/result/" + r.id}>
            {new Date(r.created_at).toLocaleDateString("ja-JP")}の診断
          </Link>
        </p>
      ))}
    </main>
  );
}
