// Credential-free operator-browser preflight. Uses the actual application
// launcher, production (not synthetic UI) routes and unchanged OS egress policy.
// Run through payment-ci-guard.mjs; never pass plan.json or credentials.json.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { randomBytes } from "node:crypto";
import { startRuntime } from "./runtime.mjs";
import { TARGET, check } from "./policy.mjs";

const [stateFile, reportFile] = process.argv.slice(2);
check(
  process.argv.length === 4 && process.stdin.isTTY,
  "PROBE_ARGUMENTS_REQUIRED",
);
check(
  path.isAbsolute(stateFile) &&
    path.basename(stateFile) === "result-summary.json",
);
check(path.isAbsolute(reportFile) && !fs.existsSync(reportFile));
const prior = JSON.parse(fs.readFileSync(stateFile, "utf8"));
check(
  prior.account === TARGET.account &&
    prior.project === TARGET.ref &&
    prior.cleanupComplete,
);
const m = {
  scenario: "minimal-plus-v1",
  synthetic: false,
  project: TARGET.ref,
  account: TARGET.account,
  app: TARGET.app,
  amount: 980,
  currency: "jpy",
  interval: "month",
  run: "68229aba-5b74-486b-97d4-fa836baba65c",
  c: {
    id: prior.retained.c.id,
    email: prior.retained.c.email,
    cookie: randomBytes(24).toString("hex"),
  },
  d: {
    id: prior.retained.d.id,
    email: prior.retained.d.email,
    cookie: randomBytes(24).toString("hex"),
  },
  protectedUsers: [
    "3ebfb150-ada7-4159-a080-52eced94cbd7",
    "9aee987e-1c44-4a96-97b5-02a58647b3bd",
  ],
  customer: prior.retained.customer,
  portal: prior.retained.portal,
  clock: null,
  price: "price_1UQlpjI73kTcvXz814TUAfOd",
  product: "prod_VRfAjqXSjem3nl",
  version: "plus-integration-202610-980-v1",
  sessionSecret: randomBytes(32).toString("hex"),
};
const events = [];
let runtime,
  closed = false,
  localReads = 0,
  refused = 0,
  lines,
  timer;
async function close() {
  if (closed) return;
  closed = true;
  clearTimeout(timer);
  let stopped = false;
  try {
    await runtime?.stop();
    stopped = !runtime || !runtime.alive();
  } finally {
    fs.writeFileSync(
      reportFile,
      JSON.stringify(
        {
          sourceAttempt: prior.attemptId,
          app: TARGET.app,
          broker: TARGET.broker,
          actualLauncher: "startRuntime",
          syntheticUI: false,
          credentialsLoaded: false,
          providerConnections: 0,
          localReads,
          refused,
          events,
          stopped,
          temporaryRemoved: !runtime || !fs.existsSync(runtime.dir),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    lines?.close();
  }
}
try {
  runtime = await startRuntime({
    m,
    webhookSecret: "whsec_synthetic_browser_probe",
    record: (event) => events.push(event),
    // No provider transport, credentials, authentication or mutations. Anonymous
    // page reads use empty retained diagnoses and the approved 3/30 display limits.
    transport: async (r) => {
      const u = new URL(r.url);
      if (r.method === "GET" && u.origin === TARGET.supabase) {
        if (u.pathname === "/rest/v1/diagnoses") {
          localReads++;
          return { status: 200, text: "[]" };
        }
        if (u.pathname === "/rest/v1/service_settings") {
          localReads++;
          return {
            status: 200,
            text: JSON.stringify({ free_limit: 3, plus_limit: 30 }),
          };
        }
      }
      refused++;
      throw Error("NO_PROVIDER_CONNECTION_ALLOWED");
    },
  });
  console.log(
    JSON.stringify({
      ready: runtime.alive(),
      app: TARGET.app,
      providerConnections: 0,
    }),
  );
  lines = readline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (line === "status")
      console.log(
        JSON.stringify({
          alive: runtime.alive(),
          localReads,
          refused,
          connectionDiagnostics: events.filter((e) =>
            ["client_error", "cookie_scope"].includes(e.event),
          ),
          http: events
            .filter((e) => e.event === "http" && !e.path.startsWith("/_next/"))
            .slice(-20),
        }),
      );
    if (line === "stop") void close();
  });
  lines.on("close", () => {
    if (!closed) void close();
  });
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  timer = setTimeout(() => void close(), 20 * 60 * 1000);
} catch {
  await close();
  console.log("BROWSER_PREFLIGHT_FAILED");
  process.exitCode = 1;
}
