"use client";
import { useState } from "react";
import { request } from "@/lib/client";
export default function Confirm() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function confirm() {
    setBusy(true);
    try {
      const q = new URLSearchParams(location.search);
      const r = await request<{ recovery: boolean }>("/api/auth/confirm", {
        token_hash: q.get("token_hash"),
        type: q.get("type"),
      });
      location.replace(
        r.recovery ? "/account?mode=update" : "/account?verified=1",
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main id="main" className="flow">
      <h1>メールアドレスを確認します。</h1>
      <div className="panel">
        <p>
          このメールを受け取ったアカウントへのログインを完了します。診断の保存はログイン後に選べます。
        </p>
        <button className="button" disabled={busy} onClick={confirm}>
          {busy ? "確認しています…" : "メールを確認して続ける"}
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p>
          <a href="/account">ログイン・メール再送へ</a>
        </p>
      </div>
    </main>
  );
}
