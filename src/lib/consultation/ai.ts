import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { required } from "@/lib/config";
import { db, checked } from "@/lib/supabase/admin";
import { base } from "@/lib/ai/prompts/base";
import { styleIssues } from "@/lib/ai/style";
import { estimateCost } from "@/lib/ai/cost";
import { chatSchema, safetySchema } from "./model";
export const chatPrompt = `継続する恋愛相談です。毎回診断や質問票に戻さず、最新の出来事を中心に直接答える。必要な場合だけ過去の具体的な話に1文で触れる。「なるほど」「そうなんですね」「ありがとうございます」を定型の冒頭にしない。十分な情報があれば具体的な行動や返信例を出し、不足時だけ質問を1つまで。質問は1文に複数の質問事項を詰め込まず、今必要な1点だけにする。直前の回答と同じ相づち、相談内容の言い直し、心理を断定できないという断りを毎回繰り返さない。新たな事情がなければ前回の注意事項を繰り返さず、今回の問いへの答えを先に書く。簡潔な2〜5段落、200〜650文字程度。終了の意思は尊重する。渡された同じ相手の記憶と最近の会話のみを使い、他の相手の話や未提示の出来事を作らない。古い記憶は当時の申告であり現在の事実と決めつけない。「直後」「さっき」「まだ返事がない」など、利用者が示していない時間経過や状態を補わない。判断に必要なら「誘ってから日が浅いなら」のように条件を付ける。時刻の前後と明示的な訂正を尊重し、両立しない事実は勝手に統合せず必要な点だけ確認する。記憶のsuggestionは提案に過ぎず実行した事実ではない。LINEを送ったばかりで返事待ちなら追い連絡を重ねさせない。現在危険がある場合はsafety=trueにして通常の恋愛助言から安全確保へ。危険を否定する文言だけでsafety=trueにしないが他の記述に危険があれば優先する。安全支援に課金・利用回数の話を入れない。「日曜空いてる？」だけなら会う誘いと断定せず、予定を聞かれたと表す。返信文案の中でも未確認の行動や予定を作らない。例：映画を観たと本人が言っていないなら「観てみたよ」と書かず、好きな作品やおすすめを尋ねる。予定を聞かれただけなら「誘ってくれて」と書かない。ユーザーの空き時間が不明なら「空いているなら」と条件を付ける。返信案は提案として明示し、相手が言っていない目的や日時を確定事項にしない。factsには今回のmessageに実在する引用のみ最大6個をそのまま保存。以前のmemoryやrecentの内容を今回のfactsへ再登録しない。文の創作・要約・相手の心理推測は保存禁止。提案だけはkind=suggestionで今回answerの実在する一部をそのまま引用。出典のない情報はfactsに入れない。
回答の書き出しは、今回の問いへの答えや具体的な着眼点にする。利用者の発言を「〜なんですね」と言い直す段落は省く。「気持ちは分かりません」という同じ断りを連続して書かず、新しい判断に必要な不確実性だけを短く示す。安全に関する案内は必要な場面で省かない。
例：「昨日、彼からLINEが来た」には「まだ返していないなら、届いた内容に合わせて返してみてください。どんな内容でしたか？」のように次の行動へ進める。「今返信した方がいいかな？」には「今返して大丈夫です。駆け引きのために待たず、届いた内容への返事から始めましょう。」のように直接答える。例をそのまま定型文として繰り返さず、実際の会話に合わせる。`;
type Context = { user: string; turn?: string; plan: string; isTest?: boolean };
async function invoke<T>(
  ctx: Context,
  stage: string,
  prompt: string,
  schema: z.ZodType<T>,
  input: unknown,
) {
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-6-luna";
  const start = Date.now();
  const call = checked(
    await db()
      .from("consultation_ai_calls")
      .insert({
        user_id: ctx.user,
        turn_id: ctx.turn ?? null,
        stage,
        model,
        plan: ctx.plan,
        is_test: ctx.isTest ?? true,
      })
      .select("id")
      .single(),
  )!;
  let usage: OpenAI.Responses.ResponseUsage | undefined;
  try {
    const r = await new OpenAI({
      apiKey: required("OPENAI_API_KEY"),
      maxRetries: 0,
      timeout: 60000,
    }).responses.parse({
      model,
      store: false,
      reasoning: { effort: "low" },
      input: [
        { role: "system", content: base + "\n" + prompt },
        { role: "user", content: JSON.stringify({ untrusted_data: input }) },
      ],
      text: { format: zodTextFormat(schema, stage) },
      max_output_tokens: 2400,
    });
    usage = r.usage;
    const parsed = schema.parse(r.output_parsed);
    checked(
      await db()
        .from("consultation_ai_calls")
        .update({
          ...usageFields(model, usage),
          execution_ms: Date.now() - start,
          success: true,
        })
        .eq("id", call.id),
    );
    return parsed;
  } catch (error) {
    await db()
      .from("consultation_ai_calls")
      .update({
        ...usageFields(model, usage),
        execution_ms: Date.now() - start,
        success: false,
      })
      .eq("id", call.id);
    throw error;
  }
}
function usageFields(
  model: string,
  usage: OpenAI.Responses.ResponseUsage | undefined,
) {
  if (!usage) return {};
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cached_tokens: usage.input_tokens_details.cached_tokens,
    cache_write_tokens: usage.input_tokens_details.cache_write_tokens ?? 0,
    ...estimateCost(model, usage),
  };
}
export async function chatAnswer(ctx: Context, input: unknown) {
  const message = z.object({ message: z.string() }).parse(input).message;
  let result = await invoke(ctx, "chat", chatPrompt, chatSchema, input);
  const issues = styleIssues([{ path: "answer", text: result.answer }]);
  if (issues.length)
    result = await invoke(
      ctx,
      "chat_edit",
      chatPrompt +
        "\n下書きの事実と数字と安全判断を変えずに自然な日本語へ修正。" +
        issues.join("、"),
      chatSchema,
      { context: input, draft: result },
    );
  if (styleIssues([{ path: "answer", text: result.answer }]).length)
    throw new Error("Chat quality check failed");
  return {
    ...result,
    facts: result.facts.filter((f) =>
      (f.kind === "suggestion" ? result.answer : message).includes(f.quote),
    ),
  };
}
export async function checkChatSafety(ctx: Context, text: string) {
  return invoke(
    ctx,
    "chat_safety",
    "現在の具体的な危険（暴力・脅迫・自傷・監禁・ストーカー・性的強要・児童への危険）を文脈で判断。明確な否定だけならsafety=false。否定していても別の具体的危険があればtrue。危険なら安全確保と緊急時の地域窓口への案内を短くanswerへ。通常相談ならanswerは空文字。課金の案内は禁止。",
    safetySchema,
    { message: text },
  );
}
