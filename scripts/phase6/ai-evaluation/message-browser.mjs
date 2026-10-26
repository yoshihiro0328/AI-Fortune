// Only isolated synthetic reports; no connected browser, accounts or API calls.
import { build } from "vite";
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const paths = process.argv.slice(2);
const cases = paths.length
  ? await Promise.all(
      paths.map(async (p) => {
        const d = JSON.parse(await readFile(p, "utf8"));
        return {
          caseNumber: d.evaluationId,
          messages: d.paid[0].report_json.messages,
        };
      }),
    )
  : JSON.parse(
      await readFile("tests/fixtures/saved-message-drafts.json", "utf8"),
    );
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import MessageDrafts from './src/components/message-drafts';const cases=${JSON.stringify(cases)};createRoot(document.getElementById('root')).render(<main>{cases.map((c,i)=><article data-case={i} key={i}><MessageDrafts messages={c.messages}/></article>)}</main>);`;
const virtualEntry = process.cwd() + "/message-entry.tsx";
const bundle = await build({
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      name: "synthetic-message-entry",
      resolveId(id) {
        if (id === virtualEntry) return id;
      },
      load(id) {
        if (id === virtualEntry) return entry;
      },
    },
  ],
  oxc: { jsx: { runtime: "automatic" } },
  build: {
    write: false,
    minify: false,
    lib: { entry: virtualEntry, formats: ["iife"], name: "MessageCheck" },
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
const javascript = (Array.isArray(bundle) ? bundle[0] : bundle).output.find(
  (o) => o.type === "chunk",
).code;
const server = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(javascript);
  } else if (req.url === "/") {
    res.setHeader("content-type", "text/html");
    res.end(
      '<!doctype html><html lang="ja"><meta charset="utf-8"><title>文面コピー隔離検証</title><div id="root"></div><script src="/app.js"></script></html>',
    );
  } else {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "darwin" ? { channel: "chrome" } : {}),
  });
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(origin + "/")
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(origin);
  let copied = 0;
  for (let i = 0; i < cases.length; i++) {
    const source = Object.values(cases[i].messages);
    const section = page.locator(`[data-case="${i}"] section`);
    await section.first().waitFor();
    for (let j = 0; j < 3; j++) {
      assert.equal(
        (source[j].match(/「/g) || []).length,
        1,
        "ambiguous message",
      );
      assert.equal(
        (source[j].match(/」/g) || []).length,
        1,
        "ambiguous message",
      );
      const expected = source[j].slice(
        source[j].indexOf("「") + 1,
        source[j].lastIndexOf("」"),
      );
      assert.equal(
        await section.nth(j).locator(".message").innerText(),
        expected,
      );
      const before = source[j].slice(0, source[j].indexOf("「")).trim(),
        after = source[j].slice(source[j].lastIndexOf("」") + 1).trim();
      const visible = await section.nth(j).innerText();
      if (before) assert(visible.includes(before));
      if (after) assert(visible.includes(after));
      await section
        .nth(j)
        .getByRole("button", { name: "文面だけをコピー", exact: true })
        .click();
      await section
        .nth(j)
        .getByRole("status")
        .filter({ hasText: "文面だけをコピーしました" })
        .waitFor();
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        expected,
      );
      copied++;
    }
  }
  console.log(
    JSON.stringify({
      passed: true,
      cases: cases.length,
      copied,
      externalRequestsAllowed: false,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
