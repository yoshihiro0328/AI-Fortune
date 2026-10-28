// Actual self-hosted OCR, synthetic pixels only. Never connects to an external service.
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import ts from "typescript";
const base = "http://127.0.0.1:5318",
  out =
    process.env.LOCAL_REVIEW_SCREENSHOTS || "/private/tmp/yorisoi-line-review";
await fs.mkdir(out, { recursive: true });
assert.deepEqual(
  await fetch(base + "/__review/health")
    .then((r) => r.json())
    .then((h) => [h.ready, h.synthetic, h.external]),
  [true, true, false],
);
const sources = await Promise.all(
  ["line-layout", "ocr", "synthetic-line"].map((n) =>
    fs.readFile(`src/lib/screenshot/${n}.ts`, "utf8"),
  ),
);
const code =
  sources
    .map((s) =>
      ts
        .transpileModule(
          s.replace(/import[\s\S]*?from\s+["'][^"']+["'];/g, ""),
          {
            compilerOptions: {
              target: ts.ScriptTarget.ES2022,
              module: ts.ModuleKind.ES2022,
            },
          },
        )
        .outputText.replace(/export /g, ""),
    )
    .join("\n") + "\nwindow.lineTest={recognizeLocally,drawSyntheticLine};";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage();
let external = 0;
await p.route("**/*", (r) => {
  if (new URL(r.request().url()).origin !== base) {
    external++;
    return r.abort();
  }
  return r.continue();
});
const results = [];
try {
  await p.goto(base + "/chat");
  await p.addScriptTag({ content: code });
  for (const [variant, width] of [
    ["light", 640],
    ["reply-date", 640],
    ["body-date-only", 640],
    ["dark", 640],
    ["background", 640],
    ["light", 320],
    ["light", 1080],
    ["small", 640],
    ["emoji", 640],
    ["quote", 640],
    ["media", 640],
    ["sticker", 640],
    ["unreadable", 640],
    ["deleted", 640],
    ["clipped", 640],
    ["repeat", 640],
    ["group", 640],
    ["plain", 640],
    ["masked", 640],
    ["cropped", 640],
    ["overlap", 640],
  ]) {
    const result = await p.evaluate(
      async ({ variant, width }) => {
        const c = document.createElement("canvas");
        const expected = lineTest.drawSyntheticLine(
          c,
          ["masked", "cropped", "overlap"].includes(variant)
            ? "light"
            : variant,
          width,
        );
        let images = [c],
          lost = [false];
        if (variant === "masked") {
          const x = c.getContext("2d");
          x.fillStyle = "#111";
          x.fillRect(0, 0, 640, 90);
          x.fillRect(95, 165, 85, 27);
        }
        if (variant === "cropped") {
          const d = document.createElement("canvas");
          d.width = 540;
          d.height = c.height;
          d.getContext("2d").drawImage(
            c,
            100,
            0,
            540,
            c.height,
            0,
            0,
            540,
            c.height,
          );
          images = [d];
          lost = [true];
        }
        if (variant === "overlap") {
          const d = document.createElement("canvas");
          d.width = c.width;
          d.height = 600;
          d.getContext("2d").drawImage(
            c,
            0,
            330,
            c.width,
            566,
            0,
            0,
            c.width,
            566,
          );
          images = [c, d];
          lost = [false, false];
        }
        const input = images.map((c) => c.toDataURL("image/png").split(",")[1]);
        const data = await lineTest.recognizeLocally(
          images,
          new AbortController().signal,
          () => {},
          lost,
        );
        return {
          variant,
          width,
          expected,
          data,
          input,
          heap: performance.memory?.usedJSHeapSize ?? null,
        };
      },
      { variant, width },
    );
    for (let i = 0; i < result.input.length; i++)
      await fs.writeFile(
        `${out}/synthetic-${variant}-${width}-${i}.png`,
        Buffer.from(result.input[i], "base64"),
      );
    delete result.input;
    results.push(result);
    await fs.writeFile(
      out + "/ocr-results.json",
      JSON.stringify(
        { results, external, physicalPhone: "not tested" },
        null,
        2,
      ),
    );
    console.log(
      variant,
      width,
      JSON.stringify(
        result.data.rows.map((r) => ({
          s: r.speaker,
          t: r.text,
          u: r.uncertain,
          q: r.quotePending,
          d: r.duplicateOf,
        })),
      ),
      result.data.unsupported,
      result.data.milliseconds,
    );
  }
  const reply = results.find((r) => r.variant === "reply-date");
  assert.ok(reply.data.rows.every((r) => !r.quotePending));
  const bodyDate = results.find((r) => r.variant === "body-date-only");
  assert.ok(bodyDate.data.rows.every((r) => !r.date));
  const standard = results.find(
    (r) => r.variant === "light" && r.width === 640,
  );
  assert.deepEqual(
    standard.data.rows.map((r) => r.speaker),
    ["other", "me", "me", "other"],
  );
  assert.equal(standard.data.rows.length, 4);
  assert.ok(standard.data.rows.every((r) => !r.uncertain));
  assert.ok(standard.data.perImage[0].positionedLines > 0);
  for (const variant of ["group", "plain"])
    assert.equal(
      results.find((r) => r.variant === variant).data.unsupported,
      true,
    );
  const quote = results.find((r) => r.variant === "quote");
  assert.equal(quote.data.rows.length, 4);
  assert.equal(quote.data.rows[2].quotePending, true);
  for (const variant of ["media", "sticker"])
    assert.equal(
      results.find((r) => r.variant === variant).data.rows.at(-1).text,
      "[文字として読めない内容]",
    );
  assert.ok(
    results
      .find((r) => r.variant === "cropped")
      .data.rows.every((r) => r.speaker === "unknown"),
  );
  assert.equal(
    results
      .find((r) => r.variant === "overlap")
      .data.rows.filter((r) => r.duplicateOf).length,
    2,
  );
  assert.equal(results.find((r) => r.variant === "repeat").data.rows.length, 5);
  assert.equal(external, 0);
} finally {
  await b.close();
}
