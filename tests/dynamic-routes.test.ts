import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  owned: vi.fn(),
  selected: vi.fn(),
  rpc: vi.fn(),
  safety: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<typeof import("../src/lib/http")>()),
  csrf: vi.fn(),
  owned: m.owned,
  rate: vi.fn(),
}));
vi.mock("@/lib/ai/pipeline", () => ({
  lock: (_key: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock("@/lib/questions/engine", () => ({
  selectedQuestions: m.selected,
  dynamicAnswers: vi.fn().mockResolvedValue([]),
  checkAnswerSafety: m.safety,
  safetyStop: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", async (original) => ({
  ...(await original<typeof import("../src/lib/supabase/admin")>()),
  db: () => ({ from: m.from, rpc: m.rpc }),
}));
import { POST } from "../src/app/api/diagnoses/[id]/answers/route";
const id = "00000000-0000-4000-8000-000000000001";
const send = (key = "known", answer = "回答") =>
  POST(
    new Request("https://example.com/api", {
      method: "POST",
      body: JSON.stringify({ key, answer }),
    }),
    { params: Promise.resolve({ id }) },
  );
beforeEach(() => {
  vi.clearAllMocks();
  m.owned.mockResolvedValue({ question_flow_version: "v2" });
  m.safety.mockResolvedValue(false);
  m.rpc.mockResolvedValue({ data: null, error: null });
  m.selected.mockResolvedValue([
    {
      question_key: "known",
      question_text: "どうですか？",
      phase: "common",
      question_type: "textarea",
      options_json: [],
    },
  ]);
  m.from.mockImplementation((table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      single: async () => ({ data: { status: "answering" }, error: null }),
      maybeSingle: async () => ({
        data: table === "payments" ? { status: "pending" } : null,
        error: null,
      }),
    };
    return q;
  });
});
it("rejects unselected arbitrary keys", async () => {
  expect((await send("invented")).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("validates allowed choice text", async () => {
  m.selected.mockResolvedValue([
    {
      question_key: "known",
      question_type: "radio",
      options_json: ["自然な選択肢"],
      phase: "common",
    },
  ]);
  expect((await send()).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("prevents unpaid access to paid followups", async () => {
  m.selected.mockResolvedValue([
    {
      question_key: "known",
      question_type: "textarea",
      options_json: [],
      phase: "paid_followup",
    },
  ]);
  expect((await send()).status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("does not save or continue after a safety provider failure", async () => {
  m.safety.mockRejectedValue(new Error("timeout"));
  expect((await send()).status).toBe(503);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("persists through the atomic answer RPC and routes danger to safety", async () => {
  m.safety.mockResolvedValue(true);
  const r = await send();
  expect(await r.json()).toEqual({ saved: true, status: "safety" });
  expect(m.rpc).toHaveBeenCalledWith("save_dynamic_answer", {
    p_diagnosis: id,
    p_key: "known",
    p_answer: "回答",
  });
});
