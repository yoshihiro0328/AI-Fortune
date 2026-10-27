import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { safeReturnTo, accountReturnLink } from "@/lib/auth-return";
import { diagnosisSaveState } from "@/lib/save-state";
import { ConversationDrafts } from "@/lib/consultation/drafts";
import SaveResultNote from "@/components/save-result-note";
import ConsultationAnswer from "@/components/consultation-answer";
import { eventCreate } from "@/lib/consultation/events";
import { reportSample } from "@/lib/report-sample";
import saved from "./fixtures/saved-message-drafts.json";
const id = "00000000-0000-4000-8000-000000000001";
it("accepts only known local return destinations, never arbitrary URLs or text", () => {
  for (const path of [
    `/result/${id}`,
    `/report/${id}`,
    `/consult?diagnosis=${id}`,
    `/consult?thread=${id}`,
    "/consult?topic=reply",
    "/consult",
  ]) {
    expect(safeReturnTo(path)).toBe(path);
    expect(accountReturnLink(path)).toContain("?next=");
  }
  for (const path of [
    "//evil.test",
    "https://evil.test",
    "/\\evil.test",
    "/consult?text=private",
    "/consult?topic=reply&next=//evil",
    "/consult?diagnosis=invalid",
    "/account",
    "/report/" + id + "/../admin",
    "/consult\n",
  ])
    expect(safeReturnTo(path)).toBeNull();
});
it("shows save prompts only for unsaved diagnoses, never infers saved from login alone", () => {
  expect(diagnosisSaveState(null, false)).toBe("anonymous");
  expect(diagnosisSaveState(null, true)).toBe("unsaved");
  expect(diagnosisSaveState(id, true)).toBe("saved");
  for (const state of ["anonymous", "unsaved", "saved"] as const) {
    const html = renderToStaticMarkup(
      createElement(SaveResultNote, { state, returnTo: "/result/" + id }),
    );
    if (state === "saved") {
      expect(html).toContain("保存済み");
      expect(html).not.toContain("Cookie");
      expect(html).not.toContain("登録・ログイン");
    } else {
      expect(html).toContain("Cookie");
      expect(html).toContain("未保存");
      if (state === "unsaved") expect(html).toContain("この診断を保存する");
    }
  }
  expect(renderToStaticMarkup(createElement(SaveResultNote))).not.toContain(
    "保存済み",
  );
});
describe("component-lifetime drafts", () => {
  it("retains A -> B -> A and failed requests, success clears only that conversation", () => {
    const d = new ConversationDrafts();
    d.setOwner("user-a");
    d.update("A", { text: "Aの下書き" });
    d.update("B", { text: "Bの下書き" });
    expect(d.get("A").text).toBe("Aの下書き");
    const pending = { requestId: id, text: "Aの下書き" };
    d.update("A", { pending });
    expect(d.get("B").pending).toBeNull();
    expect(d.get("A").pending).toEqual(pending);
    d.remove("A");
    expect(d.get("A").text).toBe("");
    expect(d.get("B").text).toBe("Bの下書き");
  });
  it("clears all data on account change/logout, and transfers a new subject draft to its new thread", () => {
    const d = new ConversationDrafts();
    d.setOwner("a");
    d.update("new:subject", { text: "draft" });
    d.move("new:subject", "thread");
    expect(d.get("thread").text).toBe("draft");
    expect(d.get("new:subject").text).toBe("");
    d.setOwner("b");
    expect(d.get("thread").text).toBe("");
    d.update("thread", { text: "other" });
    d.clear();
    expect(d.get("thread").text).toBe("");
  });
});
it("long response uses an exact excerpt, and safety guidance is never collapsed", () => {
  const text = "冒頭の原文です。\n\n" + "続く原文。".repeat(120);
  const html = renderToStaticMarkup(
    createElement(ConsultationAnswer, { text, safety: false }),
  );
  expect(html).toContain("冒頭の原文です。");
  expect(html).not.toContain("続く原文。");
  expect(html).toContain("回答の全文を読む");
  const safety = renderToStaticMarkup(
    createElement(ConsultationAnswer, { text, safety: true }),
  );
  expect(safety).toContain("続く原文。");
  expect(safety).not.toContain("回答の全文を読む");
});
it("public report sample keeps the approved three messages without repeated layout filler", () => {
  expect(reportSample.messages).toEqual(
    saved.find((s) => s.caseNumber === 5)!.messages,
  );
  expect(reportSample.relationship).not.toContain("固定回答");
});
it("manual dates reject impossible dates, client identities and AI source injection", () => {
  const v = { id, subject: id, date: "2026-02-28", text: "会って話した" };
  expect(eventCreate.safeParse(v).success).toBe(true);
  for (const extra of [
    { date: "2026-02-30" },
    { user_id: id },
    { source_type: "ai" },
    { text: " " },
  ])
    expect(eventCreate.safeParse({ ...v, ...extra }).success).toBe(false);
});
