import { z } from "zod";
export const memoryKinds = [
  "relationship",
  "concern",
  "goal",
  "event",
  "contact",
  "meeting",
  "action_taken",
  "unresolved",
  "suggestion",
  "note",
] as const;
export const factSchema = z.object({
  kind: z.enum(memoryKinds),
  quote: z.string().min(1).max(500),
  source: z.string().max(80),
  at: z.string().max(40),
});
export type MemoryFact = z.infer<typeof factSchema>;
export type Usage = {
  plan: "free" | "plus";
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  period_start: string;
  period_end: string;
};
export type Subject = {
  id: string;
  nickname: string;
  memory: MemoryFact[];
  updated_at: string;
  memory_reset_at: string | null;
};
export type Thread = {
  id: string;
  subject_id: string;
  title: string;
  updated_at: string;
};
export type Turn = {
  id: string;
  thread_id: string;
  user_text: string;
  assistant_text: string | null;
  status: "pending" | "ready" | "failed";
  safety: boolean;
  generation: number;
  facts: MemoryFact[];
  created_at: string;
};
export type Subscription = {
  id: string;
  amount: number;
  status: string;
  period_end: string;
  paid_through: string | null;
  cancel_at_period_end: boolean;
  cancel_at: string | null;
};
export type ConsultationHome = {
  subjects: Subject[];
  threads: Thread[];
  links: { diagnosis_id: string; subject_id: string }[];
  usage: Usage;
  subscription: Subscription | null;
  hasBilling: boolean;
};
export const chatSchema = z.object({
  answer: z.string().min(20).max(2400),
  safety: z.boolean(),
  facts: z
    .array(
      z.object({
        kind: z.enum(memoryKinds),
        quote: z.string().min(1).max(500),
      }),
    )
    .max(6),
});
export const safetySchema = z.object({
  safety: z.boolean(),
  answer: z.string().max(1800),
});
export function groundedFacts(
  facts: z.infer<typeof chatSchema>["facts"],
  text: string,
  answer: string,
  source: string,
  at: string,
): MemoryFact[] {
  return facts
    .filter((f) => (f.kind === "suggestion" ? answer : text).includes(f.quote))
    .map((f) => ({ ...f, source, at }));
}
export function mergeMemory(
  old: MemoryFact[],
  fresh: MemoryFact[],
  replaceSource?: string,
) {
  const seen = new Set<string>();
  return [...old.filter((f) => f.source !== replaceSource), ...fresh]
    .reverse()
    .filter((f) => {
      const key = f.kind + ":" + f.quote;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24)
    .reverse();
}
export const memoryLabels: Record<MemoryFact["kind"], string> = {
  relationship: "ふたりの関係",
  concern: "今の悩み",
  goal: "望んでいること",
  event: "最近の出来事",
  contact: "連絡の変化",
  meeting: "会う頻度",
  action_taken: "実際にしたこと",
  unresolved: "まだ気になること",
  suggestion: "前回の提案",
  note: "自分で保存したメモ",
};
