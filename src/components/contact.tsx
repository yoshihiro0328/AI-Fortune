"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { responseTimeLabel } from "@/lib/display-copy";
import { request } from "@/lib/client";
export default function Contact({ responseTime }: { responseTime: string }) {
  const startedAt = useRef(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState(""),
    [mailQueued, setMailQueued] = useState(false);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const r = await request<{ id?: string; mailQueued?: boolean }>(
        "/api/contact",
        {
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
          website: data.get("website"),
          consent: data.get("consent") === "on",
          startedAt: startedAt.current,
        },
      );
      setReceipt(r.id ?? "受付済み");
      setMailQueued(!!r.mailQueued);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="flow">
      <p className="eyebrow">CONTACT / お問い合わせ</p>
      <h1>お困りのことを、お聞かせください。</h1>
      <p>
        診断や購入、データの取り扱いについてはこちらから。緊急の相談を受け付ける窓口ではありません。
      </p>
      <p className="fine">{responseTimeLabel(responseTime)}</p>
      {receipt ? (
        <div className="panel" role="status">
          <h2>お問い合わせを受け付けました。</h2>
          <p>受付番号：{receipt}</p>
          <p>
            {mailQueued
              ? "内容を保存し、受付メールの送信を手配しました。届かない場合も、この受付番号でお問い合わせ内容を確認できます。"
              : "内容を確認のうえ対応します。受付メールはお送りしていませんので、この受付番号をお控えください。"}
          </p>
        </div>
      ) : (
        <form className="panel" onSubmit={submit}>
          <label htmlFor="contact-name">お名前</label>
          <input
            id="contact-name"
            name="name"
            autoComplete="name"
            required
            maxLength={80}
          />
          <label htmlFor="contact-email">メールアドレス</label>
          <input
            id="contact-email"
            name="email"
            autoComplete="email"
            type="email"
            required
            maxLength={254}
          />
          <label htmlFor="contact-message">お問い合わせ内容</label>
          <textarea
            id="contact-message"
            name="message"
            required
            minLength={10}
            maxLength={5000}
          />
          <p className="fine">
            10〜5,000文字。パスワード・カード番号・第三者の個人情報は書かないでください。
          </p>
          <p className="fine">
            データの削除・退会をご希望の場合は、その旨と、分かれば対象の診断番号をお知らせください。本人確認のうえ対応します。
          </p>
          <div className="honeypot" aria-hidden="true">
            <label>
              Website
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <label className="choice">
            <input name="consent" type="checkbox" required />
            <span>
              <Link href="/legal/privacy">プライバシーポリシー</Link>
              を確認し、問い合わせ対応のための情報の利用に同意します。
            </span>
          </label>
          <button className="button" disabled={busy}>
            {busy ? "送信しています…" : "問い合わせを送る"}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
