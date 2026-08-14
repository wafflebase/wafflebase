// Invariants of THIS repository's `.github/workflows/agent-*.yml`.
//
// WHY THIS FILE EXISTS. These guards used to live in `scripts/agent/checks.test.mjs`,
// which was part of the pipeline mirror and was deleted with it. The workflows they
// guard did NOT move — they are wafflebase's own, and after the deletion nothing
// checked them at all. That is the trap the extraction keeps setting: a test can be
// about this repo while sitting in a directory that belongs to another one.
//
// Each assertion here corresponds to a failure that actually happened:
//
//   * GH_REPO absent  -> the whole autonomous loop died repo-wide for a day. `gh`
//     expands `{owner}/{repo}` by shelling out to git, the adapter deletes the only
//     .git in the workspace, and every step running before the PR checkout failed
//     with "not a git repository". Fixed in #790; nothing stopped it recurring.
//
//   * adapter out of order -> the pipeline is read before it has been placed, so a
//     step runs the consumer's own copy or nothing at all.
//
// The sha-pin shape that `checks.test.mjs` also guarded now lives in `readPins`
// (see verify-pipeline-drift.test.mjs), which reports a loose ref instead of
// silently dropping it.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = path.join(REPO, ".github", "workflows");

const agentWorkflows = readdirSync(WORKFLOWS)
  .filter((f) => f.startsWith("agent-") && f.endsWith(".yml"))
  .sort();

test("there are agent workflows to check, so a rename cannot vacuously pass", () => {
  // Without this the whole file no-ops the moment the glob stops matching.
  assert.ok(agentWorkflows.length >= 9, `found only ${agentWorkflows.length} agent-*.yml`);
});

test("every agent workflow sets GH_REPO at WORKFLOW level", () => {
  // Workflow level, not job level: the outage reached jobs nobody had thought about,
  // and a per-job block only covers the jobs someone remembered. `gh` needs it in
  // every step that runs before the repo is checked out — present and future.
  for (const f of agentWorkflows) {
    const lines = readFileSync(path.join(WORKFLOWS, f), "utf8").split("\n");
    const start = lines.findIndex((l) => l === "env:");
    assert.notEqual(start, -1, `${f} has no workflow-level env: block`);
    let found = false;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^[^\s#]/.test(lines[i])) break; // dedented to a new top-level key
      if (/^\s+GH_REPO:\s*\$\{\{\s*github\.repository\s*\}\}/.test(lines[i])) { found = true; break; }
    }
    assert.ok(found, `${f} does not set GH_REPO: \${{ github.repository }} at workflow level`);
  }
});

test("the pipeline is PLACED before anything reads it", () => {
  // Anchored on the step name rather than a line number, so reordering unrelated
  // steps cannot silently retarget the assertion.
  for (const f of agentWorkflows) {
    const src = readFileSync(path.join(WORKFLOWS, f), "utf8");
    const lines = src.split("\n");
    const place = lines.findIndex((l) => l.includes("Place the trusted pipeline"));
    if (place === -1) continue; // this workflow does not adapt; nothing to order
    const checkout = lines.findIndex((l) => /repository:\s*wafflebase\/agent-pipeline/.test(l));
    assert.notEqual(checkout, -1, `${f} places the pipeline but never checks it out`);
    assert.ok(checkout < place, `${f} places the pipeline before checking it out`);
    // The mv must name the scratch path the checkout wrote to.
    const mv = lines.slice(place, place + 8).find((l) => l.includes("mv .pipeline-src/packages/pipeline"));
    assert.ok(mv, `${f}'s placement step does not move .pipeline-src/packages/pipeline`);
  }
});

