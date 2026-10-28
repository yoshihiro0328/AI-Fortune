import type { QuoteRow } from "./model";
import {
  detectBubbles,
  restoreMessages,
  markOverlap,
  type PositionedLine,
} from "./line-layout";
export type OcrLine = PositionedLine;
export function reviewRows(lines: OcrLine[], image: number): QuoteRow[] {
  // Never infer authors, join bubbles, remove duplicates, or fill missing text.
  return lines
    .filter((l) => l.text.trim())
    .map((l, i) => ({
      id: `${image}-${i}`,
      speaker: "unknown",
      text: l.text.trim(),
      uncertain:
        !Number.isFinite(l.confidence) ||
        l.confidence < 85 ||
        /[�□]/u.test(l.text),
    }));
}
type Worker = {
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  recognize: (
    image: HTMLCanvasElement,
    options: object,
    output: object,
  ) => Promise<{
    data: {
      text: string;
      confidence: number;
      blocks: { paragraphs: { lines: OcrLine[] }[] }[] | null;
    };
  }>;
  terminate: () => Promise<unknown>;
};
type Engine = {
  createWorker: (lang: string, oem: number, options: object) => Promise<Worker>;
};
declare global {
  interface Window {
    Tesseract?: Engine;
  }
}
let loading: Promise<Engine> | undefined;
function engine(): Promise<Engine> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading)
    loading = new Promise<Engine>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/ocr/tesseract.min.js";
      script.onload = () =>
        window.Tesseract
          ? resolve(window.Tesseract)
          : reject(Error("OCR_LOAD"));
      script.onerror = () => {
        script.remove();
        reject(Error("OCR_LOAD"));
      };
      document.head.append(script);
    }).catch((e) => {
      loading = undefined;
      throw e;
    });
  return loading;
}
// All assets are pinned and self-hosted. One worker; one image at a time.
// No CDN fallback, OCR cache, image upload, or persistent image/text storage.
export async function recognizeLocally(
  images: HTMLCanvasElement[],
  signal: AbortSignal,
  progress: (image: number, value: number) => void,
  geometryLost: boolean[] = [],
) {
  let worker: Worker | undefined,
    finished = false;
  const started = performance.now();
  const abort = () => {
    if (worker) void worker.terminate();
  };
  signal.addEventListener("abort", abort, { once: true });
  const work = async () => {
    const api = await engine();
    signal.throwIfAborted();
    let current = 0;
    const created = await api.createWorker("jpn+eng", 1, {
      workerPath: new URL("/ocr/worker.min.js", location.origin).href,
      corePath: new URL("/ocr/", location.origin).href,
      langPath: new URL("/ocr/", location.origin).href,
      workerBlobURL: false,
      gzip: false,
      cacheMethod: "none",
      logger: (m: { status: string; progress: number }) => {
        if (!signal.aborted && !finished && m.status === "recognizing text")
          progress(current, m.progress);
      },
      errorHandler: () => {},
    });
    worker = created;
    if (signal.aborted || finished) {
      await created.terminate();
      throw Error("OCR_ABORT");
    }
    await created.setParameters({
      tessedit_pageseg_mode: "11",
      preserve_interword_spaces: "1",
      user_defined_dpi: "150",
    });
    const rows: QuoteRow[] = [];
    const warnings: string[] = [];
    let unsupported = false;
    const perImage: {
      milliseconds: number;
      lines: number;
      positionedLines: number;
      regions: number;
    }[] = [];
    for (let i = 0; i < images.length; i++) {
      signal.throwIfAborted();
      current = i;
      const t = performance.now();
      const sample = document.createElement("canvas");
      const scale = Math.min(1, 480 / images[i].width);
      sample.width = Math.round(images[i].width * scale);
      sample.height = Math.round(images[i].height * scale);
      const ctx = sample.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(images[i], 0, 0, sample.width, sample.height);
      const bubbles = detectBubbles(
        ctx.getImageData(0, 0, sample.width, sample.height).data,
        sample.width,
        sample.height,
      ).map((b) => ({
        ...b,
        box: {
          x0: b.box.x0 / scale,
          y0: b.box.y0 / scale,
          x1: b.box.x1 / scale,
          y1: b.box.y1 / scale,
        },
      }));
      sample.width = 0;
      sample.height = 0;
      // Read each detected bubble separately. Padding and contrast normalization
      // prevent the surrounding background and rounded border becoming OCR text.
      await created.setParameters({ tessedit_pageseg_mode: "6" });
      const { data: page } = await created.recognize(
        images[i],
        {},
        { text: true, blocks: true },
      );
      const pageLines =
        page.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) ?? [];
      const lines: OcrLine[] = pageLines.filter(
        (l) =>
          l.bbox &&
          !bubbles.some(
            (b) =>
              l.bbox!.x0 < b.box.x1 &&
              l.bbox!.x1 > b.box.x0 &&
              l.bbox!.y0 < b.box.y1 &&
              l.bbox!.y1 > b.box.y0,
          ),
      );
      for (const bubble of bubbles) {
        signal.throwIfAborted();
        if (bubble.nonText) continue;
        const box = bubble.box,
          inset = Math.max(3, Math.round(images[i].width / 160));
        const x = Math.ceil(box.x0 + inset),
          y = Math.ceil(box.y0 + inset);
        const w = Math.max(1, Math.floor(box.x1 - inset - x)),
          h = Math.max(1, Math.floor(box.y1 - inset - y));
        const c = document.createElement("canvas");
        const pad = 12;
        c.width = w + pad * 2;
        c.height = h + pad * 2;
        const cx = c.getContext("2d", { willReadFrequently: true })!;
        cx.fillStyle = "white";
        cx.fillRect(0, 0, c.width, c.height);
        cx.drawImage(images[i], x, y, w, h, pad, pad, w, h);
        const pixels = cx.getImageData(pad, pad, w, h),
          histogram = new Uint32Array(256);
        for (let k = 0; k < pixels.data.length; k += 4)
          histogram[
            Math.round(
              (pixels.data[k] + pixels.data[k + 1] + pixels.data[k + 2]) / 3,
            )
          ]++;
        let background = 0;
        for (let k = 1; k < 256; k++)
          if (histogram[k] > histogram[background]) background = k;
        let inkPixels = 0;
        for (let k = 0; k < pixels.data.length; k += 4) {
          const light =
            (pixels.data[k] + pixels.data[k + 1] + pixels.data[k + 2]) / 3;
          const ink =
            background > 135
              ? light < background - 40
              : light > background + 40;
          if (ink) inkPixels++;
          pixels.data[k] =
            pixels.data[k + 1] =
            pixels.data[k + 2] =
              ink ? 0 : 255;
        }
        cx.putImageData(pixels, pad, pad);
        if (inkPixels / (w * h) > 0.28) {
          // Dense non-text content (photo/sticker/mask): do not turn OCR noise into a message.
          c.width = 0;
          c.height = 0;
          continue;
        }
        try {
          const { data } = await created.recognize(
            c,
            {},
            { text: true, blocks: true },
          );
          for (const line of data.blocks?.flatMap((b) =>
            b.paragraphs.flatMap((p) => p.lines),
          ) ?? []) {
            if (line.bbox)
              lines.push({
                ...line,
                bbox: {
                  x0: line.bbox.x0 + x - pad,
                  y0: line.bbox.y0 + y - pad,
                  x1: line.bbox.x1 + x - pad,
                  y1: line.bbox.y1 + y - pad,
                },
              });
          }
        } finally {
          c.width = 0;
          c.height = 0;
        }
      }
      if (rows.length + lines.length > 128) throw Error("OCR_TOO_MANY_LINES");
      const restored = restoreMessages(
        lines,
        bubbles,
        i,
        images[i].width,
        images[i].height,
        geometryLost[i],
      );
      rows.push(...restored.rows);
      warnings.push(...restored.warnings.map((w) => `画像${i + 1}：${w}`));
      unsupported ||= restored.unsupported;
      perImage.push({
        milliseconds: Math.round(performance.now() - t),
        lines: lines.length,
        positionedLines: lines.filter((l) => Boolean(l.bbox)).length,
        regions: bubbles.length,
      });
    }
    return {
      rows: markOverlap(rows),
      warnings,
      unsupported,
      perImage,
      milliseconds: Math.round(performance.now() - started),
    };
  };
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(Error("OCR_ABORT"));
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([work(), cancelled]);
  } finally {
    finished = true;
    signal.removeEventListener("abort", abort);
    if (cancel) signal.removeEventListener("abort", cancel);
    if (worker) await worker.terminate();
  }
}
