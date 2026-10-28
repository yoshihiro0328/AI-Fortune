"use client";
import { useEffect, useRef } from "react";
// A local-only comparison copy with the selected message region highlighted.
export default function ScreenshotSourcePreview({
  source,
  box,
  crop = false,
}: {
  source: HTMLCanvasElement;
  box?: { x0: number; y0: number; x1: number; y1: number };
  crop?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const r =
      crop && box ? box : { x0: 0, y0: 0, x1: source.width, y1: source.height };
    const w = r.x1 - r.x0,
      h = r.y1 - r.y0,
      scale = Math.min(1, 960 / w);
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext("2d")!;
    ctx.drawImage(source, r.x0, r.y0, w, h, 0, 0, c.width, c.height);
    if (box && !crop) {
      ctx.strokeStyle = "#c94719";
      ctx.lineWidth = 4;
      ctx.strokeRect(
        box.x0 * scale,
        box.y0 * scale,
        (box.x1 - box.x0) * scale,
        (box.y1 - box.y0) * scale,
      );
    }
    return () => {
      c.width = 0;
      c.height = 0;
    };
  }, [source, box, crop]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="この発言の読み取りに使った編集後の画像"
    />
  );
}
