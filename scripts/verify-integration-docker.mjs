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

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: capture ? "pipe" : "inherit",
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
    }

    child.once("error", (error) => {
      resolve({
        code: 1,
        stdout,
        stderr:
          stderr ||
          `[verify:integration:docker] Failed to run ${command}: ${error.message}`,
      });
    });

    child.once("exit", (code, signal) => {
      resolve({
        code: signal ? 1 : (code ?? 1),
        stdout,
        stderr,
      });
    });
  });
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

async function waitForDatabase(host, port, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const reachable = await isReachable(host, port);
    if (reachable) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

let postgresStartedByScript = false;
let cleanupPromise = null;

function installSignalHandlers() {
  const handlers = new Map();
  const signals = ["SIGINT", "SIGTERM"];

  for (const signal of signals) {
    const handler = () => {
      console.error(
        `[verify:integration:docker] Received ${signal}. ` +
          "Stopping local postgres before exit.",
      );
      void (async () => {
        const stopCode = await stopPostgresIfNeeded(signal);
        process.exit(stopCode === 0 ? 130 : 1);
      })();
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
}

async function stopPostgresIfNeeded(reason) {
  if (!postgresStartedByScript) {
    return 0;
  }

  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      const stopResult = await run(
        "docker",
        ["compose", "stop", "postgres"],
        { capture: true },
      );
      if (stopResult.code !== 0) {
        console.error(
          "[verify:integration:docker] Failed to stop postgres during cleanup" +
            ` (${reason}).`,
        );
        if (stopResult.stderr.trim()) {
          console.error(stopResult.stderr.trim());
        }
      }
      return stopResult.code;
    })();
  }

  return cleanupPromise;
}

async function main() {
  const removeSignalHandlers = installSignalHandlers();
  let exitCode = 1;

  try {
    const composeCheck = await run("docker", ["compose", "version"], {
      capture: true,
    });
    if (composeCheck.code !== 0) {
      console.error(
        "[verify:integration:docker] Docker Compose is required. " +
          "Install/start Docker and retry.",
      );
      if (composeCheck.stderr.trim()) {
        console.error(composeCheck.stderr.trim());
      }
      return exitCode;
    }

    const runningCheck = await run(
      "docker",
      ["compose", "ps", "--status", "running", "-q", "postgres"],
      { capture: true },
    );
    if (runningCheck.code !== 0) {
      console.error(
        "[verify:integration:docker] Could not inspect postgres service state.",
      );
      if (runningCheck.stderr.trim()) {
        console.error(runningCheck.stderr.trim());
      }
      return exitCode;
    }

    const postgresWasRunning = runningCheck.stdout.trim().length > 0;
    if (!postgresWasRunning) {
      const upResult = await run("docker", ["compose", "up", "-d", "postgres"]);
      if (upResult.code !== 0) {
        exitCode = upResult.code;
        return exitCode;
      }
      postgresStartedByScript = true;
    }

    const { host, port } = parseDatabaseAddress();
    const ready = await waitForDatabase(host, port);
    if (!ready) {
      console.error(
        "[verify:integration:docker] PostgreSQL did not become reachable at " +
          `${host}:${port} within the timeout.`,
      );
      return exitCode;
    }

    const integrationResult = await run("pnpm", ["verify:integration"]);
    exitCode = integrationResult.code;
  } finally {
    removeSignalHandlers();
    const stopCode = await stopPostgresIfNeeded("finally");
    if (exitCode === 0 && stopCode !== 0) {
      exitCode = stopCode;
    }
  }

  return exitCode;
}

process.exit(await main());
