import type { QuoteRow } from "./model";
export type OcrLine = { text: string; confidence: number };
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
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1",
      user_defined_dpi: "150",
    });
    const rows: QuoteRow[] = [];
    const perImage: { milliseconds: number; lines: number }[] = [];
    for (let i = 0; i < images.length; i++) {
      signal.throwIfAborted();
      current = i;
      const t = performance.now();
      const { data } = await created.recognize(
        images[i],
        {},
        { text: true, blocks: true },
      );
      signal.throwIfAborted();
      const lines =
        data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) ??
        data.text.split("\n").map((text) => ({ text, confidence: 0 }));
      if (rows.length + lines.length > 128) throw Error("OCR_TOO_MANY_LINES");
      const recognized = reviewRows(lines, i);
      rows.push(
        ...(recognized.length
          ? recognized
          : [
              {
                id: `${i}-unreadable`,
                speaker: "unknown" as const,
                text: "[この画像は読み取れませんでした]",
                uncertain: true,
              },
            ]),
      );
      perImage.push({
        milliseconds: Math.round(performance.now() - t),
        lines: lines.length,
      });
    }
    if (!rows.length)
      rows.push({
        id: "unreadable",
        speaker: "unknown",
        text: "[読み取れませんでした]",
        uncertain: true,
      });
    return {
      rows,
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
