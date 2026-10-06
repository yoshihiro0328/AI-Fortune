import { z } from "zod";
const text = z.string().min(1).max(5000);
const signal = z.object({ signal: text, reason: text });
export const classificationSchema = z.object({
  relationship_type: text,
  primary_concern: text,
  user_goal: text,
  emotional_intensity: z.enum(["low", "medium", "high"]),
  risk_detected: z.boolean(),
  risk_type: z.enum([
    "none",
    "violence",
    "coercion",
    "stalking",
    "self_harm",
    "minor_safety",
    "crime",
    "other",
  ]),
  severity: z.enum(["none", "low", "high"]),
});
export const followupSchema = z.object({
  needs_follow_up: z.boolean(),
  questions: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z_]{1,40}$/),
        question: text,
        type: z.literal("textarea"),
        reason: text,
      }),
    )
    .max(3),
});
export const analysisSchema = z.object({
  relationship_status: text,
  positive_signals: z.array(signal).max(4),
  attention_signals: z.array(signal).max(3),
  uncertainties: z.array(text).min(1).max(5),
  scores: z.object({
    relationship_stability: z.number().int().min(0).max(100),
    communication: z.number().int().min(0).max(100),
    improvement_potential: z.number().int().min(0).max(100),
  }),
  recommended_action: text,
  avoid_actions: z.array(text).max(5),
});
export const freeSchema = z.object({
  summary: text,
  positive_signals: z.array(signal).max(4),
  attention_signals: z.array(signal).max(3),
  advice: text,
  scores: analysisSchema.shape.scores,
  uncertainties: z.array(text).min(1).max(5),
});
const plan = z.object({ period: text, action: text });
export const paidSchema = z.object({
  relationship_analysis: text,
  behavior_patterns: text,
  distance_reasons: z.array(text).min(2).max(5),
  positive_signals: z.array(signal).max(4),
  attention_signals: z.array(signal).max(3),
  improvement_points: z.array(text).min(1).max(5),
  avoid_actions: z.array(text).min(1).max(5),
  contact_advice: text,
  messages: z.object({
    natural: text,
    proactive: text,
    respectful_distance: text,
  }),
  next_meeting: text,
  seven_day_plan: z.array(plan).min(3).max(7),
  thirty_day_plan: z.array(plan).min(3).max(5),
  overall_advice: text,
});
export type FreeReport = z.infer<typeof freeSchema>;
export type PaidReport = z.infer<typeof paidSchema>;
