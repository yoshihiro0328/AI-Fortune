import { it, expect, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageCache } from "../scripts/phase6/ai-evaluation/stage-cache.mjs";
it("reuses saved verified stages across cache instances and never resends unknown stages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ai-stage-"));
  try {
    const p = { text: { format: { name: "free_report" } }, input: "synthetic" },
      id = "diagnosis-6-revision-20261026";
    const call = vi.fn(async () => ({
      output_parsed: { summary: "saved" },
      usage: { input_tokens: 100, output_tokens: 30 },
      id: "must-not-be-saved",
    }));
    const r = await stageCache(dir)(id, p, call);
    expect(await stageCache(dir)(id, p, call)).toEqual(r);
    expect(call).toHaveBeenCalledTimes(1);
    const failed = vi.fn(async () => {
      throw Error("sk-this-raw-error-must-not-be-saved-12345");
    });
    const unknown = { ...p, text: { format: { name: "paid_report" } } };
    await expect(stageCache(dir)(id, unknown, failed)).rejects.toThrow();
    await expect(stageCache(dir)(id, unknown, failed)).rejects.toThrow(
      "UNKNOWN_STAGE_REPLAY_DENIED",
    );
    expect(failed).toHaveBeenCalledTimes(1);
    const all = await Promise.all(
      (await readdir(dir)).map((f) => readFile(join(dir, f), "utf8")),
    );
    expect(all.join()).not.toContain("must-not-be-saved");
    expect(all.join()).not.toContain("sk-");
    await expect(stageCache(dir)("diagnosis-6-old", p, call)).rejects.toThrow(
      "CACHE_SCOPE_DENIED",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
