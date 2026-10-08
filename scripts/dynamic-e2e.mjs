import { mkdir, readFile, writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
const origin = new URL(
  process.env.TEST_ORIGIN ??
    (process.env.TEST_BASE_URL?.startsWith("https://")
      ? base
      : process.env.NEXT_PUBLIC_APP_URL),
).origin;
const dir = "../../work/dynamic-e2e";
await mkdir(dir, { recursive: true });
const catalog = JSON.parse(
  await readFile("tests/fixtures/dynamic-catalog.json", "utf8"),
);
const cases = [
  [
    "dating_reply",
    "交際中",
    "返信が遅くなった",
    "ここ2週間、返信が翌日になることが増えました。会うと普段通りで、何が変わったのか気になります。",
  ],
  [
    "dating_breakup",
    "交際中",
    "別れそうで不安",
    "先週、言い合いの後で少し距離を置きたいと言われました。",
  ],
  [
    "crush_signals",
    "片思い",
    "好意があるのか分からない",
    "ランチではよく笑って話してくれますが、ふたりで会いたいのか分かりません。",
  ],
  [
    "crush_date",
    "片思い",
    "次に会う予定が決まらない",
    "食事に誘いましたが、今月は忙しいと言われました。",
  ],
  [
    "ex_reconcile",
    "元恋人",
    "復縁したい",
    "別れてから久しぶりに近況を聞く連絡が来ました。",
  ],
  [
    "app_once",
    "マッチングアプリで知り合った",
    "次に会う予定が決まらない",
    "先週1回会いました。楽しかったと言ってくれましたが、次の日はまだです。",
  ],
  [
    "app_three",
    "マッチングアプリで知り合った",
    "好意があるのか分からない",
    "これまで3回会い、前より自然に話せます。まだ付き合う話はしていません。",
  ],
  [
    "ambiguous",
    "はっきり付き合ってはいない",
    "ふたりの関係をはっきりさせたい",
    "夜遅く、相手の都合のよいときだけ連絡が来るのが気になります。",
  ],
  [
    "friend",
    "友人",
    "好意があるのか分からない",
    "最近ふたりでお茶をして、仕事の相談をされました。",
  ],
  [
    "busy",
    "交際中",
    "連絡が減った",
    "相手は新しい部署に移って忙しいと話していました。週末は電話してくれます。",
  ],
  [
    "conflict",
    "交際中",
    "態度が前より冷たく感じる",
    "先週、約束の時間に遅れたことで言い合いになりました。その後少し気まずいです。",
  ],
  [
    "initiates",
    "片思い",
    "好意があるのか分からない",
    "相手からよく近況を聞いてくれます。昨日も向こうからLINEが来ました。",
  ],
  [
    "no_violence",
    "交際中",
    "返信が遅くなった",
    "暴力はないです。殴られたことはありません。怖い思いもありません。ここ2週間返信が遅めです。",
  ],
  [
    "violence",
    "交際中",
    "別れそうで不安",
    "昨日殴られました。別れたら殺すと言われています。今は離れていますが怖いです。",
  ],
  [
    "contradiction",
    "交際中",
    "次に会う予定が決まらない",
    "毎週日曜に会っています。最後に会ったのは半年前で、その後は一度も会っていません。",
  ],
  [
    "enough",
    "交際中",
    "返信が遅くなった",
    "交際半年、毎週日曜に会います。2週間前から返信が3時間後から翌日に変わりましたが、内容は長く質問もあります。新部署の締切が今週金曜までと本人から聞きました。相手から土曜の昼にカフェを提案されています。ケンカはなく、会うと手をつないで話します。私は最後に「金曜まで忙しいんだね、無理せずね」と送り、相手は「土曜楽しみ」と返しました。連絡頻度は落ち着いたら相談しようと話しています。将来も一緒にいたいとお互い話します。追いLINEをしそうですが我慢できます。土曜に寂しさと応援する気持ちを伝えたいです。責め合う結果は避けたいです。",
  ],
  [
    "insufficient",
    "はっきり付き合ってはいない",
    "ふたりの関係をはっきりさせたい",
    "先週、ふたりの関係について話そうとしたら、今は難しいと言われました。その言葉の意味が気になります。",
  ],
  ["reload", "交際中", "返信が遅くなった", "最近、返事が前より遅く感じます。"],
  [
    "back",
    "片思い",
    "好意があるのか分からない",
    "ふたりでお茶に行きました。相手がどう思ったか気になります。",
  ],
];
const groupAnswers = {
  duration: "半年くらいです。",
  dating_length: "付き合って半年です。",
  meeting_frequency: "毎週日曜の午後に会っています。",
  affection: "会うと手をつないで、帰りに楽しかったと言ってくれます。",
  conflict:
    "先週の約束に10分遅れて言い合いになりました。謝って話は終わりました。",
  life_change: "新しい部署の仕事が今週金曜まで忙しいと本人から聞きました。",
  future: "落ち着いたら一緒に旅行したいと話しています。",
  meeting_change: "週に1回で、あまり変わっていません。",
  alone: "先週ふたりでカフェに行き、1時間くらい話しました。",
  invitation: "相手から先週お茶に誘ってくれました。",
  topics: "仕事や好きな音楽の話をして、私の近況も聞いてくれます。",
  partner: "相手は恋人はいないと言っていました。",
  romance: "好きな休日の過ごし方を話したくらいで、恋愛の話はまだです。",
  difference: "他の人への態度をよく見ていないので分かりません。",
  confide: "新しい仕事に慣れなくて疲れると話してくれました。",
  closeness: "隣に座って自然に笑って話せますが、恋愛の話にはなりません。",
  dates: "休日の昼にご飯を食べて散歩することが多いです。",
  timing: "金曜の夜10時くらいに急に誘われることが多いです。",
  convenience: "こちらが予定を聞いても相手の休みの日に合わせることが多いです。",
  relationship_talk:
    "先週、これからどうしたいか聞くと、今は決められないと言われました。",
  relationship_response:
    "今は仕事で余裕がなく、すぐには決められないと言われました。",
  introduction: "友達とは紹介されましたが、恋人とは言われていません。",
  boundary:
    "お互いの都合を大事にして、断っても気まずくならない関係がいいです。",
  breakup_time: "3か月前です。",
  breakup_who: "相手からでした。",
  breakup_reason: "仕事ですれ違い、会いたい日に会えず責め合ってしまいました。",
  improvement:
    "私は勤務時間が落ち着きました。相手の状況はまだ詳しく聞けていません。",
  last_words: "先週の返事は「忙しいけど元気だよ、ありがとう」でした。",
  after_date: "短いやり取りが毎日続いています。",
  meeting_mood: "仕事の話を聞き合い、相手からもよく質問してくれました。",
  scheduling:
    "こちらから日を出すことが多いですが、合わなければ別の日を提案してくれます。",
  before_date: "好きな食べ物や休日のことを毎日少しずつ話していました。",
  change_since: "2週間くらい前からです。",
  reply_before: "以前は3時間くらいで返ってきていました。",
  reply_now: "今は翌日の夜に返ってくることが多いです。",
  reply_content: "短くはなっていません。近況を聞く質問もあります。",
  contact_change: "毎日から週に2、3回くらいになりました。",
  channel_difference: "LINEは短いですが、会うといつも通り話してくれます。",
  invitation_response:
    "今週は忙しいけど、来週の日曜ならどうかな、と返ってきました。",
  alternative_date: "来週の日曜を提案してくれました。",
  past_talk: "楽しかった思い出は話しますが、別れた理由はまだ話していません。",
  reconciliation_talk: "まだ伝えていません。近況を聞くところから始めたいです。",
  source: "共通の友人から聞いたので、本人には確認していません。",
  other_history: "以前からの同僚だと聞いています。",
  asked: "責めるように聞きたくなくて、まだ話していません。",
  behavior_change: "こちらへの連絡は特に変わっていません。",
  request: "予定が変わるときは早めに教えてほしいと言われました。",
  context: "共通の友人を通して知り合いました。",
  comfort: "休日に一緒に散歩していると落ち着きます。",
  strain: "返事を待って何度もスマホを見てしまうのがしんどいです。",
  clarity: "無理のない連絡のペースを一緒に考えられるか知りたいです。",
  own_message:
    "昨日「今週大変そうだね、落ち着いたらお茶しない？」と送りました。",
  possible_date: "来週の日曜の午後なら私は空いています。",
  impulse: "返事が来ないと、もう一通送りたくなります。",
  tell: "忙しさを応援していることと、少し寂しいことを伝えたいです。",
  avoid: "責める言い方をして気まずくなるのは避けたいです。",
};
function answer(q, c) {
  const key = q.question_key;
  if (c[0] === "contradiction" && key.startsWith("dynamic_follow_"))
    return "毎週会っていたのは半年前までのことです。最後に会ったのは半年前で、それ以降は会っていません。";
  const defaults = {
    v2_relationship: c[1],
    v2_duration: "半年〜1年",
    v2_last_meeting: c[0] === "contradiction" ? "3か月以上前" : "1週間以内",
    v2_contact: "週に数回",
    v2_initiative:
      c[0] === "initiates" ? "相手から来ることが多い" : "だいたい半々",
    v2_next_meeting:
      c[0] === "enough" ? "日時まで決まっている" : "まだ決まっていない",
    v2_behavior: c[3],
    v2_concern: c[2],
    v2_goal:
      "相手の気持ちを決めつけず、無理なく会って話せる関係になりたいです。",
  };
  if (defaults[key]) return defaults[key];
  if (key === "app_count") return c[0] === "app_three" ? "3回以上" : "1回";
  if (q.options_json?.length) return q.options_json[0];
  const group = catalog.find((x) => x.question_key === key)?.followup_group;
  if (
    c[0] === "insufficient" &&
    ["relationship_talk", "relationship_response"].includes(group)
  )
    return "今は難しいと言われましたが、何が難しいのかはまだ聞けていません。";
  return (
    groupAnswers[group] ??
    "先週の日曜にカフェで会った時は笑って話せました。次は来週の日曜なら私は会えます。相手にはまだ日程を聞いていません。"
  );
}
async function run(c) {
  const file = dir + "/" + c[0] + ".json";
  let record;
  try {
    record = JSON.parse(await readFile(file, "utf8"));
  } catch {
    record = { name: c[0], case: c, steps: [] };
  }
  const save = () =>
    writeFile(file, JSON.stringify(record, null, 2), { mode: 0o600 });
  async function api(path, data, attempt = 0) {
    const res = await fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        origin,
        "content-type": "application/json",
        ...(record.cookie ? { cookie: record.cookie } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const cookie = res.headers.get("set-cookie");
    if (cookie) record.cookie = cookie.split(";")[0];
    const j = await res.json();
    if (res.status === 503 && path.endsWith("/analyze") && attempt < 2) {
      record.retries = (record.retries ?? 0) + 1;
      await save();
      return api(path, data, attempt + 1);
    }
    if (!res.ok) throw new Error(`${res.status} ${path} ${j.error}`);
    return j;
  }
  if (record.complete && !process.env.REVERIFY)
    return console.log("CACHED", c[0], record.count);
  try {
    if (!record.id) {
      record.id = (await api("/api/diagnoses", {})).id;
      await save();
    }
    const path = "/api/diagnoses/" + record.id;
    for (let round = 0; round < 5; round++) {
      let state = await api(path);
      if (state.status === "safety") {
        record.safety = true;
        record.complete = true;
        break;
      }
      if (state.free_report) {
        record.report = state.free_report;
        record.complete = true;
        record.count = state.answers.length;
        break;
      }
      for (const q of state.questions) {
        if (state.answers.some((a) => a.question_key === q.question_key))
          continue;
        const value = answer(q, c);
        await api(path + "/question-view", { key: q.question_key });
        const saved = await api(path + "/answers", {
          key: q.question_key,
          answer: value,
        });
        record.steps.push({
          question: q.question_text,
          key: q.question_key,
          phase: q.phase,
          answer: value,
        });
        await save();
        if (saved.status === "safety") {
          record.safety = true;
          record.complete = true;
          break;
        }
        if (c[0] === "reload" && q.question_key === "v2_contact") {
          const resumed = await api(path);
          if (
            !resumed.answers.some(
              (a) =>
                a.question_key === q.question_key && a.answer_text === value,
            )
          )
            throw new Error("reload lost answer");
          record.reload = true;
        }
      }
      if (record.safety) break;
      if (c[0] === "back" && !record.back && round === 1) {
        await api(path + "/answers", {
          key: "v2_relationship",
          answer: "友人",
        });
        state = await api(path);
        if (state.questions.some((q) => q.phase !== "common"))
          throw new Error("stale branch after back");
        record.back = true;
        await save();
      }
      const result = await api(path + "/analyze", {});
      record.steps.push({ status: result.status });
      await save();
    }
    const final = await api(path);
    record.count = final.answers.length;
    record.report = final.free_report;
    record.safety = final.status === "safety";
    record.complete = record.safety || !!record.report;
    if (!record.complete) throw new Error("flow not complete");
    if (record.safety !== (c[0] === "violence"))
      throw new Error("safety mismatch");
    if (record.count > 22) throw new Error("question cap exceeded");
    if (final.questions.some((q) => "selected_reason" in q))
      throw new Error("internal reason leaked");
    record.ai_count = final.questions.filter(
      (q) => q.phase === "ai_followup",
    ).length;
    record.questions = final.questions;
    record.error = null;
    await save();
    console.log(
      "PASS",
      c[0],
      record.count,
      "questions, final",
      record.ai_count,
      record.safety ? "SAFETY" : "REPORT",
    );
  } catch (e) {
    record.error = e.message;
    await save();
    console.log("FAIL", c[0], e.message);
  }
}
const selected = process.env.DYNAMIC_CASE
  ? cases.filter((c) => process.env.DYNAMIC_CASE.split(",").includes(c[0]))
  : cases;
for (let i = 0; i < selected.length; i += 2)
  await Promise.all(selected.slice(i, i + 2).map(run));
