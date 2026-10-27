import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  identity: vi.fn(),
  authClient: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/lib/http", () => ({
  api: (f: () => unknown) => f(),
  csrf: vi.fn(),
  body: (req: Request) => req.json(),
  identity: m.identity,
  authClient: m.authClient,
  rate: m.rate,
  rateIP: m.rate,
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/auth", () => ({
  claimDiagnoses: vi.fn(),
  rotateAnonymous: vi.fn(),
  canRecover: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/stripe/local-integration", () => ({
  localPaymentIntegration: () => false,
}));
vi.mock("@/lib/stripe/local-subscription", () => ({
  localSubscriptionIntegration: () => false,
}));
import { POST } from "@/app/api/auth/route";
import { authMailAllowed } from "@/lib/auth-mail";
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("AUTH_EMAIL_ENABLED", undefined);
  m.identity.mockRejectedValue(new Error("reached identity boundary"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
const request = (action: string) =>
  new Request("https://example.org/api/auth", {
    method: "POST",
    body: JSON.stringify({ action, email: "synthetic@example.org" }),
  });
it.each(["signup", "resend", "reset"])(
  "blocks %s before any auth or DB work by default",
  async (action) => {
    await expect(POST(request(action))).rejects.toMatchObject({ status: 503 });
    expect(m.identity).not.toHaveBeenCalled();
    expect(m.authClient).not.toHaveBeenCalled();
    expect(m.rate).not.toHaveBeenCalled();
  },
);
it.each(["login", "logout", "claim", "update"])(
  "preserves %s while outbound auth mail is stopped",
  async (action) => {
    await expect(POST(request(action))).rejects.toThrow(
      "reached identity boundary",
    );
    expect(m.identity).toHaveBeenCalledOnce();
  },
);
it.each(["false", "TRUE", "1", ""])(
  "does not enable production mail with %s",
  (value) => {
    expect(
      authMailAllowed("reset", {
        NODE_ENV: "test",
        VERCEL_ENV: "production",
        AUTH_EMAIL_ENABLED: value,
      }),
    ).toBe(false);
  },
);
it("requires explicit true for a production-labelled runtime too", () => {
  expect(
    authMailAllowed("signup", { NODE_ENV: "test", APP_RUNTIME: "production" }),
  ).toBe(false);
  expect(
    authMailAllowed("signup", {
      NODE_ENV: "test",
      APP_RUNTIME: "production",
      AUTH_EMAIL_ENABLED: "true",
    }),
  ).toBe(true);
});
it("honors an explicit stop outside production without changing the old test default", () => {
  expect(authMailAllowed("resend", { NODE_ENV: "test" })).toBe(true);
  expect(
    authMailAllowed("resend", {
      NODE_ENV: "test",
      AUTH_EMAIL_ENABLED: "false",
    }),
  ).toBe(false);
});
it("allows an explicitly enabled request to enter existing validation and rate controls", async () => {
  vi.stubEnv("AUTH_EMAIL_ENABLED", "true");
  await expect(POST(request("reset"))).rejects.toThrow(
    "reached identity boundary",
  );
});
