// The `@claude` verb router is delivered BY NAME, not as a directory. Seven
// workflows open a cheap `route` job whose only step is
// `node scripts/agent/command.mjs "$BODY"`, and they fetch it with a non-cone
// sparse-checkout naming that one file — nothing else of `scripts/agent` is on
// disk in that job.
//
// So a local import added to command.mjs is not a refactor, it is an outage:
// the file it imports is absent, node exits with ERR_MODULE_NOT_FOUND before
// `parseCommand` is reached, and EVERY verb (`review`, `loop`, `fix`, `rerun`,
// `summarize`, the review replies) stops being routed at all. That is what
// happened when the run-or-imported check moved into direct-run.mjs: the unit
// tests all passed, because they import command.mjs from a FULL checkout, which
// is the one delivery shape the router never gets.
//
// These tests reproduce the delivery instead of reading the imports: the router
// is copied out alone and run, which is what the `route` job does. The workflow
// side is pinned too, so the day somebody widens one of those checkouts to the
// whole directory this file stops over-constraining them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.join(HERE, "..", "..", ".github", "workflows");
const ROUTER = "scripts/agent/command.mjs";
const TMP = realpathSync(os.tmpdir());

const area = (t) => {
  const base = mkdtempSync(path.join(TMP, "router-checkout-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
};

test("the router routes a verb with ONLY its own file on disk", (t) => {
  // Exactly the `route` job: one file, no siblings, no node_modules.
  const base = area(t);
  mkdirSync(path.join(base, "scripts", "agent"), { recursive: true });
  const solo = path.join(base, ROUTER);
  copyFileSync(path.join(HERE, "command.mjs"), solo);

  const r = spawnSync(process.execPath, [ROUTER, "please @claude review this", "pr"], { cwd: base, encoding: "utf8" });
  assert.equal(r.status, 0, `router failed when delivered alone:\n${r.stdout}${r.stderr}`);
  // The specific way it breaks, named so a failure here is unmistakable.
  assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND/, "the router imported a file its own checkout does not carry");
  assert.equal(r.stdout.trim(), "command=review");
});

test("delivered alone, the router still writes the verb to GITHUB_OUTPUT", (t) => {
  // An empty `command=` is the quiet half of this failure: the step succeeds and
  // routes nothing. Pin the output file the `route` job's `outputs:` reads.
  const base = area(t);
  mkdirSync(path.join(base, "scripts", "agent"), { recursive: true });
  copyFileSync(path.join(HERE, "command.mjs"), path.join(base, ROUTER));
  const out = path.join(base, "gh-output");

  const r = spawnSync(process.execPath, [ROUTER, "@claude fix", "issue"], {
    cwd: base,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: out },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(out, "utf8"), "command=fix\n");
});

test("the router's gate still fires when its entry path runs through a symbolic link", (t) => {
  // The reason direct-run.mjs exists, asserted against the router's own copy of
  // the check: `argv[1]` as typed differs from the module URL node resolved, and
  // a gate that got this wrong would print nothing and exit 0.
  const base = area(t);
  mkdirSync(path.join(base, "real"), { recursive: true });
  copyFileSync(path.join(HERE, "command.mjs"), path.join(base, "real", "command.mjs"));
  const linked = path.join(base, "link");
  symlinkSync(path.join(base, "real"), linked);

  const r = spawnSync(process.execPath, [path.join(linked, "command.mjs"), "@claude loop", "pr"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), "command=loop", "the router's entry check failed through a linked path");
});

test("the workflows that check the router out by name are the ones this pins", () => {
  // Non-cone sparse-checkout, so the patterns are paths. A list naming the
  // router without naming the directory is a single-file delivery; if one is
  // ever widened to `scripts/agent`, that job leaves this set and the router may
  // import freely in it — but the count below still has to be updated
  // deliberately, which is the point.
  const byName = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"))) {
    const src = readFileSync(path.join(WORKFLOWS, file), "utf8");
    if (new RegExp(`^\\s*(?:-\\s*)?(?:sparse-checkout:\\s*)?${ROUTER.replace(/\./g, "\\.")}\\s*$`, "m").test(src)) {
      byName.push(file);
    }
  }
  assert.deepEqual(byName.sort(), [
    "agent-fix.yml",
    "agent-implement.yml",
    "agent-loop.yml",
    "agent-rerun.yml",
    "agent-review-on-demand.yml",
    "agent-review-reply.yml",
    "agent-summarize.yml",
  ]);
});

test("the router imports node builtins only, so a one-file checkout is enough", () => {
  // The tests above would catch a broken import by running it; this one says
  // WHY in the failure message, and catches an import that happens to resolve on
  // a developer's full checkout.
  const src = readFileSync(path.join(HERE, "command.mjs"), "utf8");
  const WITH_FROM = /^\s*(?:import|export)\b[^;]*?\sfrom\s+["']([^"']+)["']/gm;
  const SIDE_EFFECT = /^\s*import\s+["']([^"']+)["']/gm;
  const specs = [...src.matchAll(WITH_FROM), ...src.matchAll(SIDE_EFFECT)].map((m) => m[1]);
  assert.ok(specs.length > 0, "expected the router to import something");
  for (const spec of specs) {
    assert.ok(
      spec.startsWith("node:"),
      `command.mjs imports ${JSON.stringify(spec)}; seven workflows check this file out ALONE, so only node: builtins are on disk — see the CLI comment in command.mjs`,
    );
  }
});
