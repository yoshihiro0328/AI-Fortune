import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fixturePlan, insertSQL } from "../scripts/phase6/step10-fixtures.mjs";
import {
  completeSQL,
  saveArtifact,
  verifiedBytes,
  sha256,
} from "../scripts/phase6/step10-sql-artifact.mjs";
const plan = () =>
  fixturePlan([randomUUID(), randomUUID()], ["a".repeat(64), "b".repeat(64)]);
const fingerprint = "c".repeat(32);
describe("STEP10 complete SQL regression", () => {
  it("reproduces replacement-string corruption and literal callback preservation", () => {
    const block = "DO $$ BEGIN PERFORM 1; END $$;";
    expect("X".replace("X", block)).toBe("DO $ BEGIN PERFORM 1; END $;");
    expect("X".replace("X", () => block)).toBe(block);
  });
  it("preserves DO and END dollar delimiters in the complete SQL", () => {
    const s = completeSQL(plan(), fingerprint);
    expect(s).toContain("do $$ begin\n");
    expect(s).toContain("\nend $$;");
    expect(s.match(/\$\$/g)).toHaveLength(2);
  });
  it("preserves every byte of the original INSERT body", () => {
    const p = plan(),
      s = completeSQL(p, fingerprint);
    expect(s.slice(s.indexOf("insert into"))).toBe(
      insertSQL(p).slice("begin;\n".length),
    );
  });
  it("preserves manifest UUIDs and both anonymous hashes without minting replacements", () => {
    const p = plan(),
      before = JSON.stringify(p),
      s = completeSQL(p, fingerprint);
    for (const id of Object.values(p.rows).flat()) expect(s).toContain(id);
    for (const h of p.hashes) expect(s).toContain(h);
    expect(JSON.stringify(p)).toBe(before);
    expect(completeSQL(p, fingerprint)).toBe(s);
  });
  it("contains exactly twelve INSERTs and no update/delete/truncate/upsert", () => {
    const s = completeSQL(plan(), fingerprint);
    expect(s.match(/insert into public\./g)).toHaveLength(12);
    expect(s).not.toMatch(/\b(update|delete|truncate|upsert)\b/i);
    expect(s.startsWith("begin;\n")).toBe(true);
    expect(s.endsWith("\ncommit;")).toBe(true);
  });
  it("locks and checks existing rows before the first INSERT", () => {
    const s = completeSQL(plan(), fingerprint),
      i = s.indexOf("insert into");
    expect(s.indexOf("share row exclusive mode;")).toBeLessThan(i);
    for (const guard of [
      "Nonempty business table",
      "Identity mismatch",
      "Safety state mismatch",
      "Payment target mismatch",
      "Profile changed",
      "RLS mismatch",
    ])
      expect(s.indexOf(guard)).toBeLessThan(i);
  });
  it("rejects an untrusted baseline instead of interpolating it", () =>
    expect(() => completeSQL(plan(), "';$$")).toThrow());
  it("rejects the wrong project before compilation", () =>
    expect(() =>
      completeSQL({ ...plan(), project: "wrong" }, fingerprint),
    ).toThrow());
});
describe("Frozen SQL artifact", () => {
  function withArtifact(
    fn: (d: string, m: ReturnType<typeof saveArtifact>) => void,
  ) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "step10-artifact-test-"),
      ),
      d = path.join(root, "attempt");
    try {
      const m = saveArtifact(d, {
        plan: plan(),
        profileFingerprint: fingerprint,
        profiles: [],
        previousAttemptSha256: "d".repeat(64),
      });
      fn(d, m);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  function certify(
    d: string,
    sha: string,
    extra: Record<string, unknown> = {},
  ) {
    fs.writeFileSync(
      path.join(d, "verification.json"),
      JSON.stringify({
        success: true,
        mode: "preserved-artifact",
        sqlSha256: sha,
        hostedWrites: 0,
        ...extra,
      }),
    );
  }
  it("records a fresh pending attempt linked to the previous failure", () =>
    withArtifact((d, m) => {
      expect(m.state).toBe("prepared-not-authorized");
      expect(m.previousAttemptSha256).toBe("d".repeat(64));
      expect(sha256(fs.readFileSync(path.join(d, "complete.sql")))).toBe(
        m.sqlSha256,
      );
    }));
  it("refuses regeneration or overwrite of a prepared attempt", () =>
    withArtifact((d) => {
      expect(() =>
        saveArtifact(d, {
          plan: plan(),
          profileFingerprint: fingerprint,
          profiles: [],
          previousAttemptSha256: "d".repeat(64),
        }),
      ).toThrow();
    }));
  it("does not expose unverified bytes", () =>
    withArtifact((d, m) =>
      expect(() => verifiedBytes(d, m.sqlSha256)).toThrow(),
    ));
  it("reads exactly the tested bytes without regeneration", () =>
    withArtifact((d, m) => {
      certify(d, m.sqlSha256);
      expect(
        verifiedBytes(d, m.sqlSha256).equals(
          fs.readFileSync(path.join(d, "complete.sql")),
        ),
      ).toBe(true);
    }));
  it("rejects a changed SQL file even if it is valid SQL", () =>
    withArtifact((d, m) => {
      certify(d, m.sqlSha256);
      const f = path.join(d, "complete.sql");
      fs.chmodSync(f, 0o600);
      fs.appendFileSync(f, "\n");
      expect(() => verifiedBytes(d, m.sqlSha256)).toThrow();
    }));
  it("rejects a changed manifest", () =>
    withArtifact((d, m) => {
      certify(d, m.sqlSha256);
      const f = path.join(d, "manifest.json");
      fs.chmodSync(f, 0o600);
      fs.writeFileSync(f, JSON.stringify(plan()));
      expect(() => verifiedBytes(d, m.sqlSha256)).toThrow();
    }));
  it("requires the externally reviewed SHA256", () =>
    withArtifact((d, m) => {
      certify(d, m.sqlSha256);
      expect(() => verifiedBytes(d, "0".repeat(64))).toThrow();
    }));
  it("does not mistake synthetic CI fixtures for the preserved private artifact", () =>
    withArtifact((d, m) => {
      certify(d, m.sqlSha256, { mode: "synthetic-ci" });
      expect(() => verifiedBytes(d, m.sqlSha256)).toThrow();
    }));
  it("rejects a failed certificate", () =>
    withArtifact((d, m) => {
      certify(d, m.sqlSha256, { success: false });
      expect(() => verifiedBytes(d, m.sqlSha256)).toThrow();
    }));
  it("rejects a mismatched certificate SHA", () =>
    withArtifact((d, m) => {
      certify(d, "0".repeat(64));
      expect(() => verifiedBytes(d, m.sqlSha256)).toThrow();
    }));
  it("requires an explicit previous attempt digest", () => {
    expect(() =>
      saveArtifact("/unused", {
        plan: plan(),
        profileFingerprint: fingerprint,
        profiles: [],
        previousAttemptSha256: "",
      }),
    ).toThrow();
  });
});
