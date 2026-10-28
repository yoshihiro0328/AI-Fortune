import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoEnabled, REVIEW_PROJECT_ID } from "@/lib/demo/config";
import { canAdvance, demoQuestions } from "@/lib/demo/fixtures";
import { proxy } from "@/proxy";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/preview-demo",
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
import DemoScreen from "@/components/demo/screen";
import DemoBanner from "@/components/demo/banner";
import DemoPage from "@/app/preview-demo/[[...path]]/page";
const valid = {
  PREVIEW_DEMO_ENABLED: "true",
  VERCEL_ENV: "preview",
  VERCEL_PROJECT_ID: REVIEW_PROJECT_ID,
};
const paths = [
  "/api/auth",
  "/api/auth/confirm",
  "/auth/callback",
  "/api/questions",
  "/api/diagnoses",
  "/api/diagnoses/real-id",
  "/api/diagnoses/real-id/answers",
  "/api/diagnoses/real-id/analyze",
  "/api/diagnoses/real-id/report",
  "/api/diagnoses/real-id/checkout",
  "/api/billing",
  "/api/webhooks/stripe",
  "/api/consultations",
  "/api/consultations/real-id/send",
  "/api/trial/session",
  "/api/trial/turns",
  "/api/trial/claim",
  "/api/events",
  "/api/contact",
  "/api/cron/reports",
  "/api/cron/mail",
  "/api/cron/trial",
  "/admin/contact",
];
beforeEach(() => {
  for (const [key, value] of Object.entries(valid)) vi.stubEnv(key, value);
  vi.stubEnv("VERCEL_TARGET_ENV", "preview");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("demo activation fails closed", () => {
  it("requires explicit setting, exact platform project and Preview", () => {
    expect(demoEnabled(valid)).toBe(true);
    for (const key of Object.keys(valid)) {
      expect(demoEnabled({ ...valid, [key]: undefined })).toBe(false);
      expect(demoEnabled({ ...valid, [key]: "wrong" })).toBe(false);
    }
    for (const environment of ["production", "development", "staging", ""])
      expect(demoEnabled({ ...valid, VERCEL_ENV: environment })).toBe(false);
    expect(demoEnabled({ ...valid, VERCEL_TARGET_ENV: "production" })).toBe(
      false,
    );
  });
  it("cannot be enabled by headers, cookies or query parameters", () => {
    vi.stubEnv("PREVIEW_DEMO_ENABLED", "false");
    vi.stubEnv("VERCEL_PROJECT_ID", "normal-project");
    const r = proxy(
      new NextRequest(
        "https://example.test/account?PREVIEW_DEMO_ENABLED=true",
        { headers: { cookie: "demo=true", "x-demo": "true" } },
      ),
    );
    expect(r.headers.get("x-middleware-next")).toBe("1");
    expect(r.headers.get("x-middleware-rewrite")).toBeNull();
  });
  it("hides direct demo routes in Production", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(
      DemoPage({
        params: Promise.resolve({ path: ["account"] }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
describe("demo isolates real services", () => {
  it.each(paths)(
    "blocks all methods on %s without a network request or auth cookie",
    async (path) => {
      const network = vi.fn(() => {
        throw new Error("Network must not be called");
      });
      vi.stubGlobal("fetch", network);
      for (const method of [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ]) {
        const r = proxy(
          new NextRequest("https://example.test" + path, { method }),
        );
        expect(r.status).toBe(403);
        expect(r.headers.get("set-cookie")).toBeNull();
        expect(r.headers.get("x-middleware-next")).toBeNull();
        expect(r.headers.get("x-middleware-rewrite")).toBeNull();
      }
      expect(network).not.toHaveBeenCalled();
    },
  );
  it("blocks server actions, remote image proxying and indexing", async () => {
    expect(
      proxy(
        new NextRequest("https://example.test/account", {
          method: "POST",
          headers: { "next-action": "fake" },
        }),
      ).status,
    ).toBe(403);
    expect(
      proxy(
        new NextRequest(
          "https://example.test/_next/image?url=https://example.net/a",
        ),
      ).status,
    ).toBe(403);
    expect(
      await proxy(new NextRequest("https://example.test/robots.txt")).text(),
    ).toContain("Disallow: /");
    expect(
      proxy(new NextRequest("https://example.test/sitemap.xml")).status,
    ).toBe(404);
  });
  it.each([
    "/",
    "/plans",
    "/diagnosis/partner-mind",
    "/result/demo-example",
    "/report/demo-example",
    "/account",
    "/consult?demoThread=demo-a",
    "/chat?topic=reply",
    "/legal/terms",
  ])("rewrites %s to the isolated screen", (path) => {
    const r = proxy(new NextRequest("https://example.test" + path));
    const url = new URL(r.headers.get("x-middleware-rewrite")!);
    expect(url.pathname).toMatch(/^\/preview-demo/);
    expect(url.search).toBe(new URL("https://example.test" + path).search);
    expect(r.headers.get("x-robots-tag")).toContain("noindex");
    expect(r.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(r.headers.get("content-security-policy")).toContain(
      "form-action 'none'",
    );
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});
describe("normal-mode regression boundary", () => {
  it.each(paths)(
    "preserves original routing and permissions for %s",
    (path) => {
      vi.stubEnv("VERCEL_PROJECT_ID", "normal-project");
      for (const environment of ["production", "development", "preview"]) {
        vi.stubEnv("VERCEL_ENV", environment);
        vi.stubEnv("PREVIEW_DEMO_ENABLED", "false");
        for (const method of ["GET", "POST", "DELETE"]) {
          const r = proxy(
            new NextRequest("https://example.test" + path, { method }),
          );
          expect(r.headers.get("x-middleware-next")).toBe("1");
          expect(r.headers.get("x-middleware-rewrite")).toBeNull();
          expect(r.headers.get("set-cookie")).toBeNull();
        }
      }
    },
  );
});
describe("synthetic screen content", () => {
  it("renders the home shell consistently despite an internal rewrite path", async () => {
    const html = renderToStaticMarkup(
      await DemoPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain("メインナビゲーション");
    expect(html).toContain("yorisoi-home-shell");
    expect(html.match(/<main[\s\S]*?<\/main>/)?.[0]).not.toContain(
      'href="/chat"',
    );
  });
  it("labels the environment and never represents a successful login", () => {
    expect(renderToStaticMarkup(createElement(DemoBanner))).toContain(
      "合成データのみ",
    );
    const account = renderToStaticMarkup(
      createElement(DemoScreen, { path: "/account" }),
    );
    expect(account).toContain("ログインしていません");
    expect(account).toContain("デモ表示は実認証として扱われません");
    expect(account).not.toContain("<input");
    expect(account.match(/disabled=""/g)).toHaveLength(3);
  });
  it("shows current prices but disables both purchases", () => {
    const markup = renderToStaticMarkup(
      createElement(DemoScreen, { path: "/plans" }),
    );
    expect(markup).toContain("月額980円");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).not.toContain("checkout.stripe.com");
  });
  it.each(["reply", "crush", "distance", "reunion", "__proto__"])(
    "keeps anonymous AI OFF for %s",
    (topic) => {
      const markup = renderToStaticMarkup(
        createElement(DemoScreen, { path: "/chat", topic }),
      );
      expect(markup).toContain("準備中");
      expect(markup).toContain("disabled");
      expect(markup).not.toContain("1回答無料");
    },
  );
  it.each([
    "/result/demo-example",
    "/report/demo-example",
    "/account",
    "/consult",
  ])("renders %s without network access", (path) => {
    const network = vi.fn(() => {
      throw new Error("Network must not be called");
    });
    vi.stubGlobal("fetch", network);
    const markup = renderToStaticMarkup(createElement(DemoScreen, { path }));
    expect(markup).toContain("合成データ");
    expect(network).not.toHaveBeenCalled();
  });
  it("never displays a real result id or arbitrary person's record", () => {
    const markup = renderToStaticMarkup(
      createElement(DemoScreen, { path: "/report/real-id" }),
    );
    expect(markup).toContain("デモ対象外");
    const thread = renderToStaticMarkup(
      createElement(DemoScreen, { path: "/consult", thread: "real-id" }),
    );
    expect(thread).toContain("相談・履歴");
    expect(thread).not.toContain("real-id");
  });
  it("requires a valid answer for each of the 12 steps, including after going back", () => {
    const answers: Record<number, number> = {};
    for (let step = 0; step < demoQuestions.length; step++) {
      expect(canAdvance(step, answers)).toBe(false);
      answers[step] = 0;
      expect(canAdvance(step, answers)).toBe(true);
      answers[step] = 99;
      expect(canAdvance(step, answers)).toBe(false);
      answers[step] = 1;
    }
    expect(canAdvance(0, answers)).toBe(true);
    expect(canAdvance(12, answers)).toBe(false);
  });
});

describe("review project permanent isolation", () => {
  it.each(paths)(
    "blocks %s with demo OFF, missing or Production misclassification",
    (path) => {
      for (const flag of ["false", "", undefined]) {
        vi.stubEnv("PREVIEW_DEMO_ENABLED", flag);
        for (const environment of ["preview", "production", "development"]) {
          vi.stubEnv("VERCEL_ENV", environment);
          for (const method of ["GET", "POST", "DELETE"]) {
            const r = proxy(
              new NextRequest("https://example.test" + path, { method }),
            );
            expect(r.status).toBe(503);
            expect(r.headers.get("x-robots-tag")).toContain("noindex");
            expect(r.headers.get("x-middleware-next")).toBeNull();
            expect(r.headers.get("x-middleware-rewrite")).toBeNull();
          }
        }
      }
    },
  );
  it("blocks server rendered pages before any provider client can initialize", () => {
    vi.stubEnv("PREVIEW_DEMO_ENABLED", "false");
    for (const path of ["/", "/plans", "/account", "/consult", "/_next/image"])
      expect(proxy(new NextRequest("https://example.test" + path)).status).toBe(
        503,
      );
  });
});
