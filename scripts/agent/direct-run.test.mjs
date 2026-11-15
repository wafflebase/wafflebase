// `direct-run.mjs` answers one question for every tool in this directory: was
// this file run, or imported? The agent jobs start them from a staged copy
// under `$RUNNER_TEMP/agent-tools`, which can pass through a symbolic link, and
// the answer each of them used to compute came out "imported" there — so the
// step did nothing and reported success.
//
// These tests RUN scripts through a linked directory rather than read the
// comparison, and the guard at the bottom holds the whole directory to the
// shared module so the next tool does not hand-roll the broken form again.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./direct-run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = realpathSync(os.tmpdir());

const area = (t) => {
  const base = mkdtempSync(path.join(TMP, "direct-run-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return base;
};

test("imported, a module is not the entry point", () => {
  // This test file is what node was asked to run, so every module it imports
  // must answer "imported" — the gates of all 25 tools depend on that.
  assert.equal(isEntryPoint(new URL("./direct-run.mjs", import.meta.url).href), false);
  assert.equal(isEntryPoint(new URL("./install-deps.mjs", import.meta.url).href), false);
  // And the file node actually started is the entry point.
  assert.equal(isEntryPoint(import.meta.url), true);
});

test("run directly, through a linked directory, it is the entry point", (t) => {
  const base = area(t);
  const linked = path.join(base, "agent-tools");
  symlinkSync(HERE, linked);
  const probe = path.join(base, "probe.mjs");
  writeFileSync(probe, `import { isEntryPoint } from "${path.join(linked, "direct-run.mjs")}";\nconsole.log(isEntryPoint(import.meta.url) ? "entry" : "imported");\n`);
  const direct = spawnSync(process.execPath, [probe], { encoding: "utf8" });
  assert.equal(direct.stdout.trim(), "entry", direct.stderr);

  // The same file reached through the link: `argv[1]` as typed differs from the
  // module URL node resolved, which is the case this module exists for.
  const viaLink = spawnSync(process.execPath, [path.join(base, "agent-tools", "..", "probe.mjs")], { encoding: "utf8" });
  assert.equal(viaLink.stdout.trim(), "entry", viaLink.stderr);
});

test("an entry path that does not exist is not this module, which does", (t) => {
  const base = area(t);
  const argv = process.argv[1];
  t.after(() => {
    process.argv[1] = argv;
  });
  process.argv[1] = path.join(base, "no-such-script.mjs");
  assert.equal(isEntryPoint(import.meta.url), false);
});

test("an entry path that cannot be resolved throws instead of answering 'imported'", (t) => {
  const base = area(t);
  // A symbolic-link loop: the path exists, and resolving it fails with ELOOP.
  symlinkSync(path.join(base, "b"), path.join(base, "a"));
  symlinkSync(path.join(base, "a"), path.join(base, "b"));
  const argv = process.argv[1];
  t.after(() => {
    process.argv[1] = argv;
  });
  process.argv[1] = path.join(base, "a");
  assert.throws(() => isEntryPoint(import.meta.url), /cannot tell whether this script was run or imported/);
});

test("install-deps refuses an unresolvable entry path rather than exiting 0 having done nothing", (t) => {
  const base = area(t);
  symlinkSync(path.join(base, "b"), path.join(base, "a"));
  symlinkSync(path.join(base, "a"), path.join(base, "b"));
  // `argv[1]` is read when the module's gate runs, so setting it before the
  // dynamic import reproduces a run whose entry path cannot be resolved.
  const r = spawnSync(
    process.execPath,
    ["-e", `process.argv[1] = ${JSON.stringify(path.join(base, "a"))}; import(${JSON.stringify(path.join(HERE, "install-deps.mjs"))});`],
    { cwd: base, encoding: "utf8", env: { PATH: process.env.PATH, RUNNER_TEMP: base } },
  );
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /^::error::install-deps: cannot tell whether this script was run or imported/m);
});

test("every tool in this directory decides the question through this module", () => {
  // The forms that were wrong on a runner: `argv[1]` compared as typed against a
  // URL node had already resolved, and the `endsWith` approximations. A new tool
  // that copies one of them fails here rather than silently skipping its work in
  // the job that runs it.
  const HAND_ROLLED = [
    /path\.resolve\(process\.argv\[1\]\)\s*===/,
    /fileURLToPath\(import\.meta\.url\)\s*===\s*process\.argv\[1\]/,
    /import\.meta\.url\s*===\s*`file:\/\//,
    /realpathSync\(process\.argv\[1\]\)/,
    /process\.argv\[1\]\.endsWith\(/,
  ];
  const files = readdirSync(HERE).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && f !== "direct-run.mjs");
  assert.ok(files.length > 20, `expected the agent tools, found ${files.length}`);
  for (const f of files) {
    const src = readFileSync(path.join(HERE, f), "utf8");
    for (const re of HAND_ROLLED) {
      assert.ok(!re.test(src), `${f} hand-rolls its entry check (${re}); use isEntryPoint from ./direct-run.mjs`);
    }
    if (src.includes("isEntryPoint(")) {
      assert.match(src, /import \{ isEntryPoint \} from "\.\/direct-run\.mjs";/, f);
    }
  }
});

test("the tools the agent jobs launch from the staged directory gate through this module", () => {
  // Named rather than inferred: these are the ones a workflow starts with
  // `node "$RUNNER_TEMP/agent-tools/<name>.mjs"`, so they are the ones whose
  // entry check runs through a path that may be linked.
  for (const f of ["install-deps.mjs", "set-state.mjs", "loop-status.mjs", "pick-credential.mjs", "pick-fix-credential.mjs", "metrics.mjs", "session-job-summary.mjs", "review-surface.mjs"]) {
    const src = readFileSync(path.join(HERE, f), "utf8");
    assert.match(src, /import \{ isEntryPoint \} from "\.\/direct-run\.mjs";/, f);
    assert.match(src, /isEntryPoint\(import\.meta\.url\)/, f);
  }
});
