import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { hash, insist, TARGET } from "../payment-runtime/policy.mjs";
export const DB = Object.freeze({
  host: "aws-0-ap-northeast-1.pooler.supabase.com",
  port: "5432",
  user: "postgres." + TARGET.ref,
  database: "postgres",
});
export async function executeBody(sql, config, dir, record) {
  for (const k of [
    "NODE_OPTIONS",
    "PGOPTIONS",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSWORD",
    "PGHOST",
    "PGHOSTADDR",
    "PGSSLMODE",
    "PGSSLROOTCERT",
  ])
    insist(!process.env[k], "ENV_OVERRIDE");
  for (const [file, digest] of [
    [config.binary, config.binarySha256],
    [config.ca, config.caSha256],
  ]) {
    insist(
      path.isAbsolute(file) &&
        !fs.lstatSync(file).isSymbolicLink() &&
        hash(fs.readFileSync(file)) === digest,
      "PINNED_FILE_MISMATCH",
    );
  }
  insist(
    typeof config.password === "string" &&
      config.password.length > 0 &&
      !/[\r\n\0]/.test(config.password),
  );
  const pass = path.join(dir, "continuation.pgpass"),
    escape = (x) => x.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  fs.writeFileSync(
    pass,
    [DB.host, DB.port, DB.database, DB.user, config.password]
      .map(escape)
      .join(":") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  let child,
    buffer = "",
    stderr = "",
    waiter,
    phase = "tls",
    sent = false,
    code = null;
  const fail = () => {
    waiter?.reject(Error("PSQL_FAILED_OR_UNKNOWN"));
    waiter = null;
  };
  const until = (marker) =>
    new Promise((resolve, reject) => {
      waiter = { marker, resolve, reject };
    });
  const exit = new Promise((resolve) => {
    child = spawn(
      config.binary,
      [
        "-X",
        "-w",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        "VERBOSITY=sqlstate",
        "-h",
        DB.host,
        "-p",
        DB.port,
        "-U",
        DB.user,
        "-d",
        DB.database,
      ],
      {
        env: {
          PATH: "/usr/bin:/bin",
          HOME: dir,
          PGPASSFILE: pass,
          PGSSLMODE: "verify-full",
          PGSSLROOTCERT: config.ca,
          PGCONNECT_TIMEOUT: "15",
          LC_ALL: "C",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (b) => {
      buffer += b;
      if (buffer.length > 1000000) {
        fail();
        child.kill();
        return;
      }
      if (waiter && buffer.includes(waiter.marker)) {
        const w = waiter;
        waiter = null;
        w.resolve(buffer);
        buffer = "";
      }
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-2048);
    });
    child.on("error", () => {
      fail();
      resolve();
    });
    child.on("exit", (n) => {
      code = n;
      fail();
      resolve();
    });
    child.stdin.on("error", fail);
  });
  const timer = setTimeout(() => {
    fail();
    child.kill("SIGKILL");
  }, 180000);
  try {
    let response = until("CONTINUATION_TLS_GATE");
    child.stdin.write(
      "\\conninfo\nBEGIN READ ONLY;\nSELECT json_build_object('db',current_database(),'role',current_user,'ro',current_setting('transaction_read_only'))::text;\nCOMMIT;\n\\echo CONTINUATION_TLS_GATE\n",
    );
    const first = await response,
      identity = first.split("\n").find((x) => x.trim().startsWith("{"));
    const info = JSON.parse(identity ?? "null");
    insist(
      /SSL connection \(protocol: TLSv1\.[23], cipher:/.test(first) &&
        info?.db === "postgres" &&
        info.role === "postgres" &&
        info.ro === "on",
      "PSQL_TLS_IDENTITY_GATE",
    );
    record("sql_transport_gate", {
      clientTlsVerified: true,
      roleVerified: true,
      initialReadOnly: true,
      internalTls: "unconfirmed",
    });
    phase = "body";
    record("body_send_reserved", { sha256: hash(sql), count: 1 });
    sent = true;
    response = until("CONTINUATION_BODY_END");
    child.stdin.write(sql + "\n\\echo CONTINUATION_BODY_END\n");
    const result = await response;
    insist(result.split(/\r?\n/).includes("COMMIT"), "COMMIT_RESPONSE_MISSING");
    child.stdin.end("\\q\n");
    await exit;
    insist(code === 0, "PSQL_EXIT_NONZERO");
    record("body_commit", { exitCode: code, commitResponse: true });
    return { exitCode: 0, commitResponse: true };
  } catch {
    child.stdin.destroy();
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([exit, new Promise((r) => setTimeout(r, 1000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await exit;
    record("body_sql_failed", {
      stage: phase,
      sent,
      exitCode: code,
      sqlstate:
        (stderr.match(/\b(?:42501|42601|57014|55P03|P0001)\b/) || [])[0] ??
        null,
    });
    throw Error("PSQL_FAILED_OR_UNKNOWN");
  } finally {
    clearTimeout(timer);
    if (fs.existsSync(pass)) fs.unlinkSync(pass);
    buffer = "";
    stderr = "";
  }
}