test("no agent workflow checks the pipeline out to a MUTABLE ref", () => {
  // Belt to readPins' braces, stated where a workflow author will see it: in this
  // phase nothing re-verifies the fetched code, so the pin is the entire guard.
  for (const f of agentWorkflows) {
    const lines = readFileSync(path.join(WORKFLOWS, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/^\s*repository:\s*wafflebase\/agent-pipeline\s*(#.*)?$/.test(line)) return;
      const ref = lines.slice(i + 1, i + 4).find((l) => /^\s*ref:/.test(l));
      assert.ok(ref, `${f}:${i + 1} checks out the pipeline with no ref:`);
      assert.match(
        ref,
        /^\s*ref:\s*[0-9a-f]{40}\s*(#.*)?$/,
        `${f}:${i + 2} must pin a 40-character commit (tag in a trailing comment), got: ${ref.trim()}`,
      );
    });
  }
});

test("every pipeline script runs from a path something actually populated", () => {
  // ORDER-AWARE, and aware of ALL THREE destinations. This is the check that keeps
  // catching things, and each time it missed something it was because it modelled
  // fewer states than the workflows use. There are three adapter targets in play —
  // `scripts/agent`, `.trusted/scripts/agent`, `.trusted-agent/scripts/agent` — and
  // a first version that understood only the first left 19 invocations unexamined.
  //
  // What moves a path in and out of "holds the pinned copy":
  //
  //   mv .pipeline-src/packages/pipeline <dest>   populates <dest>
  //   cp -R <src> <dest>                          populates <dest> (staging)
  //   rm -rf <dest>                               empties it
  //   actions/checkout of the WORKSPACE           empties every workspace path,
  //                                               because checkout runs git clean;
  //                                               $RUNNER_TEMP survives, which is
  //                                               exactly why agent-tools lives there
  //
  // A file that still EXISTS under scripts/agent is measurement — `classify.mjs`,
  // the hunters — and the workspace is its home, so reading it there is correct. One
  // that does not exist can only be arriving from an adapter, and then which path it
  // is read from is the entire question. Keying on absence keeps this offline: no
  // need for the pipeline repo's file list.
  const problems = [];
  // `${{ runner.temp }}` and `$RUNNER_TEMP` name the same directory; a staging step
  // writes one spelling and the steps that use it write the other, so they have to
  // be folded together or the staged copy looks unpopulated.
  const norm = (p) =>
    path.posix.normalize(
      p.replace(/\$\{\{\s*runner\.temp\s*\}\}/g, "<TMP>").replace(/\$\{?RUNNER_TEMP\}?/g, "<TMP>"),
    );
  for (const f of agentWorkflows) {
    const lines = readFileSync(path.join(WORKFLOWS, f), "utf8").split("\n");
    const jobsAt = lines.findIndex((l) => l === "jobs:");
    if (jobsAt === -1) continue;
    const starts = lines.reduce((acc, l, i) => (i > jobsAt && /^ {2}[\w-]+:\s*$/.test(l) ? [...acc, i] : acc), []);
    for (let k = 0; k < starts.length; k++) {
      const [from, to] = [starts[k], starts[k + 1] ?? lines.length];
      let populated = new Set();
      for (let i = from; i < to; i++) {
        const line = lines[i];
        // FIRST, before any state transition. A commented-out adapter or staging
        // line must not populate anything: reading it as real would make a path
        // that nothing fills look trusted, which is the failure this check exists
        // to catch, arrived at through the check itself.
        if (line.trim().startsWith("#")) continue;
        const mv = /mv\s+\.pipeline-src\/packages\/pipeline\s+(\S+)/.exec(line);
        if (mv) populated.add(norm(mv.group ? mv.group(1) : mv[1]));
        // The destination may be quoted AND contain spaces — `"${{ runner.temp }}/…"`
        // is the common spelling, and a character class that stops at whitespace
        // captures `${{` instead, which reads as "nothing was staged".
        const cp = /cp -R\s+\S+\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(line);
        if (cp) populated.add(norm(cp[1] ?? cp[2] ?? cp[3]));
        const rm = /rm -rf\s+([^\s;&|]+)/.exec(line);
        if (rm) {
          const t = norm(rm[1]);
          populated = new Set([...populated].filter((p) => p !== t && !p.startsWith(`${t}/`)));
        }
        if (/^\s*- uses: actions\/checkout@/.test(line)) {
          const ahead = lines.slice(i + 1, i + 9).join("\n");
          if (!ahead.includes("wafflebase/agent-pipeline") && !ahead.includes("clean: false")) {
            // Only paths OUTSIDE the workspace survive. `<TMP>` is the normalised
            // RUNNER_TEMP — testing for a literal `$` here silently discarded it,
            // since normalisation had already replaced the sigil.
            populated = new Set([...populated].filter((p) => p.startsWith("<TMP>")));
          }
        }
        // ANY directory, not only ones ending in scripts/agent: the staged copy at
        // $RUNNER_TEMP/agent-tools is the trusted source most post-checkout steps
        // use, and a version of this check that only matched `scripts/agent/` never
        // noticed when the step that stages it was removed.
        const inv = /\bnode\s+["']?([.\w/${}()\s-]*?\/)([\w.-]+\.mjs)/.exec(line);
        if (!inv) continue;
        const [, dir, file] = inv;
        if (existsSync(path.join(REPO, "scripts", "agent", file))) continue;
        if (existsSync(path.join(REPO, dir.replace(/\/$/, ""), file))) continue; // a real tracked path
        const dest = norm(dir.replace(/\/$/, ""));
        if (!populated.has(dest)) {
          problems.push(`${f}:${i + 1} reads ${dir}${file} but nothing populated ${dest} there`);
        }
      }
    }
  }
  assert.deepEqual(
    problems,
    [],
    `these read pipeline code from a path no adapter filled — or one a checkout ` +
      `wiped. Stage to $RUNNER_TEMP/agent-tools before any workspace checkout:\n${problems.join("\n")}`,
  );
});
