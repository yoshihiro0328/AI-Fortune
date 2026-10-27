import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.cwd(),
  destination = process.argv[2];
if (
  process.platform !== "darwin" ||
  !destination ||
  !path.isAbsolute(destination) ||
  fs.existsSync(destination)
)
  throw Error("FRESH_MAC_DIRECTORY_REQUIRED");
const revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
fs.mkdirSync(destination, { mode: 0o700 });
for (const name of [
  "src",
  "public",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "scripts/local-review",
  "scripts/phase6/payment-report-fixture.json",
  "tests/fixtures/dynamic-catalog.json",
]) {
  if (name === "public" && !fs.existsSync(path.join(root, name))) continue;
  const dest = path.join(destination, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(path.join(root, name), dest, {
    recursive: true,
    filter: (p) => !path.basename(p).startsWith(".env"),
  });
}
fs.symlinkSync(
  fs.realpathSync(path.join(root, "node_modules")),
  path.join(destination, "node_modules"),
  "dir",
);
const layout = path.join(destination, "src/app/layout.tsx");
let text = fs.readFileSync(layout, "utf8");
if (!text.includes("<body>")) throw Error("LAYOUT_ANCHOR_MISSING");
text =
  'import LocalReviewBanner from "@/components/local-review-banner";\n' +
  text.replace("<body>", "<body><LocalReviewBanner />");
fs.writeFileSync(layout, text);
fs.copyFileSync(
  path.join(root, "scripts/local-review/banner.tsx"),
  path.join(destination, "src/components/local-review-banner.tsx"),
);
// Only this private copy gets local settings; production source remains untouched.
fs.writeFileSync(
  path.join(destination, "src/lib/service-settings.ts"),
  'import "server-only";\nexport async function serviceSettings(){return {free_limit:3,plus_limit:30};}\n',
);
fs.writeFileSync(
  path.join(destination, "src/lib/trial/availability.ts"),
  'import "server-only";\nexport async function trialAvailability(){return {enabled:true,maxLength:800,retentionHours:24};}\n',
);
const hashes = {};
for (const name of [
  "account",
  "consultation",
  "diagnosis-flow",
  "result",
  "paid-report",
  "message-drafts",
  "plans",
]) {
  const rel = "src/components/" + name + ".tsx";
  hashes[rel] = createHash("sha256")
    .update(fs.readFileSync(path.join(root, rel)))
    .digest("hex");
  if (
    !fs
      .readFileSync(path.join(root, rel))
      .equals(fs.readFileSync(path.join(destination, rel)))
  )
    throw Error("COMPONENT_MISMATCH");
}
const profile =
  '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))';
const log = fs.openSync(path.join(destination, "server.log"), "wx", 0o600);
const env = {
  PATH: path.dirname(process.execPath) + ":/usr/bin:/bin",
  HOME: destination,
  TMPDIR: destination,
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:5318",
  LOCAL_REVIEW_ISOLATED: "true",
  TRIAL_ENABLED: "false",
  PREVIEW_DEMO_ENABLED: "false",
  STRIPE_LIVE_CHECKOUT_ENABLED: "false",
  AUTH_EMAIL_MODE: "disabled",
};
const child = spawn(
  "/usr/bin/sandbox-exec",
  ["-p", profile, process.execPath, "scripts/local-review/server.mjs"],
  { cwd: destination, env, detached: true, stdio: ["ignore", log, log] },
);
child.unref();
fs.closeSync(log);
fs.writeFileSync(
  path.join(destination, "review-manifest.json"),
  JSON.stringify(
    {
      revision,
      source: root,
      pid: child.pid,
      origin: "http://127.0.0.1:5318",
      realComponents: hashes,
      generatedOverrides: [
        "layout banner",
        "service-settings synthetic",
        "trial-availability synthetic",
      ],
      credentials: false,
      externalConnections: false,
      started: new Date().toISOString(),
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({ pid: child.pid, origin: "http://127.0.0.1:5318", revision }),
);
