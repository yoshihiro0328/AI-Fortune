"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  canAdvance,
  demoPeople,
  demoQuestions,
  demoReply,
  demoResult,
} from "@/lib/demo/fixtures";
import { topics, type TopicId } from "@/lib/trial/topics";
import { pricing, defaultLimits, yen } from "@/lib/pricing";

function Frame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="demo-main">
      <Link href="/">← TOPに戻る</Link>
      <p className="demo-label">PREVIEW DEMO · 合成データ</p>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
function Diagnosis() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const question = demoQuestions[step];
  return (
    <Frame title="無料診断を体験する">
      <p>
        全12問の短いデモです。架空の状況を選んでください。結果は回答にかかわらず同じ表示例です。AIへの送信・診断データの保存はありません。
      </p>
      <p>このページを離れる・更新すると回答はリセットされます。</p>
      <section className="demo-card">
        <p role="status">
          質問 {step + 1} / {demoQuestions.length}
        </p>
        <progress
          value={step + 1}
          max={demoQuestions.length}
          aria-label="診断デモの進捗"
        />
        <fieldset>
          <legend>{question[0]}</legend>
          {question[1].map((choice, index) => (
            <label className="demo-option" key={choice}>
              <input
                type="radio"
                name={"question-" + step}
                checked={answers[step] === index}
                onChange={() => setAnswers({ ...answers, [step]: index })}
              />
              {choice}
            </label>
          ))}
        </fieldset>
        <div className="demo-actions">
          <button
            type="button"
            className="secondary"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            前の質問
          </button>
          <button
            type="button"
            disabled={!canAdvance(step, answers)}
            onClick={() =>
              step === demoQuestions.length - 1
                ? router.push("/result/demo-example")
                : setStep(step + 1)
            }
          >
            {step === demoQuestions.length - 1
              ? "合成データの結果例を見る"
              : "次の質問"}
          </button>
        </div>
      </section>
    </Frame>
  );
}
function Result({ detail = false }: { detail?: boolean }) {
  return (
    <Frame title={detail ? "詳細レポートの表示例" : "診断結果の表示例"}>
      <p className="demo-notice">
        合成データです。あなたや実在する相手の診断ではありません。AI生成・購入・有料権限の付与は行っていません。
      </p>
      <section className="demo-card">
        <h2>{demoResult.title}</h2>
        <p>{demoResult.summary}</p>
        <h3>事実として整理したこと（架空）</h3>
        <ul>
          {demoResult.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <h3>次の一歩の例</h3>
        <p>{demoResult.next}</p>
      </section>
      {detail && (
        <>
          <section className="demo-card">
            <h2>いくつかの見方</h2>
            <p>
              相手が忙しい、連絡の習慣が違うなど、複数の可能性があります。相手の本心や関係の行方を断定するものではありません。
            </p>
            <h3>言葉にする例</h3>
            <blockquote>
              「またゆっくり話せたらうれしい。都合のよいときに教えてね。」
            </blockquote>
            <h3>大切にしたいこと</h3>
            <p>
              返事を急かさず、自分の生活も大切にする。相手が距離を望んでいる場合は、その意思を尊重します。
            </p>
          </section>
          <section className="demo-card">
            <h2>旧1,980円レポートの表示確認</h2>
            <p>
              過去購入のレポートも通常モードでは元の購入情報に従います。この例には購入情報・閲覧権限はありません。
            </p>
            <button disabled>購入・決済はデモでは利用できません</button>
          </section>
        </>
      )}
      <div className="demo-actions">
        {!detail && (
          <Link className="button" href="/report/demo-example">
            詳細レポート例を見る（購入なし）
          </Link>
        )}
        <Link className="button secondary" href="/consult?demoThread=demo-a">
          継続相談のデモへ
        </Link>
        <Link href="/diagnosis/partner-mind">診断デモをやり直す</Link>
      </div>
    </Frame>
  );
}
function Plans() {
  return (
    <Frame title="料金プランを比べる">
      <p>
        料金と内容の表示例です。回数はデモ用の設定値で、実際の契約・残数を示しません。
      </p>
      <div className="demo-grid">
        {[
          [
            "無料",
            "0円",
            `初回診断・会員相談 月${defaultLimits.free}往復の表示例`,
          ],
          [
            "単発レポート",
            yen(pricing.report),
            "今回の相談を詳しく整理するレポート",
          ],
          [
            "Plus",
            `月額${yen(pricing.plus)}`,
            `継続相談 月${defaultLimits.plus}往復の表示例`,
          ],
        ].map(([name, price, copy]) => (
          <section className="demo-card" key={name}>
            <h2>{name}</h2>
            <p className="demo-price">
              {price}
              <small>（税込）</small>
            </p>
            <p>{copy}</p>
            {name === "無料" ? (
              <Link className="button" href="/diagnosis/partner-mind">
                無料診断のデモへ
              </Link>
            ) : (
              <button disabled>デモでは購入できません</button>
            )}
          </section>
        ))}
      </div>
      <p>
        ログイン・新規登録・決済は実行されません。旧1,980円レポートや既存の契約は変更しません。
      </p>
    </Frame>
  );
}
function Account() {
  return (
    <Frame title="アカウント画面の表示例">
      <p className="demo-notice">
        ログインしていません。以下は架空アカウントの表示例です。デモ表示は実認証として扱われません。
      </p>
      <section className="demo-card">
        <h2>サンプル利用者</h2>
        <dl>
          <dt>アカウント</dt>
          <dd>合成データ（実在しません）</dd>
          <dt>メール認証</dt>
          <dd>デモでは実施しません</dd>
          <dt>プラン</dt>
          <dd>無料プランの表示例・契約なし</dd>
        </dl>
        <div className="demo-actions">
          <button disabled>ログイン（デモでは無効）</button>
          <button disabled>新規登録（デモでは無効）</button>
          <button disabled>契約変更（デモでは無効）</button>
        </div>
      </section>
      <section className="demo-card">
        <h2>診断の表示例</h2>
        <p>サンプルAさんとの連絡について（合成データ）</p>
        <Link className="button secondary" href="/result/demo-example">
          診断結果例を開く
        </Link>
      </section>
      <Link href="/consult">相手別ホームを見る</Link>
    </Frame>
  );
}
function Conversation({ person }: { person: (typeof demoPeople)[number] }) {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  return (
    <Frame title={`${person.name}との継続相談デモ`}>
      <Link href="/consult">← 相手別ホームへ</Link>
      <p className="demo-notice">
        履歴・記憶・AI回答は合成データです。入力はこの画面内だけで扱い、送信・保存・解析しません。実在する人の情報を入力しないでください。
      </p>
      <section className="demo-card">
        <h2>相談履歴の例</h2>
        <p>
          <strong>架空の相談：</strong>返信を待っていると少し気になります。
        </p>
        <p>
          <strong>合成された回答例：</strong>
          事実と推測を分けて、自分の気持ちを整理してみましょう。
        </p>
        <div aria-live="polite">
          {messages.map((message, i) => (
            <div className="demo-message" key={i}>
              <p>
                <strong>画面内の入力（未送信）：</strong>
                {message}
              </p>
              <p>{demoReply}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="demo-card">
        <label htmlFor="demo-message">デモの相談入力（外部送信なし）</label>
        <textarea
          id="demo-message"
          rows={4}
          maxLength={300}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例：架空の返信ペースについて相談したいです。"
        />
        <p>{text.length}/300文字 · ページを離れる・更新すると消えます。</p>
        <div className="demo-actions">
          <button
            disabled={!text.trim() || messages.length >= 3}
            onClick={() => {
              setMessages([...messages, text.trim()]);
              setText("");
            }}
          >
            固定の回答例を表示（送信しません）
          </button>
          <button
            className="secondary"
            onClick={() => {
              setMessages([]);
              setText("");
            }}
          >
            デモ入力をリセット
          </button>
        </div>
        {messages.length >= 3 && (
          <p role="status">
            3回までの表示デモです。リセットして再度お試しください。
          </p>
        )}
      </section>
    </Frame>
  );
}
function People({ thread }: { thread: string }) {
  const person = demoPeople.find((p) => p.id === thread);
  if (person) return <Conversation key={person.id} person={person} />;
  return (
    <Frame title="相手別ホームの表示例">
      <p>
        架空の相手・相談履歴・記憶です。実際の相談やユーザーデータには接続していません。
      </p>
      <div className="demo-grid">
        {demoPeople.map((p) => (
          <section className="demo-card" key={p.id}>
            <p className="demo-label">合成データ</p>
            <h2>{p.name}</h2>
            <p>
              {p.relation} · {p.note}
            </p>
            <h3>記憶の表示例</h3>
            <p>返事を急かさず、落ち着いて話す時間を大切にしたい。</p>
            <Link className="button" href={`/consult?demoThread=${p.id}`}>
              継続相談デモを開く：{p.name}
            </Link>
          </section>
        ))}
      </div>
    </Frame>
  );
}
function PausedChat({ topic }: { topic: string }) {
  const selected = Object.hasOwn(topics, topic)
    ? topics[topic as TopicId]
    : topics.general;
  return (
    <Frame title={selected.title}>
      <p>{selected.name}</p>
      <p className="demo-notice">
        登録なし相談は現在準備中です。入力内容をAIへ送信することはありません。
      </p>
      <p>{selected.guide}</p>
      <p>{selected.policy}</p>
      <button disabled>登録なしで試す（準備中）</button>
      <p>
        <Link className="button" href="/diagnosis/partner-mind">
          じっくり無料診断する（デモ）
        </Link>
      </p>
    </Frame>
  );
}
export default function DemoScreen({
  path,
  topic = "general",
  thread = "",
}: {
  path: string;
  topic?: string;
  thread?: string;
}) {
  if (path === "/plans") return <Plans />;
  if (path === "/diagnosis/partner-mind") return <Diagnosis />;
  if (path === "/result/demo-example") return <Result />;
  if (path === "/report/demo-example") return <Result detail />;
  if (path === "/account") return <Account />;
  if (path === "/consult") return <People thread={thread} />;
  if (path === "/chat") return <PausedChat topic={topic} />;
  return (
    <Frame title="この画面はデモ対象外です">
      <p>
        実際のデータや認証・管理機能は利用できません。上の画面一覧からデモをお試しください。
      </p>
    </Frame>
  );
}
