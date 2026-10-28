"use client";
import { useEffect, useRef, useState } from "react";
import {
  confirmedTranscript,
  imageDimensions,
  validateDimensions,
  validateImages,
  type QuoteRow,
} from "@/lib/screenshot/model";
import { recognizeLocally } from "@/lib/screenshot/ocr";
import ScreenshotConversation from "./screenshot-conversation";
import { markOverlap } from "@/lib/screenshot/line-layout";
import { drawSyntheticLine } from "@/lib/screenshot/synthetic-line";
import PictureEditor, { type Picture } from "./screenshot-picture-editor";
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
    [notice, setNotice] = useState(""),
    [scopeConfirmed, setScopeConfirmed] = useState(false),
    [unsupported, setUnsupported] = useState(false);
  const appended = useRef(false);
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
    appended.current = false;
    setUnsupported(false);
    canvases.current = next;
    setPictures(next);
    setRows([]);
    setConfirmed(false);
  }
  async function select(files: File[]) {
    const run = ++epoch.current;
    setBusy(true);
    setNotice("画像を端末内で読み込んでいます。");
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
      setScopeConfirmed(false);
      replace(next);
      setNotice(
        "画像を読み込みました。並び順とLINEの1対1トークであることを確認してください。",
      );
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
    drawSyntheticLine(c);
    setScopeConfirmed(true);
    replace([{ id: crypto.randomUUID(), canvas: c }]);

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
        pictures.map((p) => Boolean(p.layoutCropped)),
      );
      if (run !== epoch.current) return;
      appended.current = false;
      setRows(result.rows);
      setUnsupported(result.unsupported);
      setNotice(
        `端末内OCRが完了しました（${(result.milliseconds / 1000).toFixed(1)}秒）。${result.rows.length}発言を復元しました。${result.warnings.join(" ")} 発言者・区切り・順序を画像と照合してください。`,
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
  function removePicture(id: string) {
    const current = canvases.current.find((p) => p.id === id);
    if (current) {
      current.canvas.width = 0;
      current.canvas.height = 0;
    }
    replace(canvases.current.filter((p) => p.id !== id));
    setNotice(
      "画像と以前の読み取り結果を削除しました。相談の下書きは保持しています。",
    );
  }
  return (
    <details
      id="screenshot-import"
      className="screenshot-import"
      onKeyDown={(event) => {
        // Editing OCR/crop fields must never implicitly submit the surrounding chat form.
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement &&
          !["checkbox", "file"].includes(event.target.type)
        )
          event.preventDefault();
      }}
    >
      <summary>
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8" cy="8" r="1.5" />
          <path d="m3 17 5-5 4 4 4-6 5 7" />
        </svg>
        スクショから入力
      </summary>
      <p className="fine">
        ローカル確認用（公開OFF）。画像は端末内で処理し、外部送信しません。確認した文字だけを下書きへ追加します。自動送信はしません。
      </p>
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
        <p className="fine">
          LINEの1対1トーク画像を選ぶ → 必要な部分を隠す → 会話を復元 →
          確認・訂正 → 下書きへ追加
        </p>
        <details className="image-requirements">
          <summary>画像の条件・取り扱い（PNG・JPEG、1〜3枚）</summary>
          <p>
            1枚5MB／合計12MB以下、縦横100〜4096px・800万画素以下。一度に追加できるのは24発言までです。名前・顔・アイコン・連絡先を先に隠してください。実利用者の画像は使わないでください。
          </p>
          <p>
            画像編集と日本語・英語のOCRはこのブラウザー内で処理します。実AI生成は行いません。誤読・読み落としがあるため、読み取り後に画像と照合してください。切り抜きは任意です。
          </p>
        </details>
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
              disabled={disabled || busy}
              onEdit={(updated) => {
                const next = pictures.map((v) =>
                  v.id === updated.id ? updated : v,
                );
                p.canvas.width = 0;
                p.canvas.height = 0;
                replace(next);
                setNotice(
                  "画像を編集したため、以前の読み取り結果を破棄しました。端末内で再度読み取ってください。",
                );
              }}
            />
            <div className="editor-actions">
              <button
                type="button"
                className="button secondary"
                disabled={i === 0}
                onClick={() => {
                  const next = [...pictures];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  replace(next);
                  setNotice(
                    "画像の順序を変更しました。もう一度読み取ってください。",
                  );
                }}
              >
                画像 {i + 1} を前へ
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => removePicture(p.id)}
              >
                画像 {i + 1} を削除
              </button>
            </div>
          </div>
        ))}
        {pictures.length > 0 && (
          <>
            <p>
              処理先：このブラウザー内。外部へ送信する画像はありません。外部AIで読む機能は未接続です。
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={scopeConfirmed}
                onChange={(e) => setScopeConfirmed(e.target.checked)}
              />
              LINEの1対1トークであることを確認しました（グループ・他アプリは対象外）
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={!scopeConfirmed}
              onClick={read}
            >
              端末内で読み取る
            </button>
          </>
        )}
        {rows.length > 0 && (
          <section>
            <ScreenshotConversation
              rows={rows}
              pictures={pictures}
              onChange={(next) => {
                setRows(markOverlap(next));
                setConfirmed(false);
              }}
            />
            <details className="append-preview">
              <summary>下書きに追加する内容を確認</summary>
              <pre>
                {rows
                  .map(
                    (r) =>
                      `${r.speaker === "me" ? "自分" : r.speaker === "other" ? "相手" : "発言者未確認"}：${r.uncertain ? "[読めない部分あり・補完していません] " : ""}${r.quote ? `[引用・発言者未確定] ${r.quote}\n[新しく書かれた本文] ` : ""}${r.text}`,
                  )
                  .join("\n")}
              </pre>
            </details>
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
              disabled={!confirmed || unsupported || !scopeConfirmed}
              onClick={() => {
                try {
                  if (appended.current) return;
                  const text = confirmedTranscript(rows);
                  appended.current = true;
                  if (onConfirm(text)) {
                    clearImages();
                    setRows([]);
                    setConfirmed(false);
                    setNotice(
                      "確認した会話を下書きへ追加しました。まだ送信・履歴保存はしていません。",
                    );
                  } else {
                    appended.current = false;
                    setNotice(
                      "下書きの上限を超えるため追加できません。元の下書きは保持しています。",
                    );
                  }
                } catch (e) {
                  appended.current = false;
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
          onClick={(event) => {
            const details = event.currentTarget.closest("details");
            if (details) {
              details.open = false;
              details.querySelector("summary")?.focus();
            }
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
