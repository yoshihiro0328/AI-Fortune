// Explicit evaluation entry point. Normal test/CI discovery never enables live mode.
import { it, vi } from "vitest";
import { readFile, writeFile, mkdir, lstat, rm } from "node:fs/promises";
import path from "node:path";
import { evaluationDatabase } from "./isolated-db";
import { evaluationProvider, createEvaluationLedger } from "./provider.mjs";
import { recoveryPlan, extensionPlan, revisionPlan } from "./recovery.mjs";
import { stageCache } from "./stage-cache.mjs";
import consultation from "./consultation-cases.json";
import diagnosis from "./diagnosis-cases.json";
const bridge = vi.hoisted(() => ({
  db: () => {
    throw Error("DB_NOT_READY");
  },
  parse: async (...args: unknown[]): Promise<unknown> => {
    void args;
    throw Error("PROVIDER_NOT_READY");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  db: () => bridge.db(),
  checked: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw Error("ISOLATED_DB_FAILED");
    return r.data;
  },
}));
vi.mock("openai", () => ({
  default: class {
    responses = { parse: (p: unknown) => bridge.parse(p) };
  },
}));
import { triageRisk } from "@/lib/risk";
import { chatAnswer, checkChatSafety } from "@/lib/consultation/ai";
import { analyzeDiagnosis, generatePaid } from "@/lib/ai/pipeline";
import { initializeFlow, selectedQuestions } from "@/lib/questions/engine";
import { editForReader } from "@/lib/ai/editor";
import { paidSchema } from "@/lib/ai/schemas";

function requireCheck(ok: unknown, code: string): asserts ok {
  if (!ok) throw Error(code);
}
function shape(s: Record<string, unknown>): unknown {
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (s.type === "object")
    return Object.fromEntries(
      Object.entries(
        s.properties as Record<string, Record<string, unknown>>,
      ).map(([k, v]) => [k, shape(v)]),
    );
  if (s.type === "array")
    return Array.from({ length: Number(s.minItems ?? 0) }, () =>
      shape(s.items as Record<string, unknown>),
    );
  if (s.type === "boolean") return false;
  if (s.type === "number" || s.type === "integer")
    return Number(s.minimum ?? 0);
  return "相手の都合を一度聞いてみてください。";
}

