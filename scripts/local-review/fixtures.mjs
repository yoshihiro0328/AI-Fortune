import fs from "node:fs";
export function createFixture(root) {
  const questions = JSON.parse(
    fs.readFileSync(root + "/tests/fixtures/dynamic-catalog.json", "utf8"),
  )
    .filter((q) => q.phase === "common")
    .slice(0, 10);
  const report = JSON.parse(
    fs.readFileSync(
      root + "/scripts/phase6/payment-report-fixture.json",
      "utf8",
    ),
  );
  report.messages = {
    natural:
      "補足：相手の都合を尊重する表示例です。\n「またゆっくり話せたらうれしい。都合のよいときに教えてね。」\n返事を急がせない想定です。",
    proactive: "補足：架空の提案です。\n「来週、都合が合えばお茶でもどう？」",
    respectful_distance:
      "補足：距離を置きたい意思を尊重します。\n「今はゆっくり過ごしてね。こちらからの連絡は控えるね。」",
  };
  const free = {
    summary:
      "【合成表示】連絡の間隔が変わり、次の声のかけ方を迷っている架空の状況です。",
    positive_signals: [
      {
        signal: "会話は続いている",
        reason: "架空の回答では、返信と次の予定の話があります。",
      },
    ],
    attention_signals: [
      {
        signal: "返信の速さだけでは判断できない",
        reason: "相手の事情や希望はまだ分かりません。",
      },
    ],
    scores: {
      relationship_stability: 55,
      communication: 60,
      improvement_potential: 65,
    },
    uncertainties: [
      "相手の予定や連絡に対する希望は未確認です。数値は100点満点の表示例で、確率・客観的精度ではありません。",
    ],
    advice:
      "【固定の表示例】一度だけ都合を尋ね、返事を待つ時間をとることが考えられます。",
  };
  const now = new Date().toISOString(),
    end = new Date(Date.now() + 14 * 864e5).toISOString();
  let mode = "free",
    answers = [],
    finished = false,
    turns = [],
    trial = null;
  const subjects = [
    {
      id: "sample-person",
      nickname: "サンプルAさん",
      memory: [
        {
          kind: "concern",
          quote: "連絡するタイミングに迷っている（架空）",
          source: "synthetic",
          at: now,
        },
      ],
      updated_at: now,
      memory_reset_at: null,
    },
  ];
  const threads = [
    {
      id: "sample-thread",
      subject_id: "sample-person",
      title: "連絡のタイミング（合成）",
      updated_at: now,
    },
  ];
  function seedTurns() {
    turns = [
      {
        id: "sample-turn",
        thread_id: "sample-thread",
        user_text:
          "最近返信がゆっくりになり、どう声をかけるか迷っています。（合成）",
        assistant_text:
          "【合成の固定回答】返信の速さだけでは相手の気持ちは分かりません。今確認できる出来事と、まだ分からないことを分けて考えてみましょう。",
        status: "ready",
        safety: false,
        generation: 1,
        facts: [],
        created_at: now,
      },
    ];
  }
  seedTurns();
  const home = () => ({
    subjects,
    threads,
    links: [],
    usage: {
      plan: mode === "plus" ? "plus" : "free",
      limit: mode === "plus" ? 30 : 3,
      used: 1,
      reserved: 0,
      remaining: mode === "plus" ? 29 : 2,
      period_start: now,
      period_end: end,
    },
    subscription: ["plus", "canceled"].includes(mode)
      ? {
          id: "sample-contract",
          amount: 980,
          status: mode === "plus" ? "active" : "canceled",
          period_end: end,
          ended_at: mode === "canceled" ? now : null,
          paid_through: mode === "plus" ? end : null,
          cancel_at_period_end: false,
          cancel_at: null,
        }
      : null,
    hasBilling: ["plus", "canceled"].includes(mode),
  });
  const diagnosis = (id) => ({
    id,
    status: finished || id === "sample-result" ? "ready" : "answering",
    answers,
    followup: [],
    question_flow_version: "v2",
    questions,
    free_report: finished || id === "sample-result" ? free : null,
    payment_status: "paid",
  });
  const denied = {
    status: 403,
    data: {
      error:
        "ローカル確認では実AI生成・購入・契約変更・メール送信は無効です。外部への送信はありません。",
    },
  };
  return {
    get mode() {
      return mode;
    },
    reset(value) {
      if (!["free", "plus", "canceled", "anonymous"].includes(value))
        return false;
      mode = value;
      answers = [];
      finished = false;
      trial = null;
      seedTurns();
      return true;
    },
    handle(method, url, b = {}) {
      const p = url.pathname,
        ok = (data) => ({ status: 200, data });
      if (p === "/api/auth")
        return method === "GET"
          ? ok({
              user:
                mode === "anonymous"
                  ? null
                  : { email: "sample@example.invalid", confirmed: true },
              recovery: false,
            })
          : denied;
      if (p === "/api/questions" && method === "GET") return ok(questions);
      if (p === "/api/events") return ok({ ok: true, synthetic: true });
      if (p === "/api/plans" && method === "GET")
        return ok({ free_limit: 3, plus_limit: 30 });
      if (p === "/api/diagnoses")
        return method === "GET"
          ? ok(
              mode === "anonymous"
                ? []
                : [{ id: "sample-result", status: "ready", created_at: now }],
            )
          : method === "POST"
            ? ((answers = []), (finished = false), ok({ id: "sample-draft" }))
            : denied;
      if (
        /^\/api\/diagnoses\/(sample-result|sample-draft)$/.test(p) &&
        method === "GET"
      )
        return ok(diagnosis(p.split("/").at(-1)));
      if (p === "/api/diagnoses/sample-draft/answers" && method === "POST") {
        if (
          !questions.some((q) => q.question_key === b.key) ||
          typeof b.answer !== "string" ||
          b.answer.length > 2000
        )
          return {
            status: 400,
            data: { error: "合成の回答を入力してください。" },
          };
        answers = answers
          .filter((a) => a.question_key !== b.key)
          .concat({ question_key: b.key, answer_text: b.answer });
        return ok({ status: "answering" });
      }
      if (p === "/api/diagnoses/sample-draft/analyze" && method === "POST") {
        finished = true;
        return ok({ status: "ready", synthetic: true });
      }
      if (
        /^\/api\/diagnoses\/(sample-result|sample-draft)\/question-view$/.test(
          p,
        )
      )
        return ok({ ok: true });
      if (
        /^\/api\/diagnoses\/(sample-result|sample-draft)\/report$/.test(p) &&
        method === "GET"
      )
        return ok({ status: "ready", report, attempts: 0 });
      if (p === "/api/consultations" && method === "GET") {
        if (mode === "anonymous")
          return {
            status: 401,
            data: {
              error:
                "未ログイン状態の合成表示です。上の切替で無料会員またはPlusを選んでください。",
            },
          };
        if (url.searchParams.has("thread"))
          return ok({
            thread: threads[0],
            subject: subjects[0],
            turns,
            hasMore: false,
          });
        return ok(home());
      }
      if (p === "/api/consultations/sample-thread/send" && method === "POST") {
        if (mode === "anonymous")
          return { status: 401, data: { error: "合成の未ログイン状態です。" } };
        if (typeof b.text !== "string" || b.text.length > 2000)
          return {
            status: 400,
            data: { error: "合成の相談文を入力してください。" },
          };
        if (turns.length >= 100)
          return {
            status: 429,
            data: {
              error:
                "合成履歴の上限です。上部の状態切替でリセットしてください。",
            },
          };
        turns.push({
          id: "sample-turn-" + turns.length,
          thread_id: "sample-thread",
          user_text: b.text,
          assistant_text:
            "【合成の固定回答・AI未使用】画面操作を確認できました。実機能では、この位置に相談内容に沿った回答が表示されます。",
          status: "ready",
          safety: false,
          generation: 1,
          facts: [],
          created_at: now,
        });
        return ok({ ok: true, synthetic: true });
      }
      if (p === "/api/billing") {
        if (method === "GET")
          return ok({
            subscription: home().subscription,
            invoices: [],
            usage: home().usage,
          });
        if (
          method === "POST" &&
          b.action === "portal" &&
          ["plus", "canceled"].includes(mode)
        )
          return ok({ url: "/__review/portal" });
        return denied;
      }
      if (p === "/api/trial/session" && method === "GET")
        return ok({
          active: true,
          enabled: true,
          maxLength: 800,
          remaining: trial ? 0 : 1,
          ...(trial ? { turn: trial } : {}),
        });
      if (p === "/api/trial/turns" && method === "POST") {
        trial = {
          status: "ready",
          input: {
            topicId: typeof b.topicId === "string" ? b.topicId : "general",
            fields: b.fields ?? {},
            text:
              typeof b.text === "string" ? b.text.slice(0, 800) : "合成の相談",
          },
          answer:
            "【合成の固定回答・AI未使用】相手の気持ちは断定できません。分かっている出来事から、次の一歩を一緒に整理する表示例です。",
          safety: false,
        };
        return ok({
          active: true,
          enabled: true,
          maxLength: 800,
          remaining: 0,
          turn: trial,
        });
      }
      return denied;
    },
  };
}
