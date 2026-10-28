import { it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { aiKeyReceiver } from "../scripts/phase6/ai-evaluation/receiver.mjs";
it("shows the purpose-specific approved bounds and receives once without returning a secret", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "purpose-handoff-test-"));
  const receiver = await aiKeyReceiver({ directory: dir, scope: "purpose" });
  try {
    const html = await fetch(receiver.url).then((r) => r.text());
    expect(html).toContain("今回最大54要求・20分・税別US$3");
    expect(html).toContain("相談目的AI評価");
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
    const send = () =>
      fetch(receiver.url, {
        method: "POST",
        headers: {
          origin: new URL(receiver.url).origin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          csrf,
          key: "sk-synthetic-only-not-a-real-key-1234567890",
        }),
      });
    const r = await send();
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("安全に受け取りました");
    expect(body).not.toContain("sk-");
    expect((await send()).status).toBe(409);
    expect(
      (await fs.stat(path.join(dir, "openai-key.json"))).mode & 0o077,
    ).toBe(0);
  } finally {
    await receiver.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it("shows the approved continuation time without advertising a new 20-minute window", async () => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "purpose-extension-form-test-"),
  );
  const r = await aiKeyReceiver({ directory: dir, scope: "purpose-extension" });
  try {
    const h = await fetch(r.url).then((v) => v.text());
    expect(h).toContain("受領後追加10分");
    expect(h).toContain("今回累積54要求");
    expect(h).not.toContain("20分");
  } finally {
    await r.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
