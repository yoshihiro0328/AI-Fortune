import { z } from "zod";
export type TopicField = {
  key: string;
  label: string;
  options?: string[];
  placeholder?: string;
};
export type Topic = {
  name: string;
  title: string;
  guide: string;
  label: string;
  placeholder: string;
  policy: string;
  fields: TopicField[];
};
export const topicIds = [
  "general",
  "reply",
  "crush",
  "distance",
  "reunion",
] as const;
export type TopicId = (typeof topicIds)[number];
export const topics: Record<TopicId, Topic> = {
  general: {
    name: "自由に相談",
    title: "いま、気になることから。",
    guide: "まとまっていなくても大丈夫。話したいことを一つ教えてください。",
    label: "相談したいこと",
    placeholder: "例：相手との距離が気になっています。",
    policy: "出来事と気持ちを分け、無理のない一歩を一緒に考えます。",
    fields: [],
  },
  reply: {
    name: "返信・LINE",
    title: "無理のない返信を、一緒に。",
    guide:
      "届いた言葉と、伝えたいことから考えます。実名や連絡先は省いてください。",
    label: "伝えたいこと・迷っていること",
    placeholder:
      "例：うれしい気持ちは伝えたいけれど、重くならないか迷っています。",
    policy:
      "相手が言っていない予定や行動を作らず、返信案と送る際の注意を示します。返事待ちへの連投を促しません。",
    fields: [
      {
        key: "received",
        label: "届いた言葉（任意）",
        placeholder: "例：最近どう？",
      },
      {
        key: "tone",
        label: "返したい雰囲気（任意）",
        options: [
          "まだ決めていない",
          "気軽に",
          "少し丁寧に",
          "自分の気持ちを伝える",
        ],
      },
    ],
  },
  crush: {
    name: "片思い",
    title: "距離を縮める、小さな一歩。",
    guide:
      "いまの関わり方と、どうなりたいかを教えてください。「まだ分からない」でも大丈夫です。",
    label: "いま気になっていること",
    placeholder: "例：もう少し話したいけれど、誘ってよいか迷っています。",
    policy: "脈あり度を断定せず、相手が断れる余地のある小さな行動を考えます。",
    fields: [
      {
        key: "connection",
        label: "今の関わり方（任意）",
        options: [
          "まだ分からない",
          "知り合ったばかり",
          "ときどき話す",
          "ふたりで会うことがある",
        ],
      },
      {
        key: "wish",
        label: "今、望んでいること（任意）",
        options: [
          "気持ちを整理したい",
          "もっと話したい",
          "会うきっかけがほしい",
          "気持ちを伝えたい",
        ],
      },
    ],
  },
  distance: {
    name: "恋人との距離",
    title: "すれ違いを、ほどくために。",
    guide:
      "最近変わったことから整理します。どちらが悪いかを決めるための相談ではありません。",
    label: "最近あったこと・話したいこと",
    placeholder: "例：会う時間が減り、寂しいことをどう伝えるか考えたいです。",
    policy:
      "事実と解釈を分け、「私は」を主語にした伝え方を提案します。危険があるときは話し合いを強制せず安全を優先します。",
    fields: [
      {
        key: "change",
        label: "気になる変化（任意）",
        options: [
          "まだ整理できない",
          "連絡が減った",
          "会う時間が減った",
          "言い争いが増えた",
        ],
      },
      {
        key: "goal",
        label: "今回、考えたいこと（任意）",
        options: [
          "気持ちを整理する",
          "話すきっかけをつくる",
          "自分の希望を伝える",
          "距離の取り方を考える",
        ],
      },
    ],
  },
  reunion: {
    name: "復縁",
    title: "もう一度向き合う前に。",
    guide:
      "連絡できる状況と、あなたの希望から整理します。相手が距離を望む場合は、その意思を尊重します。",
    label: "相談したいこと・今の気持ち",
    placeholder:
      "例：連絡するか迷っています。まず自分の気持ちを整理したいです。",
    policy:
      "復縁の確率や相手の心理を断定しません。拒否やブロックを尊重し、別アカウントや知人経由の接触を提案しません。",
    fields: [
      {
        key: "contact",
        label: "今の連絡状況（任意）",
        options: [
          "まだ分からない",
          "連絡を取り合っている",
          "連絡していない",
          "連絡を控えてと言われた",
        ],
      },
      {
        key: "time",
        label: "別れてから（任意）",
        options: ["答えない", "1か月未満", "1〜6か月", "半年以上"],
      },
    ],
  },
};
export function intakeSchema(max = 800) {
  return z
    .object({
      requestId: z.uuid(),
      topicId: z.enum(topicIds),
      topicVersion: z.literal(1),
      text: z.string().trim().min(1).max(max),
      fields: z.record(z.string(), z.string().max(160)),
    })
    .strict()
    .superRefine((v, ctx) => {
      const fields = topics[v.topicId].fields;
      for (const [key, value] of Object.entries(v.fields)) {
        const f = fields.find((f) => f.key === key);
        if (!f || (value && f.options && !f.options.includes(value)))
          ctx.addIssue({
            code: "custom",
            message: "テーマの入力をご確認ください。",
            path: ["fields", key],
          });
      }
      if (v.text.length + Object.values(v.fields).join("").length > 1200)
        ctx.addIssue({ code: "custom", message: "入力が長すぎます。" });
    });
}
export type Intake = z.infer<ReturnType<typeof intakeSchema>>;
export const answerSchema = z
  .object({ answer: z.string().min(20).max(500), safety: z.boolean() })
  .strict();
export const consentVersion = "trial-2026-10-15";
