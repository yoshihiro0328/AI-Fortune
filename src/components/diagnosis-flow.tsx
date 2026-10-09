"use client";
import { phaseLabels } from "@/lib/questions/labels";
import ProgressNote from "./progress-note";
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
    [v2, setV2] = useState(false),
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
        const qs = await request<Question[]>("/api/questions?flow=v2");
        if (!active) return;
        setQuestions(qs);
        track("page_view");
        const params = new URLSearchParams(location.search);
        const saved = params.has("new")
          ? null
          : (params.get("resume") ?? localStorage.getItem("yorisoi_diagnosis"));
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
            setV2(d.question_flow_version === "v2");
            const list =
              d.question_flow_version === "v2"
                ? (d.questions ?? [])
                : d.followup.length
                  ? d.followup
                  : await request<Question[]>("/api/questions");
            setQuestions(list);
            setFollow(!!d.followup.length);
            setIndex(
              Math.max(
                list.every((q) =>
                  d.answers.some((a) => a.question_key === q.question_key),
                )
                  ? list.length - 1
                  : 0,
                list.findIndex(
                  (q) =>
                    !d.answers.some((a) => a.question_key === q.question_key),
                ),
              ),
            );
            setStarted(true);
            setConsent(true);
          } catch (e) {
            setError((e as Error).message);
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
      window.history.replaceState(
        null,
        "",
        "/diagnosis/partner-mind?resume=" + d.id,
      );
      const state = await request<Diagnosis>("/api/diagnoses/" + d.id);
      setQuestions(state.questions ?? questions);
      setV2(state.question_flow_version === "v2");
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
      const saved = await request<{ status?: string }>(
        "/api/diagnoses/" + id + "/answers",
        {
          key: q.question_key,
          answer: answers[q.question_key],
        },
      );
      if (saved.status === "safety") {
        router.push("/result/" + id);
        return;
      }
      if (v2) {
        const d = await request<Diagnosis>("/api/diagnoses/" + id);
        const list = d.questions ?? [];
        setQuestions(list);
        setAnswers(
          Object.fromEntries(
            d.answers.map((a) => [a.question_key, a.answer_text]),
          ),
        );
        if (index < list.length - 1) {
          setIndex(index + 1);
          return;
        }
      }
      if (!v2 && index < questions.length - 1) {
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
        const list = v2 ? (d.questions ?? []) : d.followup;
        setQuestions(list);
        setFollow(true);
        setIndex(
          Math.max(
            0,
            list.findIndex(
              (q) => !d.answers.some((a) => a.question_key === q.question_key),
            ),
          ),
        );
      } else router.push("/result/" + id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const q = questions[index];
  useEffect(() => {
    if (id && v2 && q)
      void request("/api/diagnoses/" + id + "/question-view", {
        key: q.question_key,
      }).catch(() => {});
  }, [id, v2, q]);
  useEffect(() => {
    if (!id || !started) return;
    const abandon = () => {
      if (document.visibilityState === "hidden")
        void fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "diagnosis_abandoned", id }),
          keepalive: true,
        }).catch(() => {});
    };
    document.addEventListener("visibilitychange", abandon);
    return () => document.removeEventListener("visibilitychange", abandon);
  }, [id, started]);
  return (
    <main id="main" className="flow">
      <div className="eyebrow">無料診断 · ふたりの今を整理する</div>
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
          <p>
            ふたりの状況に合わせて、必要なことだけ聞いていきます。目安は12〜18問ほどです。分からないことは、そのまま教えてください。
          </p>
          <p className="fine">
            AIが回答を作るため、入力内容をOpenAIに送信します。氏名・住所・電話番号・メールアドレスなど、個人を特定できる情報は入力しないでください。ブラウザの保存情報（Cookie）を削除すると、アカウントに保存していない診断は開けなくなります。
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
            {v2
              ? phaseLabels[q.phase ?? "common"]
              : follow
                ? "最終確認"
                : "基本情報"}
          </div>
          <progress
            className="progress"
            max={4}
            value={
              v2
                ? ["common", "relationship", "concern", "ai_followup"].indexOf(
                    q.phase ?? "common",
                  ) + 1
                : follow
                  ? 4
                  : 1
            }
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
                {v2
                  ? "保存して次へ"
                  : index === questions.length - 1
                    ? "回答を保存して分析"
                    : "保存して次へ"}
              </button>
            </div>
            <p className="fine">
              「保存して次へ」を押すと回答が保存されます。途中で閉じても、このブラウザから再開できます。
            </p>
          </div>
        </>
      ) : null}
      {busy.includes("AI") ? (
        <ProgressNote label={busy} />
      ) : (
        busy && (
          <p role="status">
            <span className="loading" /> {busy}。画面を閉じずにお待ちください。
          </p>
        )
      )}
    </main>
  );
}
