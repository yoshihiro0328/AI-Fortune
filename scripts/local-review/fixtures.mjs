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
  const paragraph =
    "【合成表示・実利用者の情報ではありません】架空の二人は以前より連絡の間隔が空き、次の予定についてまだ話せていない設定です。返信が来た事実と、理由が分からない部分を分けて表示します。相手の気持ちや今後の結果は、この表示例からは判断できません。これは文章量・改行・読みやすさを確認するための固定データであり、実際の助言ではありません。";
  report.relationship_analysis = paragraph + "\n\n" + paragraph;
  report.behavior_patterns = paragraph;
  report.distance_reasons = [
    paragraph,
    "【合成】生活や予定の変化については確認されていません。",
  ];
  report.positive_signals = [
    { signal: "【合成】会話が続いている", reason: paragraph },
  ];
  report.attention_signals = [
    { signal: "【合成】予定が未確定", reason: paragraph },
  ];
  report.contact_advice = paragraph;
  report.overall_advice = paragraph;
  report.seven_day_plan = [
    {
      period: "1〜2日目（合成）",
      action:
        "【合成表示】最近のやり取りを、確認できる出来事と未確認のことに分けてメモするという架空の例です。実際の行動を指示するものではありません。",
    },
    { period: "3〜7日目（合成）", action: paragraph },
  ];
  report.thirty_day_plan = [
    { period: "2週目（合成）", action: paragraph },
    { period: "3〜4週目（合成）", action: paragraph },
  ];
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
  const now = new Date().toISOString();
  const tokyo = new Date(Date.now() + 9 * 3600e3);
  const start = new Date(
    Date.UTC(tokyo.getUTCFullYear(), tokyo.getUTCMonth(), 1) - 9 * 3600e3,
  ).toISOString();
  const end = new Date(
    Date.UTC(tokyo.getUTCFullYear(), tokyo.getUTCMonth() + 1, 1) - 9 * 3600e3,
  ).toISOString();
  let mode = "free",
    answers = [],
    finished = false,
    turns = [],
    trial = null,
    manualEvents = [];
  const subjects = [
    {
      id: "sample-person",
      nickname:
        "サンプルAさん（以前から同じ趣味について話している架空の知人・長い名前の表示確認）",
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
  subjects.push({
    id: "sample-person-b",
    nickname: "サンプルBさん（別の架空の相手）",
    memory: [],
    updated_at: now,
    memory_reset_at: null,
  });
  subjects.push({
    id: "sample-person-c",
    nickname: "サンプルCさん（会話なし）",
    memory: [],
    updated_at: now,
    memory_reset_at: null,
  });
  const threads = [
    {
      id: "sample-thread",
      subject_id: "sample-person",
      title: "連絡のタイミング（合成）",
      updated_at: now,
    },
  ];
  threads.push({
    id: "sample-thread-b",
    subject_id: "sample-person-b",
    title: "週末の予定（合成）",
    updated_at: now,
  });
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
    ownerId: "sample-owner",
    subjects: mode === "empty" ? [] : subjects,
    threads: mode === "empty" ? [] : threads,
    links: [{ diagnosis_id: "sample-result", subject_id: "sample-person-b" }],
    usage: {
      plan: ["plus", "scheduled"].includes(mode) ? "plus" : "free",
      limit: ["plus", "scheduled"].includes(mode) ? 30 : 3,
      used: 1,
      reserved: 0,
      remaining: ["plus", "scheduled"].includes(mode) ? 29 : 2,
      period_start: start,
      period_end: end,
    },
    subscription: ["plus", "scheduled", "canceled"].includes(mode)
      ? {
          id: "sample-contract",
          amount: 980,
          status: ["plus", "scheduled"].includes(mode) ? "active" : "canceled",
          period_end: end,
          ended_at: mode === "canceled" ? now : null,
          paid_through: ["plus", "scheduled"].includes(mode) ? end : null,
          cancel_at_period_end: mode === "scheduled",
          cancel_at: null,
        }
      : null,
    hasBilling: ["plus", "scheduled", "canceled"].includes(mode),
  });
  const diagnosis = (id) => ({
    id,
    saveState:
      mode === "anonymous"
        ? "anonymous"
        : mode === "unsaved"
          ? "unsaved"
          : "saved",
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
      if (
        ![
          "free",
          "unsaved",
          "plus",
          "scheduled",
          "canceled",
          "anonymous",
          "empty",
        ].includes(value)
      )
        return false;
      mode = value;
      manualEvents = [];
      answers = [];
      finished = false;
      trial = null;
      seedTurns();
      return true;
    },
    handle(method, url, b = {}) {
      const p = url.pathname,
        ok = (data) => ({ status: 200, data });
      if (
        p === "/api/auth" &&
        method === "POST" &&
        b.action === "claim" &&
        mode === "unsaved"
      ) {
        mode = "free";
        return ok({ ok: true, count: 1 });
      }
      if (p === "/api/auth" && method === "POST" && b.action === "logout") {
        mode = "anonymous";
        return ok({ ok: true });
      }
      if (p === "/api/auth")
        return method === "GET"
          ? ok({
              user:
                mode === "anonymous"
                  ? null
                  : { email: "sample@example.invalid", confirmed: true },
              recovery: false,
              hasUnsaved: mode === "unsaved",
            })
          : denied;
      if (p === "/api/questions" && method === "GET") return ok(questions);
      if (p === "/api/events") return ok({ ok: true, synthetic: true });
      if (p === "/api/plans" && method === "GET")
        return ok({ free_limit: 3, plus_limit: 30 });
      if (p === "/api/diagnoses")
        return method === "GET"
          ? ok(
              ["anonymous", "empty"].includes(mode)
                ? []
                : [
                    {
                      id: "sample-result",
                      status: "report_ready",
                      created_at: now,
                    },
                    {
                      id: "sample-draft",
                      status: "answering",
                      created_at: now,
                    },
                  ],
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
        return ok({
          status: "ready",
          report,
          attempts: 0,
          saveState:
            mode === "anonymous"
              ? "anonymous"
              : mode === "unsaved"
                ? "unsaved"
                : "saved",
        });
      if (p === "/api/consultations" && method === "GET") {
        if (mode === "anonymous")
          return {
            status: 401,
            data: {
              error:
                "未ログイン状態の合成表示です。上の切替で無料会員またはPlusを選んでください。",
            },
          };
        if (url.searchParams.has("thread")) {
          const thread = threads.find(
            (t) => t.id === url.searchParams.get("thread"),
          );
          if (!thread)
            return { status: 404, data: { error: "合成の相談がありません。" } };
          return ok({
            thread,
            subject: subjects.find((s) => s.id === thread.subject_id),
            turns: turns.filter((t) => t.thread_id === thread.id),
            hasMore: false,
          });
        }
        return ok(home());
      }
      if (
        p === "/api/consultations" &&
        method === "POST" &&
        b.action === "create_thread"
      ) {
        if (mode === "anonymous")
          return { status: 401, data: { error: "合成の未ログイン状態です。" } };
        const subject = subjects.find((s) => s.id === b.subject);
        if (!subject)
          return { status: 404, data: { error: "相談相手がありません。" } };
        const thread = {
          id: "sample-thread-" + (threads.length + 1),
          subject_id: subject.id,
          title: "新しい合成相談",
          created_at: now,
          updated_at: now,
        };
        threads.push(thread);
        return ok(thread);
      }
      if (
        p === "/api/consultations" &&
        method === "POST" &&
        b.action === "search"
      ) {
        const query = String(b.query).toLowerCase();
        return ok({
          threads: threads.filter((t) =>
            [
              t.title,
              subjects.find((s) => s.id === t.subject_id)?.nickname,
              ...turns
                .filter((v) => v.thread_id === t.id)
                .flatMap((v) => [v.user_text, v.assistant_text]),
            ].some((v) => v?.toLowerCase().includes(query)),
          ),
        });
      }
      if (p === "/api/consultation-events" && mode !== "anonymous") {
        if (method === "GET")
          return ok({
            events: manualEvents.filter(
              (e) => e.subject_id === url.searchParams.get("subject"),
            ),
          });
        const old = manualEvents.find((e) => e.id === b.id);
        if (method === "POST" && !old) {
          const event = {
            id: b.id,
            subject_id: b.subject,
            event_date: b.date,
            text: b.text,
            source_type: "manual",
            revision: 1,
          };
          manualEvents.push(event);
          return ok({ event });
        }
        if (!old || old.revision !== b.revision)
          return { status: 409, data: { error: "合成の更新競合です。" } };
        if (method === "PATCH") {
          Object.assign(old, {
            event_date: b.date,
            text: b.text,
            revision: old.revision + 1,
          });
          return ok({ event: old });
        }
        if (method === "DELETE") {
          manualEvents = manualEvents.filter((e) => e.id !== b.id);
          return ok({ event: { id: b.id, deleted: true } });
        }
      }
      if (
        /^\/api\/consultations\/sample-thread(?:-[a-z0-9]+)?\/send$/.test(p) &&
        method === "POST"
      ) {
        if (mode === "anonymous")
          return { status: 401, data: { error: "合成の未ログイン状態です。" } };
        if (typeof b.text !== "string" || b.text.length > 4000)
          return {
            status: 400,
            data: {
              error: "合成の相談文を1〜4000文字で入力してください。",
              code: "INPUT_REJECTED",
            },
          };
        if (turns.length >= 100)
          return {
            status: 429,
            data: {
              error:
                "合成履歴の上限です。上部の状態切替でリセットしてください。",
            },
          };
        const prior = turns.find(
          (t) => t.id === b.requestId && t.thread_id === p.split("/")[3],
        );
        if (prior)
          return prior.user_text === b.text
            ? ok({ ok: true, synthetic: true })
            : { status: 409, data: { error: "合成の送信内容が異なります。" } };
        turns.push({
          id: b.requestId ?? "sample-turn-" + turns.length,
          thread_id: p.split("/")[3],
          user_text: b.text,
          assistant_text:
            "【合成の固定回答・AI未使用】これは返信文の表示・コピー確認用の固定例です。相手と話したい場合の例として確認してください。\n【送信用文面】\n少し話せる時間はある？ 難しければ断って大丈夫だよ。\n【文面ここまで】\n返事を急かすための文面ではありません。",
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
          ["plus", "scheduled", "canceled"].includes(mode)
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
            "【合成の固定回答・AI未使用】これは表示確認用の固定例です。\n【送信用文面】\n元気だよ。そちらは最近どう？\n【文面ここまで】\n実際に元気だと伝えたい場合の例です。",
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
