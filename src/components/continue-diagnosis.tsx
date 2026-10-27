"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { accountReturnLink } from "@/lib/auth-return";
import { request } from "@/lib/client";
import type { SaveState } from "@/lib/save-state";
export default function ContinueDiagnosis({
  id,
  state,
}: {
  id: string;
  state?: SaveState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const target = "/consult?diagnosis=" + id;
  async function continueSaved() {
    setBusy(true);
    setError("");
    try {
      await request("/api/auth", { action: "claim" });
      const d = await request<{ saveState?: SaveState }>(
        "/api/diagnoses/" + id,
      );
      if (d.saveState !== "saved")
        throw new Error(
          "診断の保存状態を確認できません。マイページでご確認ください。",
        );
      router.push(target);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="diagnosis-continuation">
      {state === "unsaved" ? (
        <button
          className="button secondary"
          disabled={busy}
          onClick={continueSaved}
        >
          {busy ? "診断を保存しています…" : "この診断について相談する"}
        </button>
      ) : (
        <Link
          className="button secondary"
          href={state === "saved" ? target : accountReturnLink(target)}
        >
          この診断について相談する
        </Link>
      )}
      {state === "anonymous" && (
        <p className="fine">
          無料登録・ログイン後、この診断を保存して続けられます。
        </p>
      )}
      {state === "unsaved" && (
        <p className="fine">
          このブラウザの未保存診断をアカウントへ保存してから相談へ進みます。
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
