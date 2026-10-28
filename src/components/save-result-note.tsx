"use client";
import Link from "next/link";
import { useState } from "react";
import { request } from "@/lib/client";
import { accountReturnLink } from "@/lib/auth-return";
import type { SaveState } from "@/lib/save-state";
export default function SaveResultNote({
  state,
  returnTo = "/consult",
  onSaved,
}: {
  state?: SaveState;
  returnTo?: string;
  onSaved?: () => void;
}) {
  const [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!state)
    return (
      <aside className="notice save-note">
        保存状態を確認できません。
        <Link className="button secondary" href="/account">
          マイページで確認する
        </Link>
      </aside>
    );
  if (state === "saved" || saved)
    return (
      <aside className="notice save-note" aria-label="結果の保存について">
        <p>保存済み — このアカウントのマイページから読み返せます。</p>
        <Link className="button secondary" href="/account#diagnosis-history">
          保存した診断・レポートを見る
        </Link>
      </aside>
    );
  async function save() {
    setBusy(true);
    setError("");
    try {
      await request("/api/auth", { action: "claim" });
      const current = await request<{ saveState?: SaveState }>(
        "/api/diagnoses/" + returnTo.split("/").pop(),
      );
      if (current.saveState !== "saved")
        throw new Error(
          "保存状態を確認できません。マイページで確認してください。",
        );
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="notice save-note" aria-label="結果の保存について">
      <p>
        未保存 —{" "}
        {state === "anonymous"
          ? "登録・ログインすると、この診断をアカウントへ保存できます（登録は任意）。"
          : "ログイン済みです。この診断をアカウントへ保存してください。"}
      </p>
      <p className="fine">
        保存前にブラウザの保存情報（Cookie）を削除したり、別のブラウザや端末へ移ったりすると、購入したレポートも開けなくなることがあります。URLの保存だけでは復元できません。
      </p>
      {state === "anonymous" ? (
        <Link className="button secondary" href={accountReturnLink(returnTo)}>
          登録・ログインして保存する
        </Link>
      ) : (
        <button className="text-button" disabled={busy} onClick={save}>
          {busy ? "保存しています…" : "この診断を保存する"}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
