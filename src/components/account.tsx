"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { request } from "@/lib/client";
type Mode = "login" | "signup" | "resend" | "reset" | "update";
type Row = { id: string; status: string; created_at: string };
const labels: Record<Mode, string> = {
  login: "ログイン",
  signup: "新規登録",
  resend: "確認メールを再送",
  reset: "パスワード再設定メールを送る",
  update: "新しいパスワードを保存",
};
export default function Account() {
  const [mode, setMode] = useState<Mode>("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [consent, setConsent] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [boot, setBoot] = useState(true),
    [user, setUser] = useState<{ email: string } | null>(null),
    [rows, setRows] = useState<Row[]>([]),
    [more, setMore] = useState(false);
  const load = useCallback(async () => {
    const auth = await request<{
      user: { email: string } | null;
      recovery: boolean;
    }>("/api/auth");
    setUser(auth.user);
    if (auth.recovery) setMode("update");
    const data = await request<Row[]>("/api/diagnoses?offset=0");
    setRows(data);
    setMore(data.length === 20);
  }, []);
  useEffect(() => {
    Promise.resolve()
      .then(load)
      .then(() => {
        const params = new URLSearchParams(location.search);
        if (params.has("error"))
          setError(
            "確認リンクが無効か期限切れです。手続きを始めたブラウザで開き直すか、メールを再送してください。",
          );
        if (params.has("verified"))
          setMessage(
            "メール認証が完了しました。下のボタンから、このブラウザの診断を保存できます。",
          );
      })
      .catch(() =>
        setError(
          "アカウント情報を読み込めませんでした。再読み込みしてください。",
        ),
      )
      .finally(() => setBoot(false));
  }, [load]);
  async function act(action: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if ((action === "signup" || action === "update") && password !== confirm)
        throw new Error("パスワードが一致していません。");
      const result = await request<{ message?: string; count?: number }>(
        "/api/auth",
        { action, email, password, consent },
      );
      setPassword("");
      setConfirm("");
      if (action === "logout" || action === "update") {
        localStorage.removeItem("yorisoi_diagnosis");
        setMode("login");
      }
      await load();
      setMessage(
        result.message ??
          (action === "claim"
            ? `${result.count ?? 0}件の診断をアカウントに保存しました。`
            : action === "logout"
              ? "ログアウトしました。"
              : "ログインしました。"),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function nextPage() {
    setBusy(true);
    try {
      const next = await request<Row[]>("/api/diagnoses?offset=" + rows.length);
      setRows([...rows, ...next]);
      setMore(next.length === 20);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="flow">
      <p className="eyebrow">MY PAGE / 診断の保存</p>
      <h1>診断を、あとから振り返る。</h1>
      <p>無料診断は登録なしで使えます。登録はいつでも、ご希望のときに。</p>
      {boot ? (
        <p role="status">アカウントを確認しています…</p>
      ) : (
        <>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          {user && mode !== "update" ? (
            <div className="panel">
              <p>{user.email} でログイン中</p>
              <p>
                このブラウザで行った、まだアカウントに保存していない診断を保存します。
              </p>
              <div className="actions">
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => act("claim")}
                >
                  このブラウザの診断を保存
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => act("logout")}
                >
                  ログアウト
                </button>
              </div>
            </div>
          ) : (
            <div className="panel">
              <h2>{labels[mode]}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(mode);
                }}
              >
                {mode !== "update" && (
                  <>
                    <label htmlFor="email">メールアドレス</label>
                    <input
                      id="email"
                      type="email"
                      required
                      maxLength={254}
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </>
                )}
                {["signup", "login", "update"].includes(mode) && (
                  <>
                    <label htmlFor="password">
                      {mode === "update" ? "新しいパスワード" : "パスワード"}
                    </label>
                    <input
                      id="password"
                      type="password"
                      required
                      minLength={mode === "login" ? 1 : 12}
                      maxLength={128}
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    {mode !== "login" && (
                      <>
                        <p className="fine">英字と数字を含む12〜128文字</p>
                        <label htmlFor="password-confirm">
                          パスワード（確認）
                        </label>
                        <input
                          id="password-confirm"
                          type="password"
                          required
                          minLength={12}
                          maxLength={128}
                          autoComplete="new-password"
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                        />
                      </>
                    )}
                  </>
                )}
                {mode === "signup" && (
                  <label className="choice">
                    <input
                      type="checkbox"
                      required
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    18歳以上で、利用規約とプライバシーポリシーに同意します。
                  </label>
                )}
                <p className="fine">
                  {mode === "login"
                    ? "ログインすると、このブラウザの匿名診断をあなたのアカウントに保存します。共有端末ではご注意ください。"
                    : mode === "update"
                      ? "更新後は、すべての端末でログインし直してください。"
                      : "メールのリンクは、手続きを始めたブラウザで開いてください。"}
                </p>
                <button className="button" disabled={busy}>
                  {busy ? "手続きしています…" : labels[mode]}
                </button>
              </form>
              <nav className="auth-links" aria-label="認証メニュー">
                {(["login", "signup", "resend", "reset"] as Mode[])
                  .filter((x) => x !== mode)
                  .map((x) => (
                    <button
                      key={x}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setMode(x);
                        setError("");
                        setMessage("");
                        setPassword("");
                        setConfirm("");
                      }}
                    >
                      {labels[x]}
                    </button>
                  ))}
              </nav>
              <p className="fine">
                <Link href="/legal/terms">利用規約</Link>・
                <Link href="/legal/privacy">プライバシーポリシー</Link>
              </p>
            </div>
          )}
          <h2>{user ? "保存した診断" : "このブラウザの診断"}</h2>
          {rows.length === 0 ? (
            <p>まだ診断はありません。</p>
          ) : (
            rows.map((r) => (
              <div className="history-row" key={r.id}>
                <Link
                  href={
                    r.status === "answering" || r.status === "followup"
                      ? "/diagnosis/partner-mind?resume=" + r.id
                      : "/result/" + r.id
                  }
                >
                  {new Date(r.created_at).toLocaleDateString("ja-JP")}の診断
                  {["answering", "followup"].includes(r.status)
                    ? "を続ける"
                    : "を見る"}
                </Link>
                {["paid", "report_generating", "report_ready"].includes(
                  r.status,
                ) && <Link href={"/report/" + r.id}>詳細レポート</Link>}
              </div>
            ))
          )}
          {more && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={nextPage}
            >
              さらに表示
            </button>
          )}
          <p>
            <Link href="/diagnosis/partner-mind?new=1">新しく無料診断する</Link>
          </p>
        </>
      )}
    </main>
  );
}
