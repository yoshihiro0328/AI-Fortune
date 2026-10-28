"use client";
import { useRef, useState } from "react";
import type { QuoteRow } from "@/lib/screenshot/model";
import type { Picture } from "./screenshot-picture-editor";
import ScreenshotSourcePreview from "./screenshot-source-preview";
export default function ScreenshotConversation({
  rows,
  pictures,
  onChange,
}: {
  rows: QuoteRow[];
  pictures: Picture[];
  onChange: (next: QuoteRow[]) => void;
}) {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const [selected, setSelected] = useState<string | null>(null),
    [view, setView] = useState("conversation"),
    [crop, setCrop] = useState(false),
    [splitAt, setSplitAt] = useState(""),
    [message, setMessage] = useState("");
  const current = rows.find((r) => r.id === selected) ?? rows[0],
    picture = pictures[current?.image ?? 0];
  const change = (id: string, patch: Partial<QuoteRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, step: number) => {
    const next = [...rows];
    [next[i], next[i + step]] = [next[i + step], next[i]];
    onChange(next);
  };
  return (
    <section
      className="conversation-review"
      aria-label="復元した会話の確認"
      data-view={view}
    >
      <h4>取り込んだ会話</h4>
      <p className="fine">
        左が相手、右が自分です。間違いのある吹き出しだけ選んで直してください。画像の順番は選択時の並びです。日時や重複候補も照合してください。
      </p>
      <div className="editor-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            onChange(
              rows.map((r) => ({
                ...r,
                speaker:
                  r.speaker === "me"
                    ? "other"
                    : r.speaker === "other"
                      ? "me"
                      : "unknown",
              })),
            )
          }
        >
          自分と相手をまとめて入れ替える
        </button>
      </div>
      <div className="review-view-switch" aria-label="照合する表示">
        <button
          type="button"
          className="button secondary"
          aria-pressed={view === "conversation"}
          onClick={() => setView("conversation")}
        >
          会話を見る
        </button>
        <button
          type="button"
          className="button secondary"
          aria-pressed={view === "image"}
          onClick={() => setView("image")}
        >
          画像を見る
        </button>
      </div>
      <div className="conversation-review-columns">
        <aside
          hidden={view !== "image"}
          className="review-source"
          aria-label="読み取り元の画像"
          tabIndex={0}
        >
          <p>画像 {(current?.image ?? 0) + 1}・選んだ発言の領域</p>
          {!picture && (
            <p>元画像は保持していません。文字の訂正は続けられます。</p>
          )}
          <button
            className="button secondary"
            type="button"
            aria-pressed={crop}
            onClick={() => setCrop(!crop)}
          >
            {crop ? "画像全体を見る" : "選んだ部分を拡大"}
          </button>
          {picture && (
            <ScreenshotSourcePreview
              source={picture.canvas}
              box={current?.sourceBox}
              crop={crop}
            />
          )}
        </aside>
        <div className="review-messages" hidden={view === "image"}>
          {rows.map((r, i) => (
            <article
              className={`restored-message speaker-${r.speaker}`}
              key={r.id}
            >
              <label className="message-include">
                <input
                  type="checkbox"
                  checked={!r.excluded}
                  onChange={(e) =>
                    change(r.id, { excluded: !e.target.checked })
                  }
                />
                発言{i + 1}を送る{r.excluded ? "（除外中）" : ""}
              </label>
              <button
                type="button"
                className="message-bubble"
                ref={(node) => {
                  buttons.current[r.id] = node;
                }}
                aria-expanded={selected === r.id}
                aria-controls={`edit-${r.id}`}
                onClick={() => {
                  setSelected(selected === r.id ? null : r.id);
                  setSplitAt("");
                  setMessage("");
                }}
              >
                <strong>
                  {r.speaker === "me"
                    ? "自分"
                    : r.speaker === "other"
                      ? "相手"
                      : "発言者：要確認"}
                </strong>
                {!r.keepUnknown &&
                  ((r.uncertain && !r.reviewed) ||
                    r.quotePending ||
                    r.speaker === "unknown") && (
                    <span className="review-badge">要確認</span>
                  )}
                {r.duplicateOf && (
                  <span className="review-badge">
                    前の画像との重複候補
                    {r.duplicateKept ? "（残す）" : "（未選択）"}
                  </span>
                )}
                {r.quote && (
                  <span className="quoted-message">引用：{r.quote}</span>
                )}
                <span className="restored-text">{r.text}</span>
                {(r.time || r.date) && (
                  <span className="message-time">
                    {[r.date, r.time].filter(Boolean).join(" ・ ")}
                  </span>
                )}
              </button>
              {selected === r.id && (
                <div className="message-editor" id={`edit-${r.id}`}>
                  <p className="fine">
                    画像 {(r.image ?? 0) + 1} の発言 {i + 1}。
                    {r.issues?.join("。")}
                  </p>
                  <label>
                    発言者
                    <select
                      aria-label="発言者"
                      value={r.speaker}
                      onChange={(e) =>
                        change(r.id, {
                          speaker: e.target.value as QuoteRow["speaker"],
                        })
                      }
                    >
                      <option value="unknown">要確認</option>
                      <option value="me">自分</option>
                      <option value="other">相手</option>
                    </select>
                  </label>
                  <label>
                    本文
                    <textarea
                      aria-label="本文"
                      value={r.text}
                      maxLength={1000}
                      onChange={(e) => change(r.id, { text: e.target.value })}
                    />
                  </label>
                  {r.quotePending && (
                    <p className="notice">
                      引用と本文が混ざっている可能性があります。本文を直し、引用部分を下の欄へ移してください。引用でなければ空欄で確定できます。
                    </p>
                  )}
                  <div className="message-dates">
                    <label>
                      日付（読めた範囲だけ・空欄可）
                      <input
                        value={r.date ?? ""}
                        maxLength={80}
                        onChange={(e) => change(r.id, { date: e.target.value })}
                      />
                    </label>
                    <label>
                      時刻（空欄可）
                      <input
                        value={r.time ?? ""}
                        maxLength={40}
                        onChange={(e) => change(r.id, { time: e.target.value })}
                      />
                    </label>
                  </div>
                  {r.duplicateOf && (
                    <div className="editor-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() =>
                          change(r.id, { duplicateKept: true, excluded: false })
                        }
                      >
                        重複候補を残す
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => change(r.id, { excluded: true })}
                      >
                        重複候補を除外
                      </button>
                    </div>
                  )}
                  <div className="editor-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        change(r.id, { reviewed: true, keepUnknown: false })
                      }
                    >
                      訂正した内容を確認した
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => change(r.id, { keepUnknown: true })}
                    >
                      不明部分を明示したまま使う
                    </button>
                  </div>
                  {r.keepUnknown && (
                    <p className="fine">
                      発言者不明・判読困難・引用の区別不明は、不明と明示して送ります。推測で補いません。
                    </p>
                  )}
                  <details>
                    <summary>引用・分割・結合・並べ替え</summary>
                    <label>
                      引用された文（発言者は確定しません）
                      <textarea
                        aria-label="引用された文（発言者は確定しません）"
                        value={r.quote ?? ""}
                        maxLength={1000}
                        onChange={(e) =>
                          change(r.id, { quote: e.target.value })
                        }
                      />
                    </label>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() =>
                        change(r.id, { quotePending: false, reviewed: true })
                      }
                    >
                      引用と本文の区別を確認した
                    </button>
                    <label>
                      この文字列の直前で分割
                      <input
                        value={splitAt}
                        onChange={(e) => setSplitAt(e.target.value)}
                        placeholder="分けたい後半の冒頭を入力"
                      />
                    </label>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={Boolean(r.quote || r.quotePending)}
                      onClick={() => {
                        const at = splitAt ? r.text.indexOf(splitAt) : -1;
                        if (at <= 0) {
                          setMessage(
                            "本文の途中にある文字列を指定してください。",
                          );
                          return;
                        }
                        const next = [...rows];
                        next.splice(
                          i,
                          1,
                          { ...r, text: r.text.slice(0, at).trim() },
                          {
                            ...r,
                            id: crypto.randomUUID(),
                            text: r.text.slice(at).trim(),
                          },
                        );
                        onChange(next);
                        setMessage("発言を2つに分けました。");
                      }}
                    >
                      ここで分割
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={
                        i === rows.length - 1 ||
                        rows[i + 1]?.speaker !== r.speaker ||
                        rows[i + 1]?.image !== r.image ||
                        rows[i + 1]?.quotePending ||
                        r.quotePending ||
                        Boolean(rows[i + 1]?.quote || r.quote) ||
                        r.text.length + (rows[i + 1]?.text.length ?? 0) > 999
                      }
                      onClick={() => {
                        const next = [...rows],
                          after = rows[i + 1];
                        next.splice(i, 2, {
                          ...r,
                          text: r.text + "\n" + rows[i + 1].text,
                          uncertain: r.uncertain || after.uncertain,
                          issues: [
                            ...new Set([
                              ...(r.issues ?? []),
                              ...(after.issues ?? []),
                            ]),
                          ],
                          time: r.time === after.time ? r.time : undefined,
                          date: r.date === after.date ? r.date : undefined,
                          sourceBox:
                            r.sourceBox && after.sourceBox
                              ? {
                                  x0: Math.min(
                                    r.sourceBox.x0,
                                    after.sourceBox.x0,
                                  ),
                                  y0: Math.min(
                                    r.sourceBox.y0,
                                    after.sourceBox.y0,
                                  ),
                                  x1: Math.max(
                                    r.sourceBox.x1,
                                    after.sourceBox.x1,
                                  ),
                                  y1: Math.max(
                                    r.sourceBox.y1,
                                    after.sourceBox.y1,
                                  ),
                                }
                              : r.sourceBox,
                        });
                        onChange(next);
                      }}
                    >
                      次の同じ発言者と結合
                    </button>
                    <div className="editor-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        上へ
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={i === rows.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        下へ
                      </button>
                    </div>
                  </details>
                  <label>
                    <input
                      type="checkbox"
                      checked={r.uncertain}
                      onChange={(e) =>
                        change(r.id, { uncertain: e.target.checked })
                      }
                    />
                    読めない部分・不確かな箇所を含む
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      onChange(rows.filter((v) => v.id !== r.id));
                      setSelected(null);
                      buttons.current[
                        rows[i + 1]?.id ?? rows[i - 1]?.id
                      ]?.focus();
                    }}
                  >
                    この発言を削除
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setSelected(null);
                      buttons.current[r.id]?.focus();
                    }}
                  >
                    編集を閉じる
                  </button>
                  <p role="status">{message}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
