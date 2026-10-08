"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { request, type Question } from "@/lib/client";
export default function PaidFollowup({
  id,
  questions,
  answers,
  onComplete,
}: {
  id: string;
  questions: Question[];
  answers: { question_key: string; answer_text: string }[];
  onComplete: () => Promise<void>;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      questions.findIndex(
        (q) => !answers.some((a) => a.question_key === q.question_key),
      ),
    ),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(answers.map((a) => [a.question_key, a.answer_text])),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const q = questions[index];
  useEffect(() => {
    if (q)
      void request("/api/diagnoses/" + id + "/question-view", {
        key: q.question_key,
      }).catch(() => {});
  }, [id, q]);
  async function next() {
    if (!values[q.question_key]?.trim()) {
      setError(
        "話せる範囲で教えてください。分からない場合は、そのまま書いて大丈夫です。",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await request<{ status?: string }>(
        "/api/diagnoses/" + id + "/answers",
        { key: q.question_key, answer: values[q.question_key] },
      );
      if (r.status === "safety") {
        router.push("/result/" + id);
        return;
      }
      if (index < questions.length - 1) setIndex(index + 1);
      else await onComplete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!q) return null;
  return (
    <section className="panel">
      <p>より具体的なアドバイスのため、あと少しだけ教えてください。</p>
      <p className="fine">
        {index + 1}問目・あと{questions.length - index}
        問です。追加料金はありません。
      </p>
      <h2 id="paid-question">{q.question_text}</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <textarea
        aria-labelledby="paid-question"
        maxLength={2000}
        disabled={busy}
        placeholder={q.placeholder ?? "覚えている範囲で大丈夫です。"}
        value={values[q.question_key] ?? ""}
        onChange={(e) =>
          setValues({ ...values, [q.question_key]: e.target.value })
        }
      />
      <div className="actions">
        <button
          className="button secondary"
          disabled={busy || index === 0}
          onClick={() => setIndex(index - 1)}
        >
          戻る
        </button>
        <button className="button" disabled={busy} onClick={next}>
          {busy
            ? "保存して準備しています…"
            : index === questions.length - 1
              ? "保存してレポートを作る"
              : "保存して次へ"}
        </button>
      </div>
      <p className="fine">
        回答は保存されます。途中で閉じても、このブラウザから再開できます。
      </p>
    </section>
  );
}
