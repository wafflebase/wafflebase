// The refusal that separates a useful tool from the thing that deleted someone's
// documents.
//
// Every charter up to now has been `mutating: false`, so the worst a probe could do
// was read. The backend charters CREATE, RENAME and DELETE documents. That is a
// genuine capability, and the only thing standing between it and a developer's real
// workspace is this file.
//
// THE SHAPE OF THE GUARANTEE. Not "the hunter tries to use a scratch workspace" —
// that is a hope. It is: the run REFUSES TO START unless a dedicated workspace was
// named explicitly AND cannot be shown to be the developer's. Absence of proof is
// refusal, not permission, because the failure mode here is unrecoverable: a deleted
// document does not come back from a reflog.
//
// WHY NOT ASK THE CLI. The obvious design is to run `wafflebase status --format
// json` and read the resolved workspace, since that is authoritative. It did not
// work when this hunter was written: `status` ignored `--format` and printed prose
// ("Not logged in. Run `wafflebase login`.") — ground-truth defect #9, one of the
// things this hunter exists to find. Issue #635 fixed that, so `status` now emits
// `{ loggedIn, workspaceId, … }` as JSON. Resolution stays source-based anyway: the
// guard must hold for a CLI build older than that fix, and reading the config
// sources cannot be defeated by a `status` that answers about a *different*
// resolution order than the command being guarded.
//
// So resolution is done from the SOURCES the CLI reads (`config.ts:77-113`: flags >
// env > session > profile), and where a file cannot be parsed confidently the check
// is deliberately CRUDE AND OVER-BROAD: any appearance of the candidate name inside
// the config or session file is treated as a collision. Over-refusing costs a
// developer one environment variable. Under-refusing costs them their documents.

import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const HUNT_WORKSPACE_VAR = "WAFFLEBASE_HUNT_WORKSPACE";

/**
 * Names too plausible to be a scratch workspace.
 *
 * Setting `WAFFLEBASE_HUNT_WORKSPACE=default` would satisfy every other check on a
 * machine with no config file, and then delete documents in `default` on a machine
 * that has one. A scratch workspace should be unmistakable, so obviously-real names
 * are refused outright.
 */
export const REFUSED_WORKSPACE_NAMES = Object.freeze([
  "default",
  "main",
  "master",
  "prod",
  "production",
  "staging",
  "personal",
  "my-workspace",
]);

/** Where the CLI looks for config and session, honouring the same overrides. */
export function configSources(env = process.env, home = os.homedir()) {
  return {
    // `WAFFLEBASE_CONFIG` overrides everything (config.ts:56).
    config: env.WAFFLEBASE_CONFIG || path.join(home, ".wafflebase", "config.yaml"),
    session: env.WAFFLEBASE_SESSION || path.join(home, ".wafflebase", "session.json"),
  };
}

/**
 * Decide whether a hunt may run, and against which workspace.
 *
 * Returns `{ ok: true, workspace }` or `{ ok: false, why }`. `why` is written for a
 * human staring at a refused run, so it says what to do next rather than merely
 * what went wrong.
 *
 * Seams (`env`, `home`, `readFile`, `exists`) are injected so the tests can build
 * hostile configurations without touching a real home directory — a test for this
 * file that wrote to `~/.wafflebase` would be its own hazard.
 */
