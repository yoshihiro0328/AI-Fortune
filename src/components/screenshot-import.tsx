"use client";
import { useEffect, useRef, useState } from "react";
import {
  confirmedTranscript,
  imageDimensions,
  percentageRect,
  validateDimensions,
  validateImages,
  type QuoteRow,
} from "@/lib/screenshot/model";
import { recognizeLocally } from "@/lib/screenshot/ocr";
type Picture = { id: string; canvas: HTMLCanvasElement };
function PictureEditor({
  picture,
  onEdit,
}: {
  picture: Picture;
  onEdit: (p: Picture) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [rect, setRect] = useState([0, 0, 100, 15]),
    [error, setError] = useState("");
  useEffect(() => {
    const c = ref.current;
    if (c) {
      c.width = picture.canvas.width;
      c.height = picture.canvas.height;
      c.getContext("2d")?.drawImage(picture.canvas, 0, 0);
    }
  }, [picture]);
  function edit(crop: boolean) {
    try {
      const r = percentageRect(
          rect,
          picture.canvas.width,
          picture.canvas.height,
        ),
        c = document.createElement("canvas");
      c.width = crop ? r.width : picture.canvas.width;
      c.height = crop ? r.height : picture.canvas.height;
      const ctx = c.getContext("2d")!;
      if (crop)
        ctx.drawImage(
          picture.canvas,
          r.x,
          r.y,
          r.width,
          r.height,
          0,
          0,
          r.width,
          r.height,
        );
      else {
        ctx.drawImage(picture.canvas, 0, 0);
        ctx.fillStyle = "#111";
        ctx.fillRect(r.x, r.y, r.width, r.height);
      }
      onEdit({ ...picture, canvas: c });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="screenshot-picture">
      <canvas
        ref={ref}
        role="img"
        aria-label="処理対象の画像。名前・アイコン等が隠れているか確認してください。"
      />
      <div className="crop-fields">
        {["左から", "上から", "幅", "高さ"].map((label, i) => (
          <label key={label}>
            {label}（%）
            <input
              type="number"
              min={0}
              max={100}
              value={rect[i]}
              onChange={(e) =>
                setRect(
                  rect.map((n, j) => (j === i ? Number(e.target.value) : n)),
                )
              }
            />
          </label>
        ))}
      </div>
      <div className="actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => edit(false)}
        >
          この範囲を黒く隠す
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => edit(true)}
        >
          この範囲だけ切り抜く
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export default function ScreenshotImport({
  onConfirm,
  disabled = false,
}: {
  onConfirm: (text: string) => boolean;
  disabled?: boolean;
}) {
  const [pictures, setPictures] = useState<Picture[]>([]),
    [rows, setRows] = useState<QuoteRow[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0),
    canvases = useRef<Picture[]>([]);
  function clearImages() {
    for (const p of canvases.current) {
      p.canvas.width = 0;
      p.canvas.height = 0;
    }
    canvases.current = [];
    setPictures([]);
  }
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
      for (const p of canvases.current) {
        p.canvas.width = 0;
        p.canvas.height = 0;
      }
      canvases.current = [];
    },
    [],
  );
  function replace(next: Picture[]) {
    canvases.current = next;
    setPictures(next);
    setRows([]);
    setConfirmed(false);
  }
  async function select(files: File[]) {
    const run = ++epoch.current;
    setBusy(true);
    setNotice("");
    const next: Picture[] = [];
    try {
      validateImages(files);
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        validateDimensions(imageDimensions(bytes));
        const bitmap = await createImageBitmap(file);
        if (run !== epoch.current) {
          bitmap.close();
          for (const p of next) {
            p.canvas.width = 0;
            p.canvas.height = 0;
          }
          return;
        }
        try {
          validateDimensions({ width: bitmap.width, height: bitmap.height });
          const c = document.createElement("canvas");
          c.width = bitmap.width;
          c.height = bitmap.height;
          c.getContext("2d")!.drawImage(bitmap, 0, 0);
          next.push({ id: crypto.randomUUID(), canvas: c });
        } finally {
          bitmap.close();
        }
      }
      clearImages();
      replace(next);
    } catch (e) {
      for (const p of next) {
        p.canvas.width = 0;
        p.canvas.height = 0;
      }
      if (run === epoch.current) setNotice((e as Error).message);
    } finally {
      if (run === epoch.current) setBusy(false);
    }
  }
  function demo() {
    epoch.current++;
    clearImages();
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 700;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f4f1e8";
    ctx.fillRect(0, 0, 640, 700);
    ctx.fillStyle = "#293c35";
    ctx.font = "24px sans-serif";
    [
      "合成画像：架空の名前・アイコン",
      "相手：今週、少し話せる？",
      "自分：予定を確認してみるね。",
      "相手：今週、少し話せる？（重複例）",
      "相手：[読めない部分]",
    ].forEach((line, i) => ctx.fillText(line, 20, 60 + i * 120));
    replace([{ id: "synthetic", canvas: c }]);

    setNotice(
      "合成画像を用意しました。編集後、端末内OCRで実際に読み取れます。",
    );
  }
  async function read() {
    const run = ++epoch.current;
    const control = new AbortController();
    controller.current = control;
    const timer = setTimeout(() => control.abort(), 120000);
    setBusy(true);
    setRows([]);
    setConfirmed(false);
    setNotice("端末内OCRを準備しています。画像は外部へ送りません。");
    try {
      const result = await recognizeLocally(
        pictures.map((p) => p.canvas),
        control.signal,
        (i, n) => {
          if (run === epoch.current)
            setNotice(
              `画像 ${i + 1} / ${pictures.length} を読み取り中（${Math.round(n * 100)}%）`,
            );
        },
      );
      if (run !== epoch.current) return;
      setRows(result.rows);
      setNotice(
        `端末内OCRが完了しました（${(result.milliseconds / 1000).toFixed(1)}秒）。発言者は未確認です。絵文字・小さい文字・脱落や誤読を原画像と照合してください。24発言を超える場合は不要な時刻などを削除してから追加してください。`,
      );
    } catch {
      if (run === epoch.current)
        setNotice(
          "読み取りを完了できませんでした。中断・時間切れ・素材読み込み失敗・行数超過の可能性があります。画像を小さな範囲へ切り抜いて確認してください。元の相談の下書きは保持しています。",
        );
    } finally {
      clearTimeout(timer);
      if (run === epoch.current) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  function change(id: string, patch: Partial<QuoteRow>) {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setConfirmed(false);
  }
  function move(index: number, direction: number) {
    const next = [...rows],
      target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setRows(next);
    setConfirmed(false);
  }
  return (
    <details id="screenshot-import" className="screenshot-import">
      <summary>スクショ取り込みのローカル試作（本体は無効）</summary>
      {busy && (
        <button
          type="button"
          className="button secondary"
          onClick={() => controller.current?.abort()}
        >
          読み取りを中断する
        </button>
      )}
      <p role="status" aria-live="polite">
        {notice}
      </p>
      <fieldset disabled={disabled || busy}>
        <p className="notice">
          画像編集と日本語・英語のOCRはこのブラウザー内で処理します。画像の外部送信・実AI生成は行いません。誤読や読み落としがあるため、必ず原画像と照合してください。
        </p>
        <p>
          PNG・JPEGを1〜3枚、1枚5MB／合計12MB以下、縦横100〜4096px・800万画素以下。名前・顔・アイコン・連絡先を先に隠してください。実利用者の画像は使わないでください。
        </p>
        <label>
          画像を選ぶ
          <input
            type="file"
            accept="image/png,image/jpeg"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void select(files);
            }}
          />
        </label>
        <button className="button secondary" type="button" onClick={demo}>
          合成画像を用意する
        </button>
        {pictures.map((p, i) => (
          <div key={p.id}>
            <h4>画像 {i + 1}</h4>
            <PictureEditor
              picture={p}
              onEdit={(updated) => {
                const next = pictures.map((v) =>
                  v.id === updated.id ? updated : v,
                );
                p.canvas.width = 0;
                p.canvas.height = 0;
                replace(next);
              }}
            />
          </div>
        ))}
        {pictures.length > 0 && (
          <>
            <p>
              処理先：このブラウザー内。外部へ送信する画像はありません。外部AIで読む機能は未接続です。
            </p>
            <button className="button secondary" type="button" onClick={read}>
              端末内で読み取る
            </button>
          </>
        )}
        {rows.length > 0 && (
          <section>
            <h4>会話を確認・修正する</h4>
            <p>
              発言者・順番・重複を直してください。読めない箇所は補完せず、不明の印を残します。
            </p>
            {rows.map((r, i) => (
              <div className="quote-row" key={r.id}>
                <p className="fine">
                  画像 {Number(r.id.split("-")[0]) + 1 || 1}{" "}
                  の読み取り行（発言の区切りも確認してください）
                </p>
                <label>
                  発言 {i + 1} の人
                  <select
                    value={r.speaker}
                    onChange={(e) =>
                      change(r.id, {
                        speaker: e.target.value as QuoteRow["speaker"],
                      })
                    }
                  >
                    <option value="unknown">未確認</option>
                    <option value="me">自分</option>
                    <option value="other">相手</option>
                  </select>
                </label>
                <label>
                  発言 {i + 1} の本文
                  <textarea
                    value={r.text}
                    maxLength={1000}
                    onChange={(e) => change(r.id, { text: e.target.value })}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={r.uncertain}
                    onChange={(e) =>
                      change(r.id, { uncertain: e.target.checked })
                    }
                  />{" "}
                  読めない部分を含む
                </label>
                {rows.some(
                  (other, j) =>
                    j !== i &&
                    other.text === r.text &&
                    other.speaker === r.speaker,
                ) && (
                  <p className="fine">
                    同じ発言があります。重複か確認してください。
                  </p>
                )}
                <div className="actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={`発言${i + 1}を上へ`}
                  >
                    上へ
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={`発言${i + 1}を下へ`}
                  >
                    下へ
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setRows(rows.filter((v) => v.id !== r.id));
                      setConfirmed(false);
                    }}
                    aria-label={`発言${i + 1}を削除`}
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
            <label className="check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              発言者・順番・重複・不明箇所を確認しました
            </label>
            <p>
              確認した会話だけを現在の相談の下書きへ追加します。元画像は追加しません。通常の相談で送信すると、その本文は既存のAI処理と履歴保存の対象になります。
            </p>
            <button
              className="button"
              type="button"
              disabled={!confirmed}
              onClick={() => {
                try {
                  const text = confirmedTranscript(rows);
                  if (onConfirm(text)) {
                    clearImages();
                    setRows([]);
                    setConfirmed(false);
                    setNotice(
                      "確認した会話を下書きへ追加しました。まだ送信・履歴保存はしていません。",
                    );
                  } else
                    setNotice(
                      "下書きの上限を超えるため追加できません。元の下書きは保持しています。",
                    );
                } catch (e) {
                  setNotice((e as Error).message);
                }
              }}
            >
              確認した会話を下書きへ追加
            </button>
          </section>
        )}

        <button
          type="button"
          className="text-button"
          onClick={() => {
            epoch.current++;
            clearImages();
            setRows([]);

            setConfirmed(false);
            setNotice(
              "試作内の画像・抽出結果を破棄しました。相談の下書きは保持しています。",
            );
          }}
        >
          画像・抽出結果を破棄する
        </button>
        <p className="fine">
          試作内では画像・抽出結果をブラウザーの保存領域やサーバーへ保存せず、相談相手の切替・画面を離れる際に参照を破棄します。端末のメモリ消去やスクリーンショット等の即時削除を保証するものではありません。
        </p>
      </fieldset>
    </details>
  );
}
