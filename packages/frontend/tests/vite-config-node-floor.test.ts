import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Vite's config bundler externalizes every bare specifier: it resolves the id
 * to an absolute path and marks it external, so **Node** — not esbuild — loads
 * that file. When the id resolves into a workspace package that exports raw
 * TypeScript, Node is handed a `.ts` file, which it can only read from 22.18
 * where type stripping became the default.
 *
 * That is not a theoretical failure. `vite.config.ts` importing
 * `@wafflebase/debug-report/plugin` as a bare specifier made `pnpm dev`,
 * `frontend:test` and `frontend:build` all die on
 * `ERR_UNKNOWN_FILE_EXTENSION` for every contributor on Node 22.14-22.17 —
 * inside the active 22 LTS line — with a stack trace that never mentions Node.
 *
 * CI could not catch it: `node-version: 22.x` resolves to the newest 22, so
 * the floor is never the version under test. `--no-experimental-strip-types`
 * is what lets a modern Node stand in for an old one, which is why this guard
 * works on the same runner that missed the original break.
 */
describe("frontend vite config", () => {
  it("loads on a Node that cannot parse TypeScript", async () => {
    const probe = [
      "const { loadConfigFromFile } = await import('vite');",
      "const r = await loadConfigFromFile(",
      "  { command: 'serve', mode: 'test' },",
      "  process.argv[1],",
      ");",
      "if (!r?.config) throw new Error('config did not load');",
    ].join("\n");

    await expect(
      execFileAsync(
        process.execPath,
        [
          "--no-experimental-strip-types",
          "--input-type=module",
          "--eval",
          probe,
          path.join(packageRoot, "vite.config.ts"),
        ],
        { cwd: packageRoot },
      ),
    ).resolves.toBeDefined();
  }, 60_000);
});
