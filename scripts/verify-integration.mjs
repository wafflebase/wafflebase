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

const testExitCode = await runCommand("pnpm", ["backend", "test:e2e"], env);
process.exit(testExitCode);
