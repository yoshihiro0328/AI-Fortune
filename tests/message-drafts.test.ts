import { expect, it } from "vitest";
import { messageDraft } from "../src/lib/message-draft";
import saved from "./fixtures/saved-message-drafts.json";
it("separates the nine saved drafts without losing conditions or changing text", () => {
  for (const c of saved)
    for (const source of Object.values(c.messages)) {
      const parsed = messageDraft(source);
      expect(parsed.message).toBe(
        source.slice(source.indexOf("「") + 1, source.lastIndexOf("」")),
      );
      expect(parsed.note).toBeTruthy();
    }
  expect(messageDraft(saved[1].messages.respectful_distance).note).toContain(
    "送らなくても大丈夫",
  );
});
it("withholds ambiguous auto-copy instead of treating instructions as a message", () => {
  for (const s of [
    "説明だけ",
    "「一つ」「二つ」",
    "「外「内」外」",
    "「未完了",
    "」逆「",
  ])
    expect(messageDraft(s).message).toBeNull();
  expect(messageDraft("補足「難しければ断ってね」一度だけ")).toEqual({
    message: "難しければ断ってね",
    note: "補足\n一度だけ",
  });
});