export function resolveHuntWorkspace({
  env = process.env,
  home = os.homedir(),
  readFile = (p) => readFileSync(p, "utf8"),
  exists = (p) => existsSync(p),
} = {}) {
  const raw = env[HUNT_WORKSPACE_VAR];

  // 1. Explicit, or nothing. There is deliberately no default and no inference from
  //    the developer's config: a workspace that a mutating run may destroy has to be
  //    a decision someone typed, not something this code guessed.
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      why:
        `${HUNT_WORKSPACE_VAR} is not set. Backend charters create, rename and delete ` +
        `documents, so they refuse to run without a dedicated throwaway workspace. ` +
        `Set ${HUNT_WORKSPACE_VAR} to a workspace you are willing to lose.`,
    };
  }
  const workspace = raw.trim();

  // 2. Not an obviously-real name.
  if (REFUSED_WORKSPACE_NAMES.includes(workspace.toLowerCase())) {
    return {
      ok: false,
      why:
        `${HUNT_WORKSPACE_VAR}=${workspace} looks like a real workspace, not a scratch ` +
        `one. Refusing rather than risking it. Use something unmistakable, e.g. ` +
        `"hunt-scratch".`,
    };
  }

  // 3. Not the workspace the developer's own environment selects.
  const ambient = typeof env.WAFFLEBASE_WORKSPACE === "string" ? env.WAFFLEBASE_WORKSPACE.trim() : "";
  if (ambient !== "" && ambient === workspace) {
    return {
      ok: false,
      why:
        `${HUNT_WORKSPACE_VAR} equals WAFFLEBASE_WORKSPACE (${workspace}), which is the ` +
        `workspace your own commands use. A mutating hunt would delete your documents. ` +
        `Point it at a different workspace.`,
    };
  }

  // 4. Not named anywhere in the developer's config or session.
  //
  //    Substring rather than parsed-field matching, on purpose. Parsing YAML here
  //    would mean either a new dependency or a hand-rolled parser whose bugs are
  //    silent, and a MISSED collision is unrecoverable while a false collision costs
  //    one renamed variable. So the crude check is the correct one.
  const sources = configSources(env, home);
  for (const [kind, file] of Object.entries(sources)) {
    if (!exists(file)) continue; // nothing there is genuinely safe, not unproven
    let text;
    try {
      text = readFile(file);
    } catch (err) {
      // Present but unreadable: cannot prove safety, so refuse. This is the branch
      // that keeps the guarantee from degrading to "usually".
      return {
        ok: false,
        why:
          `Could not read your ${kind} file (${file}: ${err.message}), so it is not ` +
          `possible to confirm ${HUNT_WORKSPACE_VAR}=${workspace} is not your real ` +
          `workspace. Refusing.`,
      };
    }
    if (String(text).includes(workspace)) {
      return {
        ok: false,
        why:
          `${HUNT_WORKSPACE_VAR}=${workspace} appears in your ${kind} file (${file}). ` +
          `It may be a workspace you actually use, and a mutating hunt would delete ` +
          `documents in it. Refusing. Choose a name that appears nowhere in your config.`,
      };
    }
  }

  return { ok: true, workspace };
}

/**
 * The name every seeded document gets.
 *
 * Cleanup deletes by this PREFIX and nothing else, so a document that existed before
 * the run is unreachable by construction — the deletion path never sees a name it
 * did not create. `runId` is in the prefix so two concurrent runs cannot delete each
 * other's fixtures, which would look exactly like a flaky test.
 */
export function seedName(runId, n) {
  return `${seedPrefix(runId)}${n}`;
}

/**
 * The prefix `cleanup` is allowed to match.
 *
 * The run id is LENGTH-PREFIXED (`hunt-<len>-<id>-`) so no run's prefix can ever be
 * a prefix of another's. A bare `hunt-<id>-` is not prefix-free: `hunt-abc-` also
 * begins `hunt-abc-123-4`, so a cleanup for run `abc` would match — and delete —
 * run `abc-123`'s fixtures. The default run id is a fixed-length git sha where that
 * cannot arise, but `--run-id` accepts anything, and an unrecoverable deletion is
 * not a place to rely on the caller's ids being well-behaved.
 */
export function seedPrefix(runId) {
  const id = String(runId);
  return `hunt-${id.length}-${id}-`;
}

/**
 * Is this document one of ours, from this run?
 *
 * Used as the ONLY filter on the delete path. Deliberately exact-prefix rather than
 * "contains": a document a user happened to name `my-hunt-abc-notes` must not match.
 */
export function isSeeded(name, runId) {
  return typeof name === "string" && name.startsWith(seedPrefix(runId));
}
