// Was a script run, or imported? One answer for every tool in this directory.
//
// WHY THIS EXISTS. The agent jobs do not start these files from the checkout:
// each workflow copies `scripts/agent` to `$RUNNER_TEMP/agent-tools` and runs
// them from there — `node "$RUNNER_TEMP/agent-tools/install-deps.mjs"`,
// `node "$RUNNER_TEMP/agent-tools/set-state.mjs"`, and so on for every tool the
// panel and the fix rounds call. A runner's temp directory can pass through a
// symbolic link, and Node resolves a module's own `import.meta.url` through
// links while leaving `argv[1]` exactly as typed. So the comparison each of
// those files used to make — `path.resolve(argv[1]) === fileURLToPath(import.meta.url)`,
// or the weaker `import.meta.url === \`file://${argv[1]}\`` — comes out unequal
// on precisely the runner they run on, and the script exits 0 having done
// nothing: no install, no state written, no refusal, and a step the workflow
// credits as successful.
//
// So both sides go through `realpath`. And an entry path that exists but cannot
// be resolved THROWS rather than answering "imported": returning false there
// reinstates the same silent no-op this module exists to remove, which is the
// one failure mode none of these tools can afford.

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * True when the module that passed its own `import.meta.url` is the file Node
 * was asked to run, false when it was imported.
 *
 * @param {string} metaUrl the caller's own `import.meta.url`
 * @returns {boolean}
 * @throws {Error} when a path that exists cannot be resolved through symbolic
 *   links, so neither answer is known to be the right one.
 */
export function isEntryPoint(metaUrl) {
  const entry = process.argv[1];
  // `node --eval` and the REPL: there is no script, so no file is being run as
  // one. Not an unknown — the only way to get here is an `import()` from eval.
  if (!entry) return false;

  const self = fileURLToPath(metaUrl);
  // The common case, and the cheap one: no link anywhere on the path.
  if (path.resolve(entry) === self) return true;

  let realEntry;
  try {
    realEntry = realpathSync(entry);
  } catch (error) {
    // A path that does not exist cannot be this module, which does.
    if (error?.code === "ENOENT") return false;
    throw unresolvable(entry, error);
  }
  try {
    return realEntry === realpathSync(self);
  } catch (error) {
    throw unresolvable(self, error);
  }
}

const unresolvable = (target, cause) =>
  new Error(`cannot tell whether this script was run or imported: ${target} does not resolve through symbolic links (${String(cause?.message ?? cause)})`, {
    cause,
  });
