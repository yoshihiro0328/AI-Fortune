import Link from "next/link";
import { notFound } from "next/navigation";
import { operator, operatorInfoComplete } from "@/lib/operator";
import { serviceSettings } from "@/lib/service-settings";
import {
  sentence,
  responseTimeLabel,
  testPaymentNotice,
} from "@/lib/display-copy";
import BillingTerms from "@/components/billing-terms";
export const dynamic = "force-dynamic";
type Section = {
  title: string;
  paragraphs?: string[];
  items?: string[];
  details?: [string, string][];
};
const pages: Record<string, { title: string; sections: Section[] }> = {
  terms: {
    title: "利用規約",
    sections: [
      {
        title: "サービスの対象と内容",
        paragraphs: [
          "よりそいは18歳以上の方を対象に、回答内容をもとに恋愛関係の状況を整理するAIサービスです。",
          "医療、心理療法、法律相談などの専門サービスを提供するものではありません。相手の本心や未来、結果の正確性を保証するものではありません。",
        ],
      },
      {
        title: "利用上のお願い",
        paragraphs: [
          "第三者の氏名・住所・連絡先など、個人を特定できる情報は入力しないでください。",
        ],
        items: [
          "不正アクセスや、他の人の権利を侵害する行為を禁止します。",
          "相手への嫌がらせや、相手を意のままに動かすことを目的とした利用を禁止します。",
        ],
      },
      {
        title: "会員登録と診断の保存",
        paragraphs: [
          "無料診断は会員登録なしで利用できます。同じブラウザで診断を再開できるよう、回答とブラウザを見分ける情報を保存します。",
          "メールアドレスとパスワードで会員登録できます。確認メールの手続き後に診断をアカウントへ保存すると、別の端末からも見返せます。共有端末では、他の方の診断を保存しないでください。",
          "会員登録せずに使った診断は、ブラウザの保存情報（Cookie）を削除すると復元できないことがあります。",
        ],
      },
      {
        title: "単発の詳細レポート",
        paragraphs: [
          "購入は任意です。関係や行動についての分析、連絡の提案、LINE文面3案、7日・30日の行動プランなど、13項目を提供します。料金とPlusとの違いは、下の「無料プラン・Plus・単発購入の違い」でご確認ください。",
        ],
      },
      {
        title: "サービスの中断と責任の範囲",
        paragraphs: [
          "保守や障害により、サービスの提供を中断する場合があります。",
          "運営者の故意・重大な過失など、法令により免責できない責任を排除するものではありません。",
        ],
      },
    ],
  },
  privacy: {
    title: "プライバシーポリシー",
    sections: [
      {
        title: "取り扱う情報",
        items: [
          "診断への回答、分析結果、購入したレポート",
          "相談相手の呼び名、会話履歴、次の相談に引き継ぐメモ、利用回数",
          "登録したメールアドレス、ログイン情報、会員登録なしで利用したブラウザを見分ける情報",
          "購入・契約を確認するための情報、ページの閲覧などの利用記録",
          "お問い合わせの氏名・メールアドレス・内容・対応状況",
        ],
        paragraphs: [
          "パスワードはログインを管理する外部サービスで扱い、診断内容を保存する場所には保存しません。カード番号は決済サービスが取り扱い、よりそいでは保存しません。外部サービス名は下に記載しています。",
        ],
      },
      {
        title: "情報を使う目的",
        items: [
          "診断・レポート・チャット相談を提供し、前に話した内容を次の相談へ引き継ぐため",
          "契約・利用回数・購入状況を確認し、診断履歴を保存するため",
          "メールアドレスの確認とお問い合わせへの対応のため",
          "不正利用の防止、障害対応、個人を特定しない利用状況の集計のため",
        ],
        paragraphs: ["相談内容をSNSへ投稿することはありません。"],
      },
      {
        title: "AIが回答を作るために使う情報",
        paragraphs: [
          "診断や相談への回答を作るため、入力した内容をOpenAIに送信します。",
          "続きから相談するときは、その相手についてのメモ、最近の必要な会話、その相手の相談に追加した診断の回答を使います。毎回すべての会話を送るわけではありません。",
          "OpenAI側で回答を後から呼び出すための保存機能は使っていません。ただし、処理の高速化のために一時的に保持される場合があります。また、不正利用の監視のため、入力や回答が原則最大30日間保存される場合があります。法令や安全確保のため、これより長く保存される場合もあります。",
        ],
      },
      {
        title: "利用する外部サービスと送信先",
        details: [
          [
            "OpenAI（AIによる分析・回答）",
            "診断への回答、相談内容、回答作成に必要な過去の会話やメモを送信します。",
          ],
          [
            "Supabase・Supabase Auth（保存・ログイン管理）",
            "診断・相談・問い合わせの内容、メールアドレス、ログイン情報などを保存・管理します。パスワードはSupabase Authで管理します。",
          ],
          [
            "Vercel（サイトの配信・処理）",
            "ページの表示や操作を受け付けるため、アクセス情報や送信した内容を処理します。",
          ],
          [
            "Stripe（決済・契約管理）",
            "購入・契約情報と、決済画面で入力した支払い情報を取り扱います。支払いにはStripe Checkout、契約の管理にはStripe Customer Portalを利用します。",
          ],
          [
            "Resend（問い合わせメールの送信を有効にした場合）",
            "送信先メールアドレス、受付番号、運営からの返信本文を取り扱います。問い合わせ本文は、受付メールや運営への受付通知には含めません。",
          ],
        ],
        paragraphs: [
          "各サービスの所在地や処理地域により、情報が日本国外で処理される場合があります。外部サービス側での保存・削除には、各提供事業者の方針も適用されます。",
        ],
      },
      {
        title: "ブラウザの保存情報と利用状況の集計",
        paragraphs: [
          "ログイン状態を保ち、会員登録なしの診断を再開できるように、Cookieというブラウザ内の保存情報を使います。",
          "短時間の大量アクセスを防ぐため、通信元の情報（IPアドレス）を元に戻せない形式へ変換して照合します。利用状況の集計には回答本文を含めません。Google Analyticsは利用していません。",
        ],
      },
      {
        title: "保存期間と相談画面での削除",
        paragraphs: [
          sentence(operator.retention),
          "次の相談に引き継ぐメモは、相談画面で確認・修正・削除できます。相談履歴も削除できます。削除した会話やメモは、その後の回答には使いません。",
          "不正利用防止のため、本文を含まない利用回数の記録は利用期間中保持し、期間終了後の定期処理で削除します。決済記録と購入済みの診断は別に管理します。",
          "現在はテスト公開中です。実在する人の個人情報や、健康などの特に配慮が必要な情報を入力しないでください。",
        ],
      },
      {
        title: "開示・訂正・削除・退会の依頼",
        paragraphs: [
          "情報の開示・訂正・削除は、お問い合わせフォームでご相談ください。本人確認後に対応します。",
        ],
        items: [
          "診断データの削除や退会をご希望の場合は、その旨と登録メールアドレスをお知らせください。診断番号が分かる場合は、あわせてご記入ください。",
          "会員登録なしで利用した方は、診断に使ったブラウザの保存情報を消さずにご連絡ください。診断番号だけでは本人確認になりません。",
          "パスワード・カード番号・本人確認書類をフォームに送らないでください。",
        ],
        details: [
          [
            "本人確認と対象範囲の確認後に削除する情報",
            "回答、分析結果、レポート、相談履歴、引き継ぐメモ、関連するAIの作成履歴。退会の場合は、プロフィールとログイン用のアカウントも削除します。",
          ],
        ],
      },
      {
        title: "削除の対象外となる場合",
        paragraphs: [
          "決済・返金の処理中や、法令上の保存義務、不正利用の調査などで必要な情報は、目的と期間を確認し、必要最小限に限って保持する場合があります。",
          "診断本文を会計記録と一緒に残すことはしません。保存する情報・理由・期間は、対応時にご案内します。外部サービスの記録やバックアップは、各提供事業者の削除・保存手順も確認します。",
          "法令上の保存期間は情報の種類などによって異なるため、一律には定めていません。運営者が本番販売前に確認します。",
        ],
      },
    ],
  },
  commerce: {
    title: "特定商取引法に基づく表記",
    sections: [
      {
        title: "運営者情報",
        details: [
          ["販売事業者", operator.name],
          ["運営責任者", operator.representative],
          ["所在地", operator.address],
          ["電話番号", operator.phone],
          ["メールアドレス", operator.email],
        ],
      },
      {
        title: "販売価格と追加費用",
        paragraphs: [
          "料金と自動更新の有無は、下の「無料プラン・Plus・単発購入の違い」に記載しています。表示価格は税込です。インターネット通信費は利用者の負担となります。",
        ],
      },
      {
        title: "支払い方法と時期",
        paragraphs: [
          "決済画面に表示される支払い方法を利用できます。単発購入は購入手続き時、Plusは申込時と毎月の更新日に決済します。決済にはStripe Checkoutを利用します。",
        ],
      },
      {
        title: "レポートの提供時期",
        paragraphs: [
          "決済を確認した後にAIがレポートを作成し、通常は数分以内に画面に表示します。障害が起きた場合は、改めて作成します。",
        ],
      },
      {
        title: "返品・キャンセル",
        paragraphs: [
          sentence(operator.refundPolicy),
          "サービスを提供できない場合や重複課金などへの対応は、返金・キャンセルポリシーをご確認ください。",
        ],
      },
    ],
  },
  refund: {
    title: "返金・キャンセルポリシー",
    sections: [
      {
        title: "この方針の対象",
        paragraphs: [
          "以下は、実際に代金をお支払いいただく場合の返金・キャンセル方針です。現在のテスト決済では実請求は発生しません。",
        ],
      },
      {
        title: "レポートを作成できなかった場合",
        paragraphs: [
          "再購入せず、同じ診断の画面から追加料金なしで作成をやり直してください。",
          "システム障害で提供できない場合や、同じ購入で重複課金が確認された場合は、運営が確認したうえで返金します。",
        ],
      },
      {
        title: "お客様都合のキャンセル・返金",
        paragraphs: [
          sentence(operator.refundPolicy),
          "ただし、適用法令上の権利を制限するものではありません。Plusの解約は次回以降の自動更新を止める手続きであり、返金の申請とは異なります。",
        ],
      },
      {
        title: "返金の相談方法",
        paragraphs: [
          "お問い合わせフォームから、診断番号と状況をお知らせください。",
          sentence(responseTimeLabel(operator.responseTime)),
          "返金を受け付けたレポートは閲覧できなくなります。",
        ],
      },
    ],
  },
  ai: {
    title: "AI利用について",
    sections: [
      {
        title: "できること・できないこと",
        paragraphs: [
          "回答内容をもとに、考えられる状況や行動の選択肢を整理します。相手の心を読み取ったり、浮気・恋愛の成功・将来を断定したりすることはできません。",
        ],
      },
      {
        title: "診断結果の点数について",
        paragraphs: [
          "点数は回答内容を整理するための目安です。統計的な成功確率ではなく、実際の相手の気持ちや未来を保証するものではありません。",
        ],
      },
      {
        title: "前の相談から引き継ぐこと",
        paragraphs: [
          "話していただいた内容を引用したメモを使って、次の相談に回答します。AIが提案したことと、実際に行ったことは区別します。古い情報が今も正しいとは限りません。",
          "引き継ぐメモは、相談画面の「覚えていること・最近の出来事」で確認・修正・削除できます。",
        ],
      },
      {
        title: "安全への配慮",
        paragraphs: [
          "暴力、脅迫、自傷などの危険が疑われる場合は、通常の恋愛相談に代えて安全のための案内を表示します。有料プランへの加入や、残りの相談回数は必要ありません。",
          "AIが危険を見逃す可能性もあります。今、危険が迫っている場合は、地域の緊急窓口や専門家に相談してください。",
        ],
      },
      {
        title: "提案をどう使うか",
        paragraphs: [
          "提案をそのまま実行する必要はありません。相手の意思や、相手が望まないことを尊重し、ご自身の安全を大切にして選んでください。",
        ],
      },
    ],
  },
  disclaimer: {
    title: "免責事項",
    sections: [
      {
        title: "AIの回答には限界があります",
        paragraphs: [
          "AIが作成した内容には、誤りや偏りが含まれる可能性があります。結果は医療・心理検査の診断や、法律・金融などの専門的な助言ではありません。",
        ],
      },
      {
        title: "保証しないことと責任の範囲",
        paragraphs: [
          "相手の心理、恋愛関係がうまくいくかどうか、将来の出来事を保証するものではありません。",
          "法令上認められない責任の免除は適用しません。",
        ],
      },
    ],
  },
  advertising: {
    title: "広告・アフィリエイトについて",
    sections: [
      {
        title: "現在の提供状況",
        paragraphs: [
          "現在、広告の掲載や、紹介料を受け取る商品・サービスの紹介は行っていません。",
          "よりそいの紹介文を共有するかどうかは任意です。紹介文に相談本文や個人情報は含めません。",
        ],
      },
      {
        title: "今後、広告などを掲載する場合",
        paragraphs: [
          "広告や、紹介料を受け取るリンクには、そのことが分かる表示を付けます。",
          "サービスを紹介する際は、利用者に合っているかを優先します。報酬額を理由に紹介の順位を決めません。",
        ],
      },
    ],
  },
};
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return {
    title: pages[slug]?.title ?? "ページが見つかりません",
    alternates: { canonical: "/legal/" + slug },
    robots: {
      index: process.env.PUBLIC_INDEXING_ENABLED === "true",
      follow: process.env.PUBLIC_INDEXING_ENABLED === "true",
    },
  };
}
export default async function Legal({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const p = pages[slug];
  if (!p) notFound();
  const limits = await serviceSettings();
  const billing = ["terms", "commerce", "refund"].includes(slug);
  return (
    <main id="main" className="legal">
      <p className="eyebrow">ご利用にあたって · 2026年10月9日</p>
      <h1>{p.title}</h1>
      {!operatorInfoComplete && (
        <p className="notice">
          テスト公開用の内容です。運営者情報に未設定の項目があるため、本番販売は開始していません。
        </p>
      )}
      <p className="fine legal-test-note">{testPaymentNotice}</p>
      <nav className="legal-toc" aria-label="このページの目次">
        <p>
          <strong>このページの内容</strong>
        </p>
        <ul>
          {p.sections.map((s, i) => (
            <li key={s.title}>
              <a href={"#section-" + i}>{s.title}</a>
            </li>
          ))}
          {billing && (
            <>
              <li>
                <a href="#plans-and-prices">無料プラン・Plus・単発購入の違い</a>
              </li>
              <li>
                <a href="#consultation-count">相談回数と更新日</a>
              </li>
              <li>
                <a href="#renewal-and-cancellation">自動更新と解約方法</a>
              </li>
            </>
          )}
        </ul>
      </nav>
      {p.sections.map((s, i) => (
        <section id={"section-" + i} key={s.title}>
          <h2>{s.title}</h2>
          {s.items && (
            <ul>
              {s.items.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {s.details && (
            <dl>
              {s.details.map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {s.paragraphs?.map((x) => (
            <p key={x}>{x}</p>
          ))}
          {slug === "privacy" && i === 2 && (
            <p>
              <a href="https://developers.openai.com/api/docs/guides/your-data">
                OpenAIのデータ取扱方針（英語）
              </a>
            </p>
          )}
        </section>
      ))}
      {billing && (
        <BillingTerms free={limits.free_limit} plus={limits.plus_limit} />
      )}
      <section>
        <h2>お問い合わせ・関連する方針</h2>
        <p>{responseTimeLabel(operator.responseTime)}</p>
        <p>
          <Link href="/contact">
            お問い合わせ・データの取り扱いに関するご相談
          </Link>
        </p>
        <p>
          <Link href="/legal/privacy">プライバシーポリシー</Link> ·{" "}
          <Link href="/legal/refund">返金・キャンセルポリシー</Link> ·{" "}
          <Link href="/plans">料金とプラン</Link>
        </p>
      </section>
    </main>
  );
}
