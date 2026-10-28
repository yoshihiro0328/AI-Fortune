"use client";
import { useEffect, useRef, useState } from "react";
import {
  imageDimensions,
  validateDimensions,
  validateImages,
  materialErrors,
  type QuoteRow,
} from "@/lib/screenshot/model";
import { recognizeLocally } from "@/lib/screenshot/ocr";
import ScreenshotConversation from "./screenshot-conversation";
import ScreenshotSourcePreview from "./screenshot-source-preview";
import { drawSyntheticLine } from "@/lib/screenshot/synthetic-line";
import PictureEditor, { type Picture } from "./screenshot-picture-editor";

export default function ScreenshotImport({
  rows,
  onChange,
  onBlocked,
  disabled = false,
}: {
  rows: QuoteRow[];
  onChange: (rows: QuoteRow[]) => void;
  onBlocked: (blocked: boolean) => void;
  disabled?: boolean;
}) {
  const [pictures, setPictures] = useState<Picture[]>([]),
    [candidate, setCandidate] = useState<QuoteRow[] | null>(null),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [notice, setNotice] = useState("");
  const epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    canvases = useRef<Picture[]>([]);
  const running = useRef(false);
  const picker = useRef<HTMLDetailsElement>(null);
  function dispose(id: string) {
    const image = canvases.current.find((p) => p.id === id);
    if (image) {
      image.canvas.width = 0;
      image.canvas.height = 0;
    }
  }
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
  function replacePictures(next: Picture[]) {
    canvases.current = next;
    setPictures(next);
  }
  async function read(next = pictures) {
    if (running.current || disabled || !next.length) return;
    running.current = true;
    const run = ++epoch.current,
      control = new AbortController();
    controller.current = control;
    const timer = setTimeout(() => control.abort(), 120000);
    setBusy(true);
    onBlocked(true);
    setStale(rows.length > 0);
    setCandidate(null);
    setNotice("端末内で会話を読み取っています。画像は外部へ送りません。");
    try {
      const result = await recognizeLocally(
        next.map((p) => p.canvas),
        control.signal,
        (i, n) => {
          if (run === epoch.current)
            setNotice(
              `画像 ${i + 1} / ${next.length} を読み取り中（${Math.round(n * 100)}%）`,
            );
        },
        next.map((p) => Boolean(p.layoutCropped)),
      );
      if (run !== epoch.current) return;
      if (result.unsupported || !result.rows.length)
        throw Error(
          result.warnings.join(" ") || "会話を読み取れませんでした。",
        );
      if (picker.current) picker.current.open = false;
      if (rows.length) {
        setCandidate(result.rows);
        setStale(true);
        setNotice(
          "新しい読み取り結果を用意しました。訂正済みの会話は保持しています。置き換えるか選んでください。",
        );
      } else {
        onChange(result.rows);
        setStale(false);
        onBlocked(false);
        setNotice("");
      }
    } catch (e) {
      if (run === epoch.current) {
        setNotice(
          `読み取りを完了できませんでした。${control.signal.aborted ? "中断・時間切れです。" : e instanceof Error ? e.message : "画像を確認してください。"} 以前の会話と相談文は保持しています。`,
        );
        // Failed replacement must not associate retained corrections with a different image.
        clearImages();
        setStale(false);
        onBlocked(false);
      }
    } finally {
      clearTimeout(timer);
      if (run === epoch.current) {
        running.current = false;
        setBusy(false);
        controller.current = null;
      }
    }
  }
  async function select(files: File[]) {
    if (running.current || disabled) return;
    const run = ++epoch.current;
    running.current = true;
    setBusy(true);
    onBlocked(true);
    const next: Picture[] = [];
    try {
      validateImages(files);
      for (const file of files) {
        validateDimensions(
          imageDimensions(new Uint8Array(await file.arrayBuffer())),
        );
        const bitmap = await createImageBitmap(file);
        try {
          if (run !== epoch.current) return;
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
      replacePictures(next);
      running.current = false;
      void read(next);
    } catch (e) {
      if (run === epoch.current) {
        setNotice((e as Error).message);
        setBusy(false);
        onBlocked(stale);
        running.current = false;
      }
    } finally {
      if (canvases.current !== next)
        for (const p of next) {
          p.canvas.width = 0;
          p.canvas.height = 0;
        }
    }
  }
  function demo() {
    if (running.current || disabled) return;
    clearImages();
    const c = document.createElement("canvas");
    drawSyntheticLine(c);
    const next = [{ id: crypto.randomUUID(), canvas: c }];
    replacePictures(next);
    void read(next);
  }
  function edited(next: Picture[]) {
    replacePictures(next);
    setStale(true);
    setCandidate(null);
    onBlocked(true);
    setNotice(
      "画像が変わりました。以前の会話・訂正は保持していますが、画像とは一致しません。再読み取り後に置き換えるか、画像の変更を取り消してください。",
    );
  }
  function retain() {
    clearImages();
    setCandidate(null);
    setStale(false);
    onBlocked(false);
    setNotice(
      "以前の取り込んだ会話・訂正を保持しました。変更した画像は破棄しました。",
    );
  }
  function cancel() {
    epoch.current++;
    controller.current?.abort();
    running.current = false;
    setBusy(false);
    clearImages();
    setCandidate(null);
    setStale(false);
    onChange([]);
    onBlocked(false);
    setNotice("取り込みを取り消しました。もともとの相談文は保持しています。");
  }
  const errors = materialErrors(rows);
  const imageEditor = !!pictures.length && (
    <details className="import-image-editor">
      <summary>元画像を拡大・隠す・切り抜く・並べ替える</summary>
      <p className="fine">
        編集後の画像を再読み取りします。既存の訂正を置き換える前に選択できます。
      </p>
      {pictures.map((p, i) => (
        <div key={p.id}>
          <h4>画像{i + 1}</h4>
          <PictureEditor
            picture={p}
            disabled={disabled || busy}
            onEdit={(updated) => {
              const next = pictures.map((v) => (v.id === p.id ? updated : v));
              p.canvas.width = 0;
              p.canvas.height = 0;
              edited(next);
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
                edited(next);
              }}
            >
              画像{i + 1}を前へ
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                dispose(p.id);
                edited(pictures.filter((v) => v.id !== p.id));
              }}
            >
              画像{i + 1}を削除
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        onClick={() => void read()}
      >
        編集した画像を再読み取り
      </button>
    </details>
  );
  return (
    <section
      id="screenshot-import"
      className="screenshot-import compact-import"
      aria-label="スクショから入力"
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          e.target instanceof HTMLInputElement &&
          !["checkbox", "file"].includes(e.target.type)
        )
          e.preventDefault();
      }}
    >
      <details className="import-picker" ref={picker}>
        <summary>▧ スクショから入力</summary>
        <p className="fine">
          ローカル確認用・公開OFF。自分の端末で撮ったLINEの1対1トーク用です。グループは対象外。画像は端末内だけで読み取り、通常の相談送信時に選んだ文字だけを含めます。
        </p>
        <fieldset disabled={disabled || busy}>
          <label>
            画像を選ぶ
            <input
              type="file"
              accept="image/png,image/jpeg"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) void select(files);
              }}
            />
          </label>
          <button type="button" className="button secondary" onClick={demo}>
            合成画像を用意する
          </button>
        </fieldset>
        <p className="fine">
          PNG・JPEG、1〜3枚。1枚5MB・合計12MB、縦横100〜4096px・800万画素まで。実利用者の画像は使わないでください。再選択・再読み取りは既存の訂正を自動で上書きしません。
        </p>
      </details>
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
        {(pictures.length > 0 || rows.length > 0) && (
          <div className="import-overview">
            {!!pictures.length && (
              <div
                className="import-thumbnails"
                aria-label="読み取り画像の縮小表示"
              >
                {pictures.map((p, i) => (
                  <div key={p.id}>
                    <ScreenshotSourcePreview source={p.canvas} />
                    <span>画像{i + 1}</span>
                  </div>
                ))}
              </div>
            )}
            {!!rows.length && (
              <p className="import-count" role="status">
                <strong>会話{rows.length}件を取り込みました</strong> · 送信対象
                {rows.filter((r) => !r.excluded).length}件 · 未送信
                {errors.length
                  ? ` · 要確認${new Set(errors.map((e) => e.split("：")[0])).size}件`
                  : ""}
              </p>
            )}
          </div>
        )}
        {!!rows.length && (
          <>
            {!pictures.length && (
              <p className="fine">
                取り込んだ文字は保持しています。元画像はこの画面を離れたとき等に破棄しています。
              </p>
            )}
            {errors.length > 0 && (
              <ul
                className="import-errors"
                aria-label="取り込んだ会話の確認箇所"
              >
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <details className="import-conversation">
              <summary>内容を見る・直す</summary>
              <p className="fine">
                文字の誤読や、写真・背景と同化した吹き出しの見落としがあり得ます。必要に応じて元画像と照合し、送る発言を選んでください。日時は読めた範囲だけで、日時不明のまま進められます。相手から受け取った画像なら編集内で発言者を一括交換してください。
              </p>
              <ScreenshotConversation
                rows={rows}
                pictures={stale ? [] : pictures}
                onChange={onChange}
              />
              {imageEditor}
              <button
                type="button"
                className="button secondary"
                onClick={cancel}
              >
                取り込みを取り消す
              </button>
            </details>
          </>
        )}
        {!rows.length && imageEditor}
        {candidate && (
          <div className="notice">
            <p>
              新しい結果：{candidate.length}
              件。置き換えると以前の訂正は消えます。
            </p>
            <details>
              <summary>置き換える内容を確認</summary>
              <ScreenshotConversation
                rows={candidate}
                pictures={pictures}
                onChange={setCandidate}
              />
            </details>
            <button
              type="button"
              className="button"
              onClick={() => {
                onChange(candidate);
                setCandidate(null);
                setStale(false);
                onBlocked(false);
                setNotice("新しい読み取り結果に置き換えました。未送信です。");
              }}
            >
              新しい結果に置き換える
            </button>
          </div>
        )}
        {stale && (
          <button type="button" className="button secondary" onClick={retain}>
            画像の変更を取り消し、以前の会話を保持
          </button>
        )}
        {!rows.length && pictures.length > 0 && (
          <button type="button" className="button secondary" onClick={cancel}>
            取り込みを取り消す
          </button>
        )}
      </fieldset>
    </section>
  );
}
