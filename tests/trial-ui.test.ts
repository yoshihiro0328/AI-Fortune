import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ rpc: vi.fn(), runtime: false }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/trial/security", () => ({
  runtimeEnabled: () => state.runtime,
}));
vi.mock("@/lib/supabase/admin", () => ({
  db: () => ({ rpc: state.rpc }),
  checked: (r: { data: unknown; error?: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
import Page from "@/app/page";
import TrialRetention from "@/components/phase6/trial-retention";
afterEach(() => {
  vi.resetAllMocks();
  state.runtime = false;
});
describe("public trial offer uses effective availability", () => {
  it("OFF renders diagnosis CTA, preparation notice and no free-answer claim without a DB call", async () => {
    const html = renderToStaticMarkup(await Page());
    expect(html).not.toContain("登録なし・1回答無料");
    expect(html).toContain("登録なし相談は現在準備中");
    expect(html).toMatch(/p6-hero-button[^>]*href="\/diagnosis\/partner-mind"/);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("ON renders consultation CTA and four topic links only after DB approval", async () => {
    state.runtime = true;
    state.rpc.mockResolvedValue({
      data: { enabled: true, maxLength: 800, retentionHours: 24 },
    });
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("登録なし・1回答無料");
    expect(html).toMatch(/p6-hero-button[^>]*href="\/chat"/);
    for (const topic of ["reply", "crush", "distance", "reunion"])
      expect(html).toContain("/chat?topic=" + topic);
    expect(state.rpc).toHaveBeenCalledWith("trial_availability");
  });
  it.each(["paused", "missing", "error"])(
    "%s DB result fails closed",
    async (mode) => {
      state.runtime = true;
      state.rpc.mockResolvedValue(
        mode === "error"
          ? { error: new Error("private SQL detail") }
          : { data: mode === "missing" ? null : { enabled: false } },
      );
      const html = renderToStaticMarkup(await Page());
      expect(html).not.toContain("登録なし・1回答無料");
      expect(html).not.toContain("private SQL detail");
      expect(html).toContain("準備中");
    },
  );
  it("retention notice separates access expiry, database purge and external retention", () => {
    const html = renderToStaticMarkup(createElement(TrialRetention));
    expect(html).toContain("最大24時間");
    expect(html).toContain("削除が遅れる場合");
    expect(html).toContain("保証していません");
    expect(html).toContain("通常最大30日間");
    expect(html).not.toContain("本文は最大24時間保存");
  });
});