it("isolated evaluation from login-free fixtures through reports and cleanup", async () => {
  const live = process.env.AI_EVALUATION_MODE === "live";
  requireCheck(
    !process.env.OPENAI_API_KEY &&
      !process.env.SUPABASE_SERVICE_ROLE_KEY &&
      !process.env.STRIPE_SECRET_KEY,
    "CLEAN_ENV_REQUIRED",
  );
  requireCheck(
    !live || process.env.AI_EVALUATION_DIRECTORY,
    "PRIVATE_DIRECTORY_REQUIRED",
  );
  const directory = path.resolve(
    process.env.AI_EVALUATION_DIRECTORY ||
      "/tmp/yorisoi-ai-offline-" + process.pid,
  );
  await mkdir(directory, { mode: 0o700, recursive: true });
  const stat = await lstat(directory);
  requireCheck(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      !(stat.mode & 0o077) &&
      stat.uid === process.getuid!(),
    "PRIVATE_DIRECTORY_REQUIRED",
  );
  const save = async (name: string, data: unknown) => {
    const serialized = JSON.stringify(data, null, 2);
    requireCheck(
      !/sk-[A-Za-z0-9_-]{20,}|https?:\/\/[^\s"]*[?&#](?:secret|token)=/.test(
        serialized,
      ),
      "ARTIFACT_REJECTED",
    );
    await writeFile(path.join(directory, name), serialized, {
      mode: 0o600,
      flag: "wx",
    });
  };
  const journal = await createEvaluationLedger(
    path.join(directory, "budget.jsonl"),
  );
  let local: Awaited<ReturnType<typeof evaluationDatabase>> | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("UNAPPROVED_NETWORK");
  };
  const recoveryDirectory = process.env.AI_EVALUATION_RECOVERY_DIRECTORY;
  const extensionDirectory = process.env.AI_EVALUATION_EXTENSION_DIRECTORY;
  requireCheck(
    !(extensionDirectory && recoveryDirectory),
    "AMBIGUOUS_RECOVERY_DENIED",
  );
  const revisionDirectory = process.env.AI_EVALUATION_REVISION_DIRECTORY;
  requireCheck(
    !revisionDirectory || (extensionDirectory && !recoveryDirectory),
    "REVISION_CONTEXT_REQUIRED",
  );
  const revision = revisionDirectory
    ? revisionPlan(
        process.env.AI_EVALUATION_ORIGINAL_DIRECTORY,
        extensionDirectory,
        revisionDirectory,
      )
    : null;
  const extension =
    revision ??
    (extensionDirectory
      ? extensionPlan(
          process.env.AI_EVALUATION_ORIGINAL_DIRECTORY,
          extensionDirectory,
        )
      : null);
  const recovery =
    extension ?? (recoveryDirectory ? recoveryPlan(recoveryDirectory) : null);
  const executionStart = recovery
    ? JSON.parse(
        await readFile(path.join(directory, "execution-start.json"), "utf8"),
      )
    : null;
  const deadline = recovery
    ? executionStart.startedAt + recovery.remainingMillis
    : Date.now() + 1200000;
  let group = "consultation",
    caseNumber = 1;
  const caseResults: { group: string; caseNumber: number; status: string }[] =
    [];
  let gate: ReturnType<typeof evaluationProvider> | undefined;
  let terminal = "not_started";
  let stopStage = "initialization";
  // Errors from real SDK/pipeline are never echoed; only controlled codes leave here.
  const oldError = console.error;
  console.error = () => {};
  try {
    local = await evaluationDatabase();
    bridge.db = () => local!.adapter as never;
    vi.stubEnv("OPENAI_API_KEY", "evaluation-bridge-only");
    vi.stubEnv("OPENAI_MODEL", "gpt-6-luna");
    vi.stubEnv("OPENAI_CHAT_MODEL", "gpt-6-luna");
    vi.stubEnv("STRIPE_MODE", "sandbox");
    vi.stubEnv("STRIPE_ACCOUNT_ID", "acct_fixture");
    vi.stubEnv("PAYMENT_INTEGRATION_LOCAL", "false");
    vi.stubEnv("SUBSCRIPTION_INTEGRATION_LOCAL", "false");
    const real = await vi.importActual<typeof import("openai")>("openai");
    let apiKey = "synthetic-not-a-key";
    if (live) {
      const secretPath = path.join(directory, "openai-key.json");
      const st = await lstat(secretPath);
      requireCheck(
        st.isFile() &&
          !st.isSymbolicLink() &&
          !(st.mode & 0o077) &&
          st.uid === process.getuid!(),
        "PRIVATE_KEY_REQUIRED",
      );
      const secret = JSON.parse(await readFile(secretPath, "utf8"));
      requireCheck(
        typeof secret.key === "string" &&
          /^sk-[A-Za-z0-9_-]{20,500}$/.test(secret.key) &&
          Number.isSafeInteger(secret.receivedAt) &&
          Date.now() - secret.receivedAt >= 0 &&
          Date.now() - secret.receivedAt < 5400000,
        "FRESH_KEY_REQUIRED",
      );
      apiKey = secret.key;
    }
    const client = new real.default({
      apiKey,
      maxRetries: 0,
      baseURL: "https://api.openai.com/v1",
      fetch: async (url, init) => {
        requireCheck(
          String(url) === "https://api.openai.com/v1/responses" &&
            init?.method === "POST",
          "NETWORK_SCOPE_DENIED",
        );
        if (live) return originalFetch(url, { ...init, redirect: "error" });
        const p = JSON.parse(String(init.body)),
          format = p.text.format;
        const input = JSON.parse(p.input[1].content).untrusted_data;
        let data = shape(format.schema) as Record<string, unknown>;
        if (format.name.includes("_rewrite_")) data = { edits: input.original };
        if (format.name.includes("_review_"))
          data = {
            faithful: true,
            natural: true,
            safe: true,
            actionable: true,
            issues: [],
          };
        if (format.name === "chat")
          data = {
            answer:
              "一度、都合のよい日を聞いてみてください。返事を待ってから次を考えましょう。",
            safety: caseNumber === 14,
            facts: [],
          };
        if (format.name === "chat_safety")
          data = {
            safety: caseNumber === 14,
            answer:
              "安全な場所へ移り、信頼できる人に今の状況を伝えてください。",
          };
        if (format.name === "classify" && caseNumber === 10)
          data.risk_detected = true;
        return Response.json({
          id: "resp_synthetic",
          model: "gpt-6-luna",
          status: "completed",
          service_tier: "default",
          usage: {
            input_tokens: 100,
            output_tokens: 100,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          },
          output: [
            {
              type: "message",
              id: "msg_synthetic",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(data),
                  annotations: [],
                },
              ],
            },
          ],
        });
      },
    });
    apiKey = "";
    gate = evaluationProvider(client, {
      deadline,
      checkpoint: journal.checkpoint,
      ...(recovery ? { prior: recovery.prior } : {}),
    });
    if (recovery)
      await journal.checkpoint({
        phase: "carried_forward",
        ...recovery,
        billedUSD: null,
      });
    const cachedStage = stageCache(directory);
    bridge.parse = async (
      p: Parameters<NonNullable<typeof gate>["parse"]>[2],
    ) => {
      requireCheck(
        !extension ||
          (group === "diagnosis" &&
            extension.allowedCases.includes(caseNumber)),
        "EXTENSION_CASE_DENIED",
      );
      const result = revision
        ? await cachedStage(
            revision.evaluationIds[caseNumber as 6 | 7],
            p,
            () => gate!.parse(group, caseNumber, p),
          )
        : await gate!.parse(group, caseNumber, p);
      if (extension && !revision)
        await save(
          `verified-output-${group}-${caseNumber}-${gate!.summary().calls}.json`,
          {
            group,
            caseNumber,
            callNumber: gate!.summary().calls,
            stage:
              /^(?:chat(?:_safety)?|classify|analyze|followup|free_report|paid_report)(?:_(?:rewrite|review)_[012])?$/.test(
                p.text?.format?.name,
              )
                ? p.text.format.name
                : "other",
            syntheticInputOnly: true,
            usageVerified: true,
            qualityReviewed: false,
            output: result.output_parsed,
          },
        );
      return result;
    };
    await local.pg.query(
      "insert into payment_environment(id,mode,stripe_account_id) values(true,'sandbox','acct_fixture') on conflict(id) do update set stripe_account_id='acct_fixture'",
    );
    const user = "50000000-0000-4000-8000-000000000001";
    await local.pg.query("insert into auth.users(id) values($1)", [user]);
    async function knownStep<T>(run: () => Promise<T>): Promise<T> {
      try {
        return await run();
      } catch (e) {
        if (
          !revision ||
          (e as Error).message !==
            "Generation budget exhausted; saved stages can resume" ||
          gate!.summary().stopped ||
          Date.now() + 30000 >= deadline
        )
          throw e;
        return run();
      }
    }
    async function runCase(g: string, n: number) {
      requireCheck(Date.now() < deadline, "EVALUATION_DEADLINE");
      group = g;
      caseNumber = n;
      stopStage = g + "_" + n;
      try {
        if (g === "consultation") {
          const [label, past, message, safety] = consultation[n - 1];
          const safetyCheck =
            triageRisk(String(message)).level !== "none"
              ? await checkChatSafety(
                  { user, plan: "free", isTest: true },
                  String(message),
                )
              : null;
          const result = safetyCheck?.safety
            ? { ...safetyCheck, facts: [] }
            : await chatAnswer(
                { user, plan: "free", isTest: true },
                {
                  memory: [
                    {
                      kind: "event",
                      quote: past,
                      source: "synthetic",
                      at: "2026-10-25T10:00:00Z",
                    },
                  ],
                  recent: [],
                  message,
                  today: "2026-10-26",
                },
              );
          await save(`consultation-${n}.json`, {
            label,
            past,
            message,
            result,
          });
          requireCheck(result.safety === safety, "SAFETY_MISMATCH");
          requireCheck(
            !/必ず復縁|絶対に脈あり|絶対に好かれ|加入してください|購入してください|確率は\d/.test(
              result.answer,
            ),
            "QUALITY_REJECTED",
          );
          requireCheck(
            n !== 2 || !result.answer.includes("誘ってくれて"),
            "UNSUPPORTED_FACT",
          );
          requireCheck(
            n !== 4 || !/観てみたよ|見てみたよ/.test(result.answer),
            "UNSUPPORTED_FACT",
          );
        } else {
          const [label, answer] = diagnosis[n - 1],
            id = `50000000-0000-4000-8000-${String((revision ? 200 : 100) + n).padStart(12, "0")}`;
          const type = (
            await local!.pg.query<{ id: string }>(
              "select id from diagnosis_types where slug='partner-mind'",
            )
          ).rows[0].id;
          const v = n === 1 ? "v2" : "v1";
          await local!.pg.query(
            "insert into diagnoses(id,diagnosis_type_id,anonymous_session_id,question_flow_version) values($1,$2,'synthetic-evaluation',$3)",
            [id, type, v],
          );
          if (v === "v2") await initializeFlow(id, type);
          const fill = async () => {
            if (v === "v1")
              await local!.pg.query(
                "insert into diagnosis_answers(diagnosis_id,question_key,question_text,answer_text) select $1,question_key,question_text,$2 from diagnosis_questions where flow_version='v1' and is_active and not exists(select 1 from diagnosis_answers a where a.diagnosis_id=$1 and a.question_key=diagnosis_questions.question_key)",
                [id, answer],
              );
            else
              for (const q of await selectedQuestions(id))
                await local!.pg.query(
                  "insert into diagnosis_answers(diagnosis_id,question_key,question_text,answer_text) select $1,$2,$3,$4 where not exists(select 1 from diagnosis_answers where diagnosis_id=$1 and question_key=$2)",
                  [id, q.question_key, q.question_text, answer],
                );
            const rows = (
              await local!.pg.query<{
                followup_json: {
                  questions?: { key: string; question: string; text: string }[];
                };
              }>("select followup_json from diagnoses where id=$1", [id])
            ).rows;
            for (const q of rows[0].followup_json?.questions ?? [])
              await local!.pg.query(
                "insert into diagnosis_answers(diagnosis_id,question_key,question_text,answer_text,is_follow_up) select $1,$2,$3,$4,true where not exists(select 1 from diagnosis_answers where diagnosis_id=$1 and question_key=$2)",
                [id, q.key, q.question ?? q.text ?? q.key, answer],
              );
          };
          let status = "";
          for (let step = 0; step < 8; step++) {
            await fill();
            status = (await knownStep(() => analyzeDiagnosis(id))).status;
            if (status !== "followup") break;
          }
          requireCheck(
            n === 10 ? status === "safety" : status === "free_result_ready",
            "DIAGNOSIS_STATUS",
          );
          if (status !== "safety") {
            const calls = gate!.summary().calls;
            await analyzeDiagnosis(id);
            requireCheck(
              gate!.summary().calls === calls,
              "RESUME_DUPLICATED_CALL",
            );
            await local!.pg.query(
              "insert into payments(diagnosis_id,status,amount,currency,is_test) values($1,'paid',1980,'jpy',true)",
              [id],
            );
            await local!.pg.query(
              "insert into paid_reports(diagnosis_id,payment_id,status) select diagnosis_id,id,'queued' from payments where diagnosis_id=$1",
              [id],
            );
            for (let step = 0; step < 4; step++) {
              await knownStep(() => generatePaid(id));
              const r = (
                await local!.pg.query<{ status: string }>(
                  "select status from paid_reports where diagnosis_id=$1",
                  [id],
                )
              ).rows[0];
              if (r.status === "ready") break;
              await fill();
            }
            requireCheck(
              (
                await local!.pg.query<{ status: string }>(
                  "select status from paid_reports where diagnosis_id=$1",
                  [id],
                )
              ).rows[0].status === "ready",
              "PAID_NOT_READY",
            );
          }
          const free = (
            await local!.pg.query(
              "select report_json from free_reports where diagnosis_id=$1",
              [id],
            )
          ).rows;
          const paid = (
            await local!.pg.query(
              "select report_json,status from paid_reports where diagnosis_id=$1",
              [id],
            )
          ).rows;
          await save(`diagnosis-${n}.json`, {
            ...(revision
              ? {
                  evaluationId: revision.evaluationIds[n as 6 | 7],
                  oldUnknownUnchanged: true,
                }
              : {}),
            label,
            answer,
            status,
            free,
            paid,
          });
        }
        caseResults.push({
          group: g,
          caseNumber: n,
          status: live
            ? "automated_checks_passed_quality_review_pending"
            : "synthetic_passed",
        });
        await save(`case-${g}-${n}-status.json`, {
          group: g,
          caseNumber: n,
          status: "completed",
          budget: gate!.summary(),
        });
      } catch {
        caseResults.push({
          group: g,
          caseNumber: n,
          status: "failed_or_incomplete",
        });
        throw Error("CASE_STOPPED");
      }
    }
    // Preserve completed cases. Repair only the rejected message draft, then
    // evaluate the unfinished cases with the common budget and remaining time.
    if (!revision && recovery && recoveryDirectory) {
      group = "diagnosis";
      caseNumber = 4;
      stopStage = "diagnosis_4_repair";
      const saved = JSON.parse(
        await readFile(
          path.join(recoveryDirectory, "diagnosis-4.json"),
          "utf8",
        ),
      );
      const type = (
        await local.pg.query<{ id: string }>(
          "select id from diagnosis_types where slug='partner-mind'",
        )
      ).rows[0].id;
      const repairId = "50000000-0000-4000-8000-000000000104";
      await local.pg.query(
        "insert into diagnoses(id,diagnosis_type_id,anonymous_session_id,question_flow_version) values($1,$2,'synthetic-evaluation','v1')",
        [repairId, type],
      );
      const repaired = await editForReader(
        repairId,
        "paid_report",
        paidSchema,
        paidSchema.parse(saved.paid[0].report_json),
        { deadline },
        [{ question_text: "今回の合成回答", answer_text: saved.answer }],
      );
      await save("diagnosis-4-repaired.json", {
        label: saved.label,
        answer: saved.answer,
        originalPreserved: true,
        paid: repaired,
      });
      caseResults.push({
        group,
        caseNumber,
        status: "automated_checks_passed_quality_review_pending",
      });
    } else if (!extension)
      for (const [g, n] of [
        ["consultation", 1],
        ["consultation", 14],
        ["diagnosis", 1],
      ] as const)
        await runCase(g, n);
    await save("pilot-ready.json", {
      cases: caseResults,
      budget: gate.summary(),
      live,
    });
    if (live && !extension) {
      while (Date.now() < deadline) {
        try {
          const review = JSON.parse(
            await readFile(path.join(directory, "pilot-review.json"), "utf8"),
          );
          requireCheck(review.approved === true, "PILOT_REJECTED");
          break;
        } catch (e) {
          if ((e as { code?: string }).code !== "ENOENT")
            throw Error("PILOT_REJECTED");
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      requireCheck(Date.now() < deadline, "EVALUATION_DEADLINE");
    }
    if (!recovery)
      for (let n = 2; n <= 13; n++) await runCase("consultation", n);
    for (
      let n = revision ? 6 : extension ? 7 : recovery ? 5 : 2;
      n <= (revision ? 7 : 10);
      n++
    ) {
      await runCase("diagnosis", n);
      // Review every newly completed live report before spending on the next.
      if (live) {
        await save(`review-ready-${n}.json`, {
          caseNumber: n,
          budget: gate.summary(),
        });
        let approved = false;
        while (Date.now() < deadline) {
          try {
            const review = JSON.parse(
              await readFile(path.join(directory, `review-${n}.json`), "utf8"),
            );
            requireCheck(review.approved === true, "QUALITY_REJECTED");
            approved = true;
            break;
          } catch (e) {
            if ((e as { code?: string }).code !== "ENOENT")
              throw Error("QUALITY_REJECTED");
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        requireCheck(approved, "EVALUATION_DEADLINE");
      }
    }
    terminal = "completed";
  } catch {
    terminal = "stopped";
  } finally {
    bridge.parse = async () => {
      throw Error("EVALUATION_CLOSED");
    };
    await local?.close();
    await journal.close();
    await rm(path.join(directory, "openai-key.json"), { force: true });
    await save("result.json", {
      live,
      terminal,
      stopStage,
      cases: caseResults,
      ...(extension
        ? {
            blockedCases: extension.blockedCases,
            timeHistory: extension.timeHistory,
          }
        : {}),
      budget: gate?.summary() ?? { calls: 0 },
      localDatabaseClosed: true,
      temporaryCredentialDeleted: true,
      billedUSD: null,
    });
    globalThis.fetch = originalFetch;
    console.error = oldError;
    vi.unstubAllEnvs();
  }
  requireCheck(
    terminal === "completed",
    "EVALUATION_STOPPED_SEE_NONSECRET_RESULT",
  );
}, 1250000);
