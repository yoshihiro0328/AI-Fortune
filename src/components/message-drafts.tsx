"use client";
import { useState } from "react";
import { messageDraft } from "../lib/message-draft";
import type { PaidReport } from "../lib/ai/schemas";

export function MessageDraftCard({
  title,
  message,
  note,
}: {
  title: string;
  message: string | null;
  note?: string;
}) {
  const [notice, setNotice] = useState("");
  async function copy() {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(message);
      setNotice("文面だけをコピーしました");
    } catch {
      setNotice("コピーできませんでした。文面を選択してコピーしてください。");
    }
  }
  return (
    <section className="message-draft" aria-label={title}>
      <h3>{title}</h3>
      {note && (
        <div className="fine message-note" style={{ whiteSpace: "pre-wrap" }}>
          <strong>送る前に確認</strong>
          <p>{note}</p>
        </div>
      )}
      {message ? (
        <>
          <p className="message" style={{ whiteSpace: "pre-wrap" }}>
            {message}
          </p>
          <button type="button" className="button secondary" onClick={copy}>
            文面だけをコピー
          </button>
        </>
      ) : (
        <p className="fine">
          送る文面を一つに特定できないため、自動コピーは表示していません。
        </p>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}

export default function MessageDrafts({
  messages,
}: {
  messages: PaidReport["messages"];
}) {
  return (
    <div className="message-drafts">
      {(
        [
          ["自然に", messages.natural],
          ["少し積極的に", messages.proactive],
          ["距離を保ちながら", messages.respectful_distance],
        ] as const
      ).map(([title, source]) => (
        <MessageDraftCard
          key={title + source}
          title={title}
          {...messageDraft(source)}
        />
      ))}
    </div>
  );
}
