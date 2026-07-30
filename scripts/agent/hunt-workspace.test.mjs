// This file guards the only irreversible capability in the harness. Everything else
// it does is recoverable — a bad report is closed, a bad branch is reset — but a
// deleted document is gone. So these are mostly REFUSAL tests, and each was checked
// to fail with its guard removed.
//
// No real home directory is touched: every seam is injected. A test for this file
// that wrote to `~/.wafflebase` would be its own hazard.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HUNT_WORKSPACE_VAR,
  REFUSED_WORKSPACE_NAMES,
  configSources,
  resolveHuntWorkspace,
  seedName,
  seedPrefix,
  isSeeded,
} from "./hunt-workspace.mjs";

/** Resolve against a fabricated world: no config, no session, nothing to collide. */
function resolve(env, files = {}) {
  return resolveHuntWorkspace({
    env,
    home: "/fake/home",
    exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => {
      const v = files[p];
      if (v instanceof Error) throw v;
      return v;
    },
  });
}

const HOME_CONFIG = "/fake/home/.wafflebase/config.yaml";
const HOME_SESSION = "/fake/home/.wafflebase/session.json";

// --- the happy path is narrow ------------------------------------------------

test("a distinct, explicit workspace with no config to collide with is allowed", () => {
  const r = resolve({ [HUNT_WORKSPACE_VAR]: "hunt-scratch" });
  assert.equal(r.ok, true);
  assert.equal(r.workspace, "hunt-scratch");
});

test("the value is trimmed, so a stray space cannot create a second workspace", () => {
  const r = resolve({ [HUNT_WORKSPACE_VAR]: "  hunt-scratch \n" });
  assert.equal(r.ok, true);
  assert.equal(r.workspace, "hunt-scratch");
});

// --- refusals ----------------------------------------------------------------

test("refuses when the variable is absent, empty or whitespace", () => {
  // There is deliberately NO default and no inference from the developer's config: a
  // workspace a mutating run may destroy has to be something someone typed.
  for (const env of [{}, { [HUNT_WORKSPACE_VAR]: "" }, { [HUNT_WORKSPACE_VAR]: "   " }, { [HUNT_WORKSPACE_VAR]: 42 }]) {
    const r = resolve(env);
    assert.equal(r.ok, false, `must refuse ${JSON.stringify(env)}`);
    assert.match(r.why, /is not set|not set/i);
  }
});

test("refuses an obviously-real workspace name", () => {
  // `WAFFLEBASE_HUNT_WORKSPACE=default` would pass every other check on a machine
  // with no config file, then delete documents in `default` on a machine that has one.
  for (const name of REFUSED_WORKSPACE_NAMES) {
    assert.equal(resolve({ [HUNT_WORKSPACE_VAR]: name }).ok, false, `${name} must be refused`);
    // Case must not be an escape hatch.
    assert.equal(resolve({ [HUNT_WORKSPACE_VAR]: name.toUpperCase() }).ok, false, `${name} upper must be refused`);
  }
});

test("refuses when it equals the developer's own WAFFLEBASE_WORKSPACE", () => {
  const r = resolve({ [HUNT_WORKSPACE_VAR]: "shared-ws", WAFFLEBASE_WORKSPACE: "shared-ws" });
  assert.equal(r.ok, false);
  assert.match(r.why, /your own commands use|equals WAFFLEBASE_WORKSPACE/);
  // A DIFFERENT ambient workspace is fine — that is the normal case.
  assert.equal(resolve({ [HUNT_WORKSPACE_VAR]: "hunt-ws", WAFFLEBASE_WORKSPACE: "real-ws" }).ok, true);
});

test("refuses when the name appears anywhere in the config or session file", () => {
  // Substring, not parsed-field: a hand-rolled YAML parser's bugs would be silent,
  // and a MISSED collision is unrecoverable while a false one costs a rename.
  const inConfig = resolve({ [HUNT_WORKSPACE_VAR]: "acme" }, { [HOME_CONFIG]: "profiles:\n  default:\n    workspace: acme\n" });
  assert.equal(inConfig.ok, false);
  assert.match(inConfig.why, /appears in your config file/);

  const inSession = resolve({ [HUNT_WORKSPACE_VAR]: "acme" }, { [HOME_SESSION]: JSON.stringify({ activeWorkspace: "acme" }) });
  assert.equal(inSession.ok, false);
  assert.match(inSession.why, /appears in your session file/);

  // A name that genuinely appears nowhere still passes with both files present.
  const clean = resolve(
    { [HUNT_WORKSPACE_VAR]: "hunt-zzz" },
    { [HOME_CONFIG]: "workspace: acme\n", [HOME_SESSION]: JSON.stringify({ activeWorkspace: "acme" }) },
  );
  assert.equal(clean.ok, true);
});

