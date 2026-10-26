import { it, expect } from "vitest";
import { mkdtemp, readFile, rm, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiKeyReceiver } from "../scripts/phase6/ai-evaluation/receiver.mjs";
it("one same-origin credential receipt is private, single use, and never echoed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ai-receiver-"));
  await chmod(dir, 0o700);
  let submissions = 0;
  const r = await aiKeyReceiver({
    directory: dir,
    onSubmission: () => {
      submissions++;
    },
  });
  try {
    const page = await (await fetch(r.url)).text();
    const csrf = page.match(/name="csrf" value="([^"]+)"/)![1];
    const key = "sk-" + "synthetic".repeat(6);
    const body = new URLSearchParams({ csrf, key });
    const headers = {
      origin: new URL(r.url).origin,
      "content-type": "application/x-www-form-urlencoded",
    };
    expect(
      (
        await fetch(r.url, {
          method: "POST",
          headers: { ...headers, origin: "https://untrusted.invalid" },
          body,
        })
      ).status,
    ).toBe(403);
    const response = await fetch(r.url, { method: "POST", headers, body });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(key);
    const file = join(dir, "openai-key.json"),
      saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.key).toBe(key);
    expect(saved.receivedAt).toBeLessThanOrEqual(Date.now());
    expect((await stat(file)).mode & 0o077).toBe(0);
    expect((await fetch(r.url, { method: "POST", headers, body })).status).toBe(
      409,
    );
    expect(await (await fetch(r.url)).text()).not.toContain(key);
    expect(submissions).toBe(1);
  } finally {
    await r.close();
    await rm(dir, { recursive: true, force: true });
  }
});
