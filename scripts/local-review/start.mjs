import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runIsolated, start } from "./runtime.mjs";
const root = process.cwd(),
  destination = process.argv[2];
if (
  process.platform !== "darwin" ||
  !destination ||
  !path.isAbsolute(destination) ||
  fs.existsSync(destination)
)
  throw Error("FRESH_MAC_DIRECTORY_REQUIRED");
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
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
// Review-only page overrides. The public application keeps OCR disabled in production.
for (const rel of ["src/app/chat/page.tsx", "src/app/consult/page.tsx"]) {
  const file = path.join(destination, rel);
  const page = fs
    .readFileSync(file, "utf8")
    .replace('process.env.NODE_ENV === "development" &&', "true &&")
    .replace('process.env.CONSULTATION_EVENTS_ENABLED === "true"', "true");
  fs.writeFileSync(file, page);
}
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
fs.writeFileSync(
  path.join(destination, "review-manifest.json"),
  JSON.stringify(
    {
      revision,
      source: root,
      origin: "http://127.0.0.1:5318",
      realComponents: hashes,
      generatedOverrides: [
        "layout banner",
        "service-settings synthetic",
        "trial-availability synthetic",
        "chat/consult local OCR and events",
      ],
      credentials: false,
      externalConnections: false,
      runtime: "production-build",
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
await runIsolated(
  destination,
  ["node_modules/next/dist/bin/next", "build", "--webpack"],
  "build.log",
);
console.log(JSON.stringify({ built: true, destination, revision }));
if (!process.argv.includes("--prepare-only"))
  console.log(JSON.stringify(await start(destination)));
