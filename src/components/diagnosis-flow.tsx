"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { request, track, type Question, type Diagnosis } from "@/lib/client";
export default function DiagnosisFlow() {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]),
    [id, setId] = useState(""),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [index, setIndex] = useState(0),
    [started, setStarted] = useState(false),
    [follow, setFollow] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [boot, setBoot] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const qs = await request<Question[]>("/api/questions");
        if (!active) return;
        setQuestions(qs);
        track("page_view");
        const saved = localStorage.getItem("yorisoi_diagnosis");
        if (saved) {
          try {
            const d = await request<Diagnosis>("/api/diagnoses/" + saved);
            if (!active) return;
            if (d.free_report || d.status === "safety") {
              router.replace("/result/" + saved);
              return;
            }
            setId(saved);
            setAnswers(
              Object.fromEntries(
                d.answers.map((a) => [a.question_key, a.answer_text]),
              ),
            );
            const list = d.followup.length ? d.followup : qs;
            setQuestions(list);
            setFollow(!!d.followup.length);
            setIndex(
              Math.max(
                0,
                list.findIndex(
                  (q) =>
                    !d.answers.some((a) => a.question_key === q.question_key),
                ),
              ),
            );
            setStarted(true);
            setConsent(true);
          } catch {
            localStorage.removeItem("yorisoi_diagnosis");
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (active) setBoot(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);
  useEffect(() => {
    heading.current?.focus();
  }, [index, started]);
  async function start() {
    setBusy("診断を準備しています");
    setError("");
    try {
      const d = await request<{ id: string }>("/api/diagnoses", {});
      localStorage.setItem("yorisoi_diagnosis", d.id);
      setId(d.id);
      setStarted(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function next() {
    const q = questions[index];
    if (!answers[q.question_key]?.trim()) {
      setError("回答を入力してください。");
      return;
    }
    setError("");
    setBusy("回答を保存しています");
    try {
      await request("/api/diagnoses/" + id + "/answers", {
        key: q.question_key,
        answer: answers[q.question_key],
      });
      if (index < questions.length - 1) {
        setIndex(index + 1);
        return;
      }
      setBusy("回答をもとに、AIが状況を整理しています");
      const result = await request<{ status: string }>(
        "/api/diagnoses/" + id + "/analyze",
        {},
      );
      if (result.status === "followup") {
        const d = await request<Diagnosis>("/api/diagnoses/" + id);
        setQuestions(d.followup);
        setFollow(true);
        setIndex(0);
      } else router.push("/result/" + id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const q = questions[index];
  return (
    <main id="main" className="flow">
      <div className="eyebrow">PARTNER MIND / 相手の心理診断</div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {boot ? (
        <p role="status">質問を読み込んでいます…</p>
      ) : !started ? (
        <div className="panel">
          <h1>
            少しだけ、ふたりのことを
            <br />
            聞かせてください。
          </h1>
          <p>約10問・約3分。必要に応じて、最大3問の追加質問があります。</p>
          <p className="fine">
            回答は分析のためOpenAIに送信します。氏名、住所、連絡先などは書かないでください。この端末のCookieを削除すると、会員登録前の診断には戻れなくなります。
          </p>
          <label className="choice">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            18歳以上で、<Link href="/legal/terms">利用規約</Link>と
            <Link href="/legal/privacy">プライバシーポリシー</Link>
            に同意します。
          </label>
          <button
            className="button"
            disabled={!consent || !!busy || !questions.length}
            onClick={start}
          >
            診断を始める
          </button>
        </div>
      ) : q ? (
        <>
          <div className="meta">
            {follow ? "追加の質問" : "質問"} {index + 1} / {questions.length}
          </div>
          <progress
            className="progress"
            max={questions.length}
            value={index + 1}
            aria-label="診断の進捗"
          />
          <div className="panel">
            <h1 ref={heading} tabIndex={-1} id="question-title">
              {q.question_text}
            </h1>
            <fieldset
              disabled={!!busy}
              style={{ border: 0, padding: 0 }}
              aria-labelledby="question-title"
            >
              {["radio", "select"].includes(q.question_type) ? (
                q.options_json.map((o) => (
                  <label className="choice" key={o}>
                    <input
                      type="radio"
                      name={q.question_key}
                      checked={answers[q.question_key] === o}
                      value={o}
                      onChange={() =>
                        setAnswers({ ...answers, [q.question_key]: o })
                      }
                    />
                    {o}
                  </label>
                ))
              ) : q.question_type === "textarea" ? (
                <>
                  <textarea
                    aria-labelledby="question-title"
                    maxLength={2000}
                    placeholder={
                      q.placeholder ?? "分かる範囲で教えてください。"
                    }
                    value={answers[q.question_key] ?? ""}
                    onChange={(e) =>
                      setAnswers({
                        ...answers,
                        [q.question_key]: e.target.value,
                      })
                    }
                  />
                  <div className="fine">
                    {(answers[q.question_key] ?? "").length} / 2,000文字
                  </div>
                </>
              ) : (
                <input
                  aria-labelledby="question-title"
                  type={q.question_type}
                  value={answers[q.question_key] ?? ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [q.question_key]: e.target.value })
                  }
                />
              )}
            </fieldset>
            <div className="actions">
              <button
                className="button secondary"
                disabled={!!busy || index === 0}
                onClick={() => {
                  setIndex(index - 1);
                  setError("");
                }}
              >
                戻る
              </button>
              <button className="button" disabled={!!busy} onClick={next}>
                {index === questions.length - 1
                  ? "回答を保存して分析"
                  : "保存して次へ"}
              </button>
            </div>
            <p className="fine">
              「保存して次へ」で回答を保存。途中で閉じても、このブラウザから再開できます。
            </p>
          </div>
        </>
      ) : null}
      {busy && (
        <p role="status">
          <span className="loading" /> {busy}。画面を閉じずにお待ちください。
        </p>
      )}
    </main>
  );
}
