import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function diagnostic(input: object) {
  const process = spawnSync("python3", ["-c", `
import sys,json
sys.path.insert(0,'scripts/phase6')
from docker_startup_diagnostics import failure,engine_metadata
x=json.load(sys.stdin)
print(json.dumps(engine_metadata(x['metadata'].encode()) if 'metadata' in x else failure(x.get('stage','container_start'),125,x['stderr'].encode())))
`], { input: JSON.stringify(input), encoding: "utf8" });
  expect(process.status).toBe(0);
  return JSON.parse(process.stdout);
}

describe("Docker startup diagnostics without private output", () => {
  for (const [stderr, category] of [
    ["toomanyrequests: rate exceeded", "registry_rate_limit"],
    ["no matching manifest for linux/amd64", "platform_unavailable"],
    ["manifest unknown", "manifest_missing"],
    ["permission denied on docker socket", "daemon_permission"],
    ["Cannot connect to the Docker daemon", "daemon_unavailable"],
    ["pull access denied", "registry_authorization"],
    ["no space left on device", "storage_full"],
    ["TLS handshake timeout", "network_or_tls"],
    ["container name is already in use", "container_name_conflict"],
    ["unknown flag", "invalid_run_option"],
    ["unexpected provider response", "unclassified"],
  ]) {
    it(`classifies ${category} without raw output`, () => {
      expect(diagnostic({ stderr })).toEqual({
        stage: "container_start", exitCode: 125, category,
        image: "public.ecr.aws/supabase/postgres:17.11.0.004", rawOutputSuppressed: true,
      });
    });
  }
  it("suppresses SQL, identities, hashes, tokens, passwords and endpoints", () => {
    const privateText = "SELECT private_fixture; uuid=synthetic-private-uuid hash=synthetic-hash token=synthetic-token password=synthetic-password postgresql://private-host";
    expect(JSON.stringify(diagnostic({ stderr: privateText }))).not.toContain("synthetic");
    expect(JSON.stringify(diagnostic({ stderr: privateText }))).not.toContain("private");
  });
  it("only emits allowlisted engine metadata", () => {
    expect(diagnostic({ metadata: JSON.stringify({ Version: "28.5.1", Os: "linux", Arch: "amd64", Name: "private-daemon" }) })).toMatchObject({ dockerVersion: "28.5.1", os: "linux", arch: "amd64" });
    expect(JSON.stringify(diagnostic({ metadata: JSON.stringify({ Version: "private", Os: "private", Arch: "private" }) }))).not.toContain("private");
  });
  it("handles malformed metadata without echoing it", () => {
    expect(diagnostic({ metadata: "private invalid JSON" })).toMatchObject({ dockerVersion: "unavailable", os: "unavailable", arch: "unavailable" });
  });
  it("does not regenerate the supplied frozen cleanup artifact", () => {
    const source = readFileSync("scripts/phase6/step10-complete-sql-verify.py", "utf8");
    const branch = source.split("if args.cleanup_file:\n")[1].split("    else:")[0];
    expect(branch).toContain("cleanup_file=args.cleanup_file.resolve()");
    expect(branch).not.toContain("command(");
    expect(source).toContain("cleanup_sha==args.cleanup_sha256");
  });
  it("keeps SQL errors outside the diagnostic path", () => {
    const source = readFileSync("scripts/phase6/step10-complete-sql-verify.py", "utf8");
    expect(source).toContain("{'run':'container_start','version':'engine'}.get(argv[1])");
    expect(source).not.toContain("print(r.stderr");
  });
});
