// Summarize only synthetic, explicitly generated fixtures; never export real user reports.
import fs from "node:fs";
import path from "node:path";
const dir = "../../work/editorial-live";
const rows = fs
  .readdirSync(dir)
  .filter((n) => /^round-[12]-.+\.json$/.test(n))
  .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));
if (rows.length !== 20 || rows.some((r) => !r.complete))
  throw new Error("Expected 20 completed case-rounds");
const forbidden =
  /面会|接触|対話|相手方|当該|意思疎通|静観|推察|考察|示唆|見受けられ|関係性を構築|コミュニケーションを(?:図|取)/;
for (const r of rows) {
  if (r.classification.risk_detected !== (r.name === "violence"))
    throw new Error("Safety mismatch");
  if (r.name !== "violence") {
    if (
      forbidden.test(
        JSON.stringify({
          free: r.free,
          paid: r.paid,
          questions: r.followup.questions,
        }),
      )
    )
      throw new Error("Banned wording " + r.name);
    if (JSON.stringify(r.free.scores) !== JSON.stringify(r.analysis.scores))
      throw new Error("Scores changed");
    if (Object.keys(r.paid).length !== 13)
      throw new Error("Report shape changed");
  }
}
console.log(
  JSON.stringify({
    caseRounds: 20,
    freeReports: 18,
    paidReports: 18,
    safetyDiversions: 2,
    forbiddenExpressions: 0,
    scoreChanges: 0,
  }),
);
const names = {
  slow_reply: "返信が遅くなった",
  fewer_meetings: "会う頻度が減った",
  initiates: "相手から連絡はある",
  crush: "片思い",
  relationship: "交際中",
  ex: "元恋人",
  dating_app: "マッチングアプリ",
  busy: "相手が忙しい",
  no_violence: "暴力はない",
  violence: "実際の暴力",
};
const htmlEscape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function render(v) {
  if (Array.isArray(v))
    return (
      "<ul>" + v.map((x) => "<li>" + render(x) + "</li>").join("") + "</ul>"
    );
  if (v && typeof v === "object")
    return Object.entries(v)
      .map(([k, x]) => "<h4>" + htmlEscape(k) + "</h4>" + render(x))
      .join("");
  return "<p>" + htmlEscape(v) + "</p>";
}
const out =
  '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI文章の実出力確認</title><style>body{max-width:900px;margin:auto;padding:32px 20px;font-family:sans-serif;line-height:1.9;background:#faf8f3;color:#293c35}details{border-top:1px solid #ccd6cd;padding:20px 0}summary{cursor:pointer;font-weight:bold}h4{color:#65736c;margin-bottom:0}p{white-space:pre-wrap}ul{padding-left:24px}</style><h1>AI文章の実出力確認</h1><p>2026-10-07／すべて架空の相談。10ケースを2回生成。各出力を最終編集・表現検査・意味保持レビューに通した記録です。第1回で見つかった報告書調を修正し、第2回は追加修正を含め全件通過。危険のある2件は通常レポートを生成せず安全案内へ進みます。</p>' +
  rows
    .sort((a, b) => a.round - b.round || a.name.localeCompare(b.name))
    .map(
      (r) =>
        "<details><summary>第" +
        r.round +
        "回：" +
        htmlEscape(names[r.name]) +
        "</summary><h3>相談入力</h3><p>" +
        htmlEscape(r.answer) +
        "</p>" +
        (r.name === "violence"
          ? "<p>危険ありと判定。通常の恋愛レポートは生成しません。</p>"
          : "<h3>無料結果</h3>" +
            render(r.free) +
            "<h3>詳細結果（LINE・7日・30日を含む）</h3>" +
            render(r.paid)) +
        "</details>",
    )
    .join("") +
  "</html>";
fs.writeFileSync("../AI文章の実出力確認.html", out);
