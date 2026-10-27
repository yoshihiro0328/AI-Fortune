"use client";
import { useState } from "react";
export default function ConsultationAnswer({
  text,
  safety,
}: {
  text: string;
  safety: boolean;
}) {
  const [full, setFull] = useState(false);
  const paragraphs = text.split(/\n\s*\n/);
  const opening = paragraphs[0];
  const stop = text.indexOf("。");
  const excerpt =
    opening.length < text.length
      ? opening
      : text.slice(0, stop >= 0 && stop < text.length - 1 ? stop + 1 : 240);
  const collapsible =
    !safety && text.length > 500 && excerpt.length < text.length;
  return (
    <div className="consult-answer-text">
      {collapsible && (
        <p className="fine">
          {full ? "回答の全文" : "回答の冒頭（抜粋）"} —
          AIによる新たな要約ではありません。
        </p>
      )}
      <p>{collapsible && !full ? excerpt : text}</p>
      {collapsible && (
        <button
          className="text-button"
          type="button"
          aria-expanded={full}
          onClick={() => setFull(!full)}
        >
          {full ? "冒頭だけに戻す" : "回答の全文を読む"}
        </button>
      )}
    </div>
  );
}
