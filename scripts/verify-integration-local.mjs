import net from "node:net";
import { spawn } from "node:child_process";

function parseDatabaseAddress() {
  const fallback = { host: "localhost", port: 5432 };
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return fallback;

  try {
    const parsed = new URL(databaseUrl);
    const host = parsed.hostname || fallback.host;
    const port = parsed.port ? Number(parsed.port) : fallback.port;
    if (!Number.isFinite(port) || port <= 0) {
      return fallback;
    }
    return { host, port };
  } catch {
    return fallback;
  }
}

function isReachable(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finalize = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finalize(true));
    socket.once("timeout", () => finalize(false));
    socket.once("error", () => finalize(false));
    socket.connect(port, host);
  });
}

function runIntegrationCommand() {
  return new Promise((resolve) => {
    const command = spawn(
      "pnpm",
      ["verify:integration"],
      { stdio: "inherit", shell: process.platform === "win32" },
    );
    command.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
    command.once("error", () => resolve(1));
  });
}

const { host, port } = parseDatabaseAddress();
const reachable = await isReachable(host, port);

if (!reachable) {
  console.log(
    `[verify:integration:local] Skipping integration checks: PostgreSQL ` +
      `is unreachable at ${host}:${port}.`,
  );
  console.log(
    "[verify:integration:local] Start local services (for example: " +
      "`docker compose up -d`) and rerun to execute integration checks.",
  );
  process.exit(0);
}

const exitCode = await runIntegrationCommand();
process.exit(exitCode);