test("refuses when a config file exists but cannot be read", () => {
  // The branch that keeps the guarantee from degrading to "usually safe". Unreadable
  // means unproven, and unproven means refuse.
  const r = resolve({ [HUNT_WORKSPACE_VAR]: "hunt-scratch" }, { [HOME_CONFIG]: new Error("EACCES: permission denied") });
  assert.equal(r.ok, false);
  assert.match(r.why, /Could not read your config file/);
  assert.match(r.why, /Refusing/);
});

test("honours WAFFLEBASE_CONFIG / WAFFLEBASE_SESSION overrides when looking for collisions", () => {
  // `WAFFLEBASE_CONFIG` overrides everything in the CLI (config.ts:56). If this
  // resolver ignored it, a developer using a non-default config path would get NO
  // collision check at all — the most dangerous possible silent hole, because it
  // looks identical to a clean machine.
  const s = configSources({ WAFFLEBASE_CONFIG: "/custom/c.yaml", WAFFLEBASE_SESSION: "/custom/s.json" }, "/fake/home");
  assert.equal(s.config, "/custom/c.yaml");
  assert.equal(s.session, "/custom/s.json");

  const r = resolve(
    { [HUNT_WORKSPACE_VAR]: "acme", WAFFLEBASE_CONFIG: "/custom/c.yaml" },
    { "/custom/c.yaml": "workspace: acme\n" },
  );
  assert.equal(r.ok, false, "a collision in an overridden config path must still be caught");
});

test("defaults to the CLI's own config location when nothing overrides it", () => {
  const s = configSources({}, "/fake/home");
  assert.equal(s.config, "/fake/home/.wafflebase/config.yaml");
  assert.equal(s.session, "/fake/home/.wafflebase/session.json");
});

// --- seeded names: the delete path can only see what it created ---------------

test("seeded names carry the run id, so concurrent runs cannot delete each other's", () => {
  // Length-prefixed (`hunt-<len>-<id>-`) so no run's prefix is a prefix of another's.
  assert.equal(seedPrefix("abc123"), "hunt-6-abc123-");
  assert.equal(seedName("abc123", 4), "hunt-6-abc123-4");
  assert.equal(isSeeded("hunt-6-abc123-4", "abc123"), true);
  assert.equal(isSeeded("hunt-6-def456-4", "abc123"), false, "another run's fixture is not ours to delete");
});

test("seedPrefix is prefix-free, so a run cannot delete a run whose id extends its own", () => {
  // The bug the length prefix closes: bare `hunt-abc-` also begins `hunt-abc-123-4`,
  // so cleanup for run `abc` would match — and delete — run `abc-123`'s fixtures.
  const child = seedName("abc-123", 7); // run "abc-123"'s 7th document
  assert.equal(isSeeded(child, "abc"), false, "run 'abc' must not match run 'abc-123' fixtures");
  assert.equal(isSeeded(child, "abc-123"), true, "but run 'abc-123' owns it");
  // Symmetric guard: the shorter id is not matched by the longer run either.
  assert.equal(isSeeded(seedName("abc", 1), "abc-123"), false);
});

test("isSeeded is exact-prefix, so a user's similarly-named document is never matched", () => {
  // "contains" would match `my-hunt-6-abc123-notes`. Deletion must never be that loose.
  for (const name of [
    "my-hunt-6-abc123-notes",
    "HUNT-6-abc123-1",
    " hunt-6-abc123-1",
    "hunt-5-abc12-1",
    "hunt-abc123-1", // the OLD, un-length-prefixed shape must not match either
    "notes",
    "",
    null,
    undefined,
    42,
  ]) {
    assert.equal(isSeeded(name, "abc123"), false, `must not match: ${JSON.stringify(name)}`);
  }
  assert.equal(isSeeded("hunt-6-abc123-", "abc123"), true, "the bare prefix is still ours");
});
