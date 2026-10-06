import "server-only";
import { randomUUID } from "node:crypto";
import { db, checked } from "../supabase/admin";
import { HttpError } from "../http";
import { runAI } from "./run";
import {
  classificationSchema,
  followupSchema,
  analysisSchema,
  freeSchema,
  paidSchema,
} from "./schemas";
import classify from "./prompts/classify";
import followup from "./prompts/followup";
import analyze from "./prompts/analyze";
import free from "./prompts/free-report";
import paid from "./prompts/paid-report";
import { version } from "./prompts/base";
import { riskPattern } from "../security";
import { required } from "../config";
export async function lock<T>(key: string, fn: () => Promise<T>) {
  const token = randomUUID();
  if (!checked(await db().rpc("acquire_lock", { p_key: key, p_token: token })))
    throw new HttpError(409, "処理中です。少し待って再度お試しください。");
  try {
    return await fn();
  } finally {
    checked(
      await db()
        .from("operation_locks")
        .delete()
        .eq("key", key)
        .eq("token", token),
    );
  }
}
export async function analyzeDiagnosis(id: string) {
  return lock("diagnosis:" + id, async () => {
    const d = checked(
      await db().from("diagnoses").select("*").eq("id", id).single(),
    );
    if (d.status === "safety") return { status: "safety" };
    const existing = checked(
      await db()
        .from("free_reports")
        .select("id")
        .eq("diagnosis_id", id)
        .maybeSingle(),
    );
    if (existing) return { status: "free_result_ready" };
    const questions = checked(
      await db()
        .from("diagnosis_questions")
        .select("*")
        .eq("diagnosis_type_id", d.diagnosis_type_id)
        .eq("is_active", true),
    );
    const answers = checked(
      await db()
        .from("diagnosis_answers")
        .select("question_key,question_text,answer_text,is_follow_up")
        .eq("diagnosis_id", id),
    );
    if (
      questions!.some(
        (q) =>
          q.required &&
          !answers!.some(
            (a) => a.question_key === q.question_key && a.answer_text.trim(),
          ),
      )
    )
      throw new HttpError(400, "未回答の質問があります。");
    if (riskPattern.test(answers!.map((a) => a.answer_text).join("\n"))) {
      checked(
        await db()
          .from("diagnoses")
          .update({
            status: "safety",
            classification_json: {
              risk_detected: true,
              risk_type: "other",
              severity: "high",
            },
          })
          .eq("id", id),
      );
      return { status: "safety" };
    }
    let classification = d.classification_json;
    if (!classification) {
      classification = await runAI(
        id,
        "classify",
        classify,
        classificationSchema,
        answers,
      );
      checked(
        await db()
          .from("diagnoses")
          .update({ classification_json: classification })
          .eq("id", id),
      );
    }
    if (classification.risk_detected) {
      checked(
        await db().from("diagnoses").update({ status: "safety" }).eq("id", id),
      );
      return { status: "safety" };
    }
    let follow = d.followup_json;
    if (!follow) {
      follow = await runAI(id, "followup", followup, followupSchema, {
        classification,
        answers,
      });
      const used = new Set(answers!.map((a) => a.question_key));
      follow.questions = follow.needs_follow_up
        ? follow.questions
            .filter(
              (q: { key: string }) => !used.has(q.key) && !!used.add(q.key),
            )
            .slice(0, 3)
        : [];
      checked(
        await db()
          .from("diagnoses")
          .update({ followup_json: follow })
          .eq("id", id),
      );
    }
    if (
      follow.questions!.some(
        (q: { key: string }) => !answers!.some((a) => a.question_key === q.key),
      )
    ) {
      checked(
        await db()
          .from("diagnoses")
          .update({ status: "followup" })
          .eq("id", id),
      );
      return { status: "followup" };
    }
    checked(
      await db().from("diagnoses").update({ status: "analyzing" }).eq("id", id),
    );
    try {
      let analysis = checked(
        await db()
          .from("diagnosis_analyses")
          .select("analysis_json")
          .eq("diagnosis_id", id)
          .maybeSingle(),
      )?.analysis_json;
      if (!analysis) {
        analysis = await runAI(id, "analyze", analyze, analysisSchema, {
          classification,
          answers,
        });
        checked(
          await db()
            .from("diagnosis_analyses")
            .insert({
              diagnosis_id: id,
              analysis_json: analysis,
              model: required("OPENAI_MODEL"),
              prompt_version: version,
            }),
        );
      }
      const report = await runAI(id, "free_report", free, freeSchema, analysis);
      checked(
        await db()
          .from("free_reports")
          .insert({
            diagnosis_id: id,
            report_json: report,
            model: required("OPENAI_MODEL"),
            prompt_version: version,
          }),
      );
      checked(
        await db()
          .from("diagnoses")
          .update({
            status: "free_result_ready",
            completed_at: new Date().toISOString(),
          })
          .eq("id", id),
      );
      return { status: "free_result_ready" };
    } catch (e) {
      await db().from("diagnoses").update({ status: "failed" }).eq("id", id);
      throw e;
    }
  });
}
export async function generatePaid(id: string) {
  const token = randomUUID();
  const claimed = checked(
    await db().rpc("claim_report", { p_diagnosis: id, p_token: token }),
  );
  if (!claimed?.length) return;
  try {
    const a = checked(
      await db()
        .from("diagnosis_analyses")
        .select("analysis_json")
        .eq("diagnosis_id", id)
        .single(),
    );
    const answers = checked(
      await db()
        .from("diagnosis_answers")
        .select("question_text,answer_text")
        .eq("diagnosis_id", id),
    );
    const report = await runAI(id, "paid_report", paid, paidSchema, {
      analysis: a!.analysis_json,
      answers,
    });
    checked(
      await db().rpc("finish_report", {
        p_diagnosis: id,
        p_token: token,
        p_report: report,
        p_model: required("OPENAI_MODEL"),
        p_version: version,
      }),
    );
  } catch (e) {
    await db()
      .from("paid_reports")
      .update({ status: "failed", lease_until: null })
      .eq("diagnosis_id", id)
      .eq("lease_token", token)
      .eq("status", "generating");
    throw e;
  }
}
