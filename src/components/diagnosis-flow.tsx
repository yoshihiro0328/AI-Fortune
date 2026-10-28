"use client";
import DiagnosisProgress from "./diagnosis-progress";
import ProgressNote from "./progress-note";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  request,
  track,
  isUnavailableDiagnosis,
  type Question,
  type Diagnosis,
} from "@/lib/client";
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
    [boot, setBoot] = useState(true),
    [unavailable, setUnavailable] = useState(false);
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
            if (!active) return;
            if (isUnavailableDiagnosis(e)) {
              // Clear only the inaccessible pointer, never the diagnosis or another tab's new pointer.
              if (localStorage.getItem("yorisoi_diagnosis") === saved)
                localStorage.removeItem("yorisoi_diagnosis");
              setUnavailable(true);
            } else setError((e as Error).message);
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
      setUnavailable(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function next() {
    const q = questions[index];
    if (!answers[q.question_key]?.trim()) {
      setError(
        ["radio", "select"].includes(q.question_type)
          ? "回答を選んでください。"
          : "回答を入力してください。",
      );
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
      <div className="eyebrow">質問に答えて整理 · ふたりの今と次の行動</div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {unavailable && (
        <aside className="notice" aria-label="前の診断について">
          <p>この診断は開けませんでした。新しく診断を始めることができます。</p>
          <p className="fine">
            保存済みの診断は、診断したときのブラウザか、保存したアカウントで確認してください。
          </p>
          <div className="actions">
            <a
              className="button secondary"
              href="/diagnosis/partner-mind?new=1"
            >
              新しく診断を始める
            </a>
            <Link className="button secondary" href="/account">
              ログインして確認する
            </Link>
          </div>
        </aside>
      )}
      {boot ? (
        <p role="status">質問を読み込んでいます…</p>
      ) : !started ? (
        <div className="panel diagnosis-intro">
          <h1>ふたりのことを、聞かせてください。</h1>
          <p className="fine">
            登録なしで利用できる無料診断です。詳細レポートの購入は任意です。
          </p>
          <p>
            ふたりの状況に合わせて、必要なことだけ聞いていきます。質問の数は回答内容によって変わります。分からないことは、そのまま教えてください。
          </p>
          <p className="fine">
            AIが回答を作るため、入力内容をOpenAIに送信します。氏名・住所・電話番号・メールアドレスなど、個人を特定できる情報は入力しないでください。ブラウザの保存情報（Cookie）を削除すると、アカウントに保存していない診断は開けなくなります。
          </p>
          <p className="fine">
            質問に回答し、必要な追加質問のあとに結果を確認します。「保存して次へ」で保存した回答は、同じブラウザから再開できます。入力中でまだ保存していない回答は残りません。
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
          <DiagnosisProgress
            index={index}
            count={questions.length}
            phase={q.phase}
            dynamic={v2}
            followup={follow}
          />
          <div className="panel">
            <h1 ref={heading} tabIndex={-1} id="question-title">
              {/[?？]$/.test(q.question_text) && q.question_text.length > 6 ? (
                <>
                  {Array.from(q.question_text).slice(0, -6).join("")}
                  <span className="question-ending">
                    {Array.from(q.question_text).slice(-6).join("")}
                  </span>
                </>
              ) : (
                q.question_text
              )}
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
