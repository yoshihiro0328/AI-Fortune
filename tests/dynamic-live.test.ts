import { it } from "vitest";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { analyzeDiagnosis } from "../src/lib/ai/pipeline";
it.skipIf(!process.env.DYNAMIC_DIAGNOSTIC)(
  "resume real dynamic pipeline",
  async () => {
    Object.assign(process.env, parseEnv(readFileSync(".env.local", "utf8")));
    const record = JSON.parse(
      readFileSync(
        "../../work/dynamic-e2e/" + process.env.DYNAMIC_DIAGNOSTIC + ".json",
        "utf8",
      ),
    );
    try {
      console.log(await analyzeDiagnosis(record.id));
    } catch (e) {
      console.error(
        e instanceof Error
          ? { name: e.name, message: e.message, cause: e.cause }
          : "failed",
      );
      throw e;
    }
  },
  300000,
);
