import { spawn } from "node:child_process";

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://wafflebase:wafflebase@localhost:5432/wafflebase";
const DEFAULT_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function withIntegrationEnv() {
  const env = { ...process.env };
  env.RUN_DB_INTEGRATION_TESTS = "true";
  env.DATABASE_URL ??= DEFAULT_TEST_DATABASE_URL;
  env.DATASOURCE_ENCRYPTION_KEY ??= DEFAULT_ENCRYPTION_KEY;
  return env;
}

function runCommand(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

const env = withIntegrationEnv();

const migrateExitCode = await runCommand(
  "pnpm",
  ["--filter", "@wafflebase/backend", "exec", "prisma", "migrate", "deploy"],
  env,
);
if (migrateExitCode !== 0) {
  process.exit(migrateExitCode);
}

const backendExitCode = await runCommand("pnpm", ["backend", "test:e2e"], env);

// Frontend Yorkie integration lane (tests/**/*.integration.ts). These run
// only when a Yorkie server is reachable (gated on YORKIE_RPC_ADDR), which
// CI sets after starting the server. Skipping the spawn entirely when it is
// unset keeps local `pnpm verify:integration` (backend-only) from needing
// the built workspace dists these tests resolve against. Both lanes run so
// failures in either are reported; exit non-zero if either failed.
let frontendExitCode = 0;
if (process.env.YORKIE_RPC_ADDR) {
  frontendExitCode = await runCommand(
    "pnpm",
    ["--filter", "@wafflebase/frontend", "test:integration"],
    env,
  );
}

process.exit(backendExitCode !== 0 ? backendExitCode : frontendExitCode);
