"use client";
import { useEffect, useRef } from "react";
// A local-only comparison copy, created only when the reader expands it.
export default function ScreenshotSourcePreview({
  source,
}: {
  source: HTMLCanvasElement;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const scale = Math.min(1, 960 / source.width);
    c.width = Math.round(source.width * scale);
    c.height = Math.round(source.height * scale);
    c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
    return () => {
      c.width = 0;
      c.height = 0;
    };
  }, [source]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="この発言の読み取りに使った編集後の画像"
    />
  );
}
