import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { replyParts } from "@/lib/consultation/reply-parts";
import {
  appendChange,
  submissionText,
  submissionPurpose,
  purposePrompt,
  replyFormatPrompt,
} from "@/lib/consultation/purpose";
import { ConversationDrafts } from "@/lib/consultation/drafts";
import { intakeSchema } from "@/lib/trial/topics";
import { trialPrompt } from "@/lib/trial/prompt";
import ConsultationAnswer from "@/components/consultation-answer";
const id = "00000000-0000-4000-8000-000000000001";
it("purpose survives exact resend and regeneration without replacing the draft or sharing it with B", () => {
  const drafts = new ConversationDrafts();
  drafts.setOwner("owner-a");
  drafts.update("A", { text: "自分で書いた文", purpose: "review" });
  drafts.update("B", { text: "別の相談", purpose: "organize" });
  const d = drafts.get("A"),
    submitted = submissionText(d.text, d.purpose);
  expect(submissionPurpose(submitted)).toBe("review");
  expect(submissionText(submitted)).toBe(submitted);
  expect(drafts.get("B").purpose).toBe("organize");
  expect(drafts.get("A").text).toBe("自分で書いた文");
  drafts.setOwner("owner-b");
  expect(drafts.get("A").purpose).toBeUndefined();
});
it("only explicit complete message markers can become copyable; quoted advice and malformed blocks stay uncopyable", () => {
  const message = "無理なら断って大丈夫です。都合がよいときに教えてね。";
  const answer = `本人が話したい場合だけ。\n【送信用文面】\n${message}\n【文面ここまで】\n返事を急かさないでください。`;
  expect(replyParts(answer)).toEqual([
    { kind: "note", text: "本人が話したい場合だけ。" },
    { kind: "message", text: message },
    { kind: "note", text: "返事を急かさないでください。" },
  ]);
  for (const v of [
    "「返信してね」という言葉が気になります。",
    "【送信用文面】未完了",
    "【送信用文面】【文面ここまで】",
    "【送信用文面】A【送信用文面】B【文面ここまで】【文面ここまで】",
  ])
    expect(replyParts(v)).toBeNull();
  expect(
    renderToStaticMarkup(
      createElement(ConsultationAnswer, { text: answer, safety: false }),
    ),
  ).toContain("文面だけをコピー");
  expect(
    renderToStaticMarkup(
      createElement(ConsultationAnswer, { text: answer, safety: true }),
    ),
  ).not.toContain("文面だけをコピー");
});
it("change selection appends, never silently replaces or clips existing text", () => {
  expect(appendChange("元の下書き", "返信が来た。")).toBe(
    "元の下書き\n\n返信が来た。",
  );
  expect(appendChange("長".repeat(3999), "返信が来た。")).toBeNull();
});
it("trial validates optional intent and includes it in generation instructions without relaxing intake limits", () => {
  const input = {
    requestId: id,
    topicId: "reply",
    topicVersion: 1,
    text: "『また今度』と書きました。断りたい意図です。",
    fields: { received: "会える？" },
    purpose: "review",
  };
  const parsed = intakeSchema().parse(input);
  expect(trialPrompt(parsed)).toContain("自分で書いた文を見てほしい");
  expect(trialPrompt(parsed)).toContain("必要最小限");
  expect(
    intakeSchema().safeParse({ ...input, purpose: "override_system" }).success,
  ).toBe(false);
  expect(
    intakeSchema().safeParse({ ...input, text: "長".repeat(801) }).success,
  ).toBe(false);
  expect(
    intakeSchema().parse({ ...input, purpose: undefined }).purpose,
  ).toBeUndefined();
});
it("free-value policy prioritizes useful first answers, retains boundaries, and does not add calls or quota bypass", () => {
  expect(purposePrompt).toContain("聞き直さず");
  expect(purposePrompt).toContain("質問だけで終わらず");
  expect(purposePrompt).toContain("実行済みにしない");
  expect(replyFormatPrompt).toContain("同意や断り");
  const cases = [
    {
      input: "都合が合わないので断りたい",
      message: "今回は都合が合わないので見送ります。",
    },
    {
      input: "『最近どう？』に元気だと返信したい",
      message: "元気だよ。そちらは最近どう？",
    },
  ];
  for (const c of cases) {
    const parts = replyParts(`【送信用文面】${c.message}【文面ここまで】`);
    expect(parts?.[0].text).toBe(c.message);
  } // Synthetic fixtures verify display only, not real AI quality.
});
