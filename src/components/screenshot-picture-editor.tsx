"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import {
  boxBetween,
  moveSelection,
  resizeSelection,
  pixelSelection,
  type Selection,
  type Corner,
} from "@/lib/screenshot/selection";
export type Picture = {
  id: string;
  canvas: HTMLCanvasElement;
  layoutCropped?: boolean;
};
type Edit = { kind: "mask" | "crop"; rect: Selection };
function copy(source: HTMLCanvasElement) {
  const c = document.createElement("canvas");
  c.width = source.width;
  c.height = source.height;
  c.getContext("2d")!.drawImage(source, 0, 0);
  return c;
}
function render(source: HTMLCanvasElement, edits: Edit[]) {
  let c = copy(source);
  for (const edit of edits) {
    const r = pixelSelection(edit.rect, c.width, c.height);
    if (edit.kind === "mask") {
      const x = c.getContext("2d")!;
      x.fillStyle = "#111";
      x.fillRect(r.x, r.y, r.width, r.height);
    } else {
      const next = document.createElement("canvas");
      next.width = r.width;
      next.height = r.height;
      next
        .getContext("2d")!
        .drawImage(c, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      c.width = 0;
      c.height = 0;
      c = next;
    }
  }
  return c;
}
export default function PictureEditor({
  picture,
  onEdit,
  disabled = false,
}: {
  picture: Picture;
  onEdit: (p: Picture) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const original = useRef<HTMLCanvasElement | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]),
    [selection, setSelection] = useState<Selection | null>(null),
    [mode, setMode] = useState(false),
    [zoom, setZoom] = useState(1),
    [available, setAvailable] = useState(240),
    [message, setMessage] = useState("");
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    kind: "draw" | "move" | Corner;
    rect: Selection | null;
  } | null>(null);
  const help = useId();
  useEffect(() => {
    const c = ref.current;
    if (c) {
      c.width = picture.canvas.width;
      c.height = picture.canvas.height;
      c.getContext("2d")!.drawImage(picture.canvas, 0, 0);
    }
  }, [picture]);
  useEffect(() => {
    const v = viewport.current;
    if (!v) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    );
    observer.observe(v);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => {
      if (original.current) {
        original.current.width = 0;
        original.current.height = 0;
        original.current = null;
      }
    },
    [],
  );
  const point = (e: PointerEvent) => {
    const b = stage.current!.getBoundingClientRect();
    return {
      x: (e.clientX - b.left) / b.width,
      y: (e.clientY - b.top) / b.height,
    };
  };
  function start(e: PointerEvent<HTMLDivElement>) {
    if (!mode || disabled || e.button !== 0 || drag.current) return;
    e.preventDefault();
    setMessage("");
    const p = point(e),
      target = e.target as HTMLElement;
    const kind =
      (target.dataset.corner as Corner | undefined) ||
      (target.closest(".image-selection") ? "move" : "draw");
    drag.current = { id: e.pointerId, ...p, kind, rect: selection };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    if (kind === "draw") setSelection(null);
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || disabled) return;
    const p = point(e);
    setSelection(
      d.kind === "draw"
        ? boxBetween(d, p)
        : d.kind === "move"
          ? moveSelection(d.rect!, p.x - d.x, p.y - d.y)
          : resizeSelection(d.rect!, d.kind, p.x - d.x, p.y - d.y),
    );
  }
  function finish(e: PointerEvent<HTMLDivElement>, cancel = false) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (cancel) setSelection(d.rect);
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function keyboard(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setSelection(null);
      setMode(false);
      drag.current = null;
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      setMode(true);
      setSelection(selection ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      setMode(false);
      setMessage(
        "範囲を確定しました。下の「隠す」または「切り抜く」を選んでください。",
      );
      return;
    }
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (selection && steps[e.key]) {
      e.preventDefault();
      const [x, y] = steps[e.key],
        n = e.altKey ? 0.002 : 0.02;
      setSelection(
        e.shiftKey
          ? resizeSelection(selection, "se", x * n, y * n)
          : moveSelection(selection, x * n, y * n),
      );
    }
  }
  function update(next: Edit[]) {
    try {
      if (!original.current) original.current = copy(picture.canvas);
      const c = render(original.current, next);
      setEdits(next);
      setSelection(null);
      setMode(false);
      onEdit({
        ...picture,
        canvas: c,
        layoutCropped: next.some(
          (e) =>
            e.kind === "crop" && (e.rect.x > 0.001 || e.rect.width < 0.999),
        ),
      });
      setMessage(
        next.length
          ? "編集済み画像を表示しています。読み取り結果は再確認が必要です。"
          : "元の画像に戻しました。読み取り結果は再確認が必要です。",
      );
    } catch {
      setMessage("編集できませんでした。選択範囲を確認してください。");
    }
  }
  const usable =
    selection && selection.width >= 0.005 && selection.height >= 0.005;
  const width =
    Math.max(
      1,
      Math.min(available, (320 * picture.canvas.width) / picture.canvas.height),
    ) * zoom;
  return (
    <section className="screenshot-picture" aria-label="画像の編集">
      <div className="editor-toolbar">
        <button
          className="button secondary"
          type="button"
          aria-pressed={mode}
          onClick={() => {
            setMode(!mode);
            drag.current = null;
          }}
        >
          {" "}
          {mode ? "範囲選択を終了" : "画像上で範囲を選ぶ"}{" "}
        </button>
        <label>
          表示倍率
          <select
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={1}>全体表示</option>
            <option value={1.5}>1.5倍</option>
            <option value={2}>2倍</option>
            <option value={3}>3倍</option>
          </select>
        </label>
      </div>
      <p id={help} className="fine">
        {mode
          ? "範囲選択中：画像上を囲み、枠の中で移動・四隅でサイズ変更できます。"
          : "閲覧モード：画像上でもスクロールできます。編集は任意です。"}{" "}
        画像の外はいつでもスクロールできます。
      </p>
      <div className="image-viewport" ref={viewport}>
        <div
          className="image-stage"
          ref={stage}
          role="group"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-label="画像の選択範囲"
          aria-describedby={help}
          aria-keyshortcuts="Space ArrowUp ArrowDown ArrowLeft ArrowRight Enter Escape"
          data-selecting={mode && !disabled}
          style={{
            width,
            aspectRatio: `${picture.canvas.width}/${picture.canvas.height}`,
          }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
          onKeyDown={keyboard}
        >
          <canvas
            ref={ref}
            role="img"
            aria-label="編集後の読み取り対象画像。隠す範囲と発言を照合してください。"
          />
          {selection && (
            <div
              className="image-selection"
              style={{
                left: `${selection.x * 100}%`,
                top: `${selection.y * 100}%`,
                width: `${selection.width * 100}%`,
                height: `${selection.height * 100}%`,
              }}
              aria-hidden="true"
            >
              {(["nw", "ne", "sw", "se"] as const).map((c) => (
                <span key={c} data-corner={c} />
              ))}
            </div>
          )}
        </div>
      </div>
      <p role="status" className="fine">
        {message ||
          (usable
            ? "範囲を選択しました。隠す・切り抜く操作を選べます。"
            : "範囲は未選択です。必要な場合だけ画像を編集してください。")}
      </p>
      <div className="editor-actions">
        <button
          className="button secondary"
          type="button"
          disabled={!usable}
          onClick={() => update([...edits, { kind: "mask", rect: selection! }])}
        >
          選択範囲を隠す
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={!usable}
          onClick={() => update([...edits, { kind: "crop", rect: selection! }])}
        >
          切り抜く
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={!selection}
          onClick={() => {
            setSelection(null);
            setMessage("選択を解除しました。");
          }}
        >
          選択解除
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={!edits.length}
          onClick={() => update(edits.slice(0, -1))}
        >
          ひとつ戻す
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={!edits.length}
          onClick={() => update([])}
        >
          編集をリセット
        </button>
      </div>
      <details className="keyboard-selection-help">
        <summary>キーボードで範囲を選ぶ方法</summary>
        <p>
          画像にフォーカスし、Spaceで枠を用意、矢印で移動、Shift＋矢印で大きさ、Altで微調整、Enterで確定、Escで解除します。確定後はTabで編集ボタンへ進めます。
        </p>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setSelection({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
            setMode(true);
            stage.current?.focus();
          }}
        >
          中央に選択枠を用意
        </button>
      </details>
      <p className="fine">
        編集 {edits.length}{" "}
        回。黒く隠した部分は読み取りません。切り抜きは任意です。元画像は編集を戻すため、「画像・抽出結果を破棄する」操作・下書き追加・画面を離れるまで端末内で一時保持します。
      </p>
    </section>
  );
}
