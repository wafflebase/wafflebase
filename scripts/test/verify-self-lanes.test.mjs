// The lane graph in `verify-self.mjs`, checked as data.
//
// The array is read back out of the runner via `--print-lanes` rather than
// imported, because importing that module runs the suite. So these assertions
// are made against the real array the runner uses, not a copy of it that could
// drift — which matters most for the two properties nothing else can catch: that
// every `needs` edge points backwards, and that every lane can actually be
// selected by something.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  laneOrderViolations,
  readWorkspaceGraph,
  selectLaneNames,
} from "../changed-areas.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const LANES = JSON.parse(
  execFileSync("node", ["scripts/verify-self.mjs", "--print-lanes"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }),
);

const names = LANES.map((l) => l.name);
const byName = new Map(LANES.map((l) => [l.name, l]));

// Lanes with no `pkgs`, `tags` or `anyPkg`: they can only ever run on a full
// pass. Enumerated rather than merely counted, so ADDING one has to be a
// deliberate edit here — an accidentally selector-less lane would silently stop
// running on every filtered PR, which is the failure this file exists to catch.
const DELIBERATELY_FULL_ONLY = ["scripts:tests"];

test("the lane graph", async (t) => {
  await t.test("is non-trivial", () => {
    assert.ok(LANES.length > 20, `expected the decomposed set, got ${LANES.length}`);
  });

  await t.test("lane names are unique", () => {
    assert.equal(new Set(names).size, names.length);
  });

  await t.test("every needs edge points backwards at a known lane", () => {
    assert.deepEqual(laneOrderViolations(LANES), []);
  });

  await t.test("every pkgs entry is a real workspace package", () => {
    const graph = readWorkspaceGraph(REPO_ROOT);
    for (const lane of LANES) {
      for (const pkg of lane.pkgs) {
        assert.ok(
          Object.hasOwn(graph, pkg),
          `lane ${lane.name} names package "${pkg}", which is not in packages/`,
        );
      }
    }
  });

  await t.test("only the enumerated lanes lack a selector", () => {
    const selectorless = LANES.filter(
      (l) => l.pkgs.length === 0 && l.tags.length === 0 && !l.anyPkg,
    ).map((l) => l.name);
    assert.deepEqual(selectorless, DELIBERATELY_FULL_ONLY);
  });

  await t.test("every workspace package is covered by some lane", () => {
    // A package with no lane naming it would be typechecked and tested by
    // nothing on a filtered run, while still looking covered because the full
    // run tests it. `design-sdk` has no manifest yet, so it is not in the graph.
    const graph = readWorkspaceGraph(REPO_ROOT);
    const covered = new Set(LANES.flatMap((l) => l.pkgs));
    for (const pkg of Object.keys(graph)) {
      assert.ok(covered.has(pkg), `no lane covers packages/${pkg}`);
    }
  });
});

test("selection against the real lane graph", async (t) => {
  const select = (resolved) => selectLaneNames(LANES, resolved);

  await t.test("full selects every lane", () => {
    assert.equal(select({ full: true }).size, LANES.length);
  });

  await t.test("an agent-only change runs two cheap lanes", () => {
    const selected = select({ full: false, packages: [], tags: ["agent"] });
    assert.deepEqual([...selected].sort(), ["agent:tests", "lint:scripts"]);
  });

  await t.test("a docs-prose change runs the prose lanes and entropy's builds", () => {
    const selected = select({ full: false, packages: [], tags: ["docsProse"] });
    assert.ok(selected.has("verify:entropy"));
    assert.ok(selected.has("verify:doc-index"));
    // Pulled in by `needs`, not by a tag — entropy wants every dist present.
    assert.ok(selected.has("core:build"));
    assert.ok(selected.has("slides:build"));
    assert.ok(!selected.has("frontend:test"));
    assert.ok(!selected.has("backend:test"));
  });

  await t.test("a .claude-only change runs nothing", () => {
    assert.equal(select({ full: false, packages: [], tags: [] }).size, 0);
  });

  await t.test("a notes change runs notes and its dependents, not its siblings", () => {
    // The reverse closure of `notes` is {notes, frontend}.
    const selected = select({
      full: false,
      packages: ["notes", "frontend"],
      tags: [],
    });
    assert.ok(selected.has("notes:check"));
    assert.ok(selected.has("frontend:test"));
    assert.ok(selected.has("frontend:build"));
    assert.ok(selected.has("verify:frontend:chunks"));
    // core:build is reached only through frontend:test's `needs`.
    assert.ok(selected.has("core:build"), "the needs closure must pull core:build");
    // Siblings that cannot be affected.
    assert.ok(!selected.has("sheets:check"));
    assert.ok(!selected.has("backend:test"));
    assert.ok(!selected.has("cli:check"));
    // entropy runs on any package change.
    assert.ok(selected.has("verify:entropy"));
  });

  await t.test("a documentation change runs only its build", () => {
    const selected = select({
      full: false,
      packages: ["documentation"],
      tags: ["documentation"],
    });
    assert.ok(selected.has("documentation:build"));
    assert.ok(!selected.has("frontend:build"));
    assert.ok(!selected.has("sheets:check"));
  });

  await t.test("a core change reaches every package lane", () => {
    const graph = readWorkspaceGraph(REPO_ROOT);
    const selected = select({
      full: false,
      packages: Object.keys(graph),
      tags: [],
    });
    for (const lane of LANES) {
      if (lane.pkgs.length === 0) continue;
      assert.ok(selected.has(lane.name), `${lane.name} must run when core changes`);
    }
  });

  await t.test("a selected lane never runs without its prerequisites", () => {
    // Exhaustive over the graph: for each lane, build the narrowest resolution
    // that selects it, then walk its whole `needs` chain and assert every link
    // came along. One missing link means a lane running against an unbuilt
    // dependency, which fails as if the change under test were broken.
    for (const lane of LANES) {
      const selected = selectLaneNames(LANES, {
        full: false,
        packages: lane.pkgs,
        tags: lane.tags,
      });
      if (!selected.has(lane.name)) continue; // a full-only lane; nothing to check
      const pending = [...lane.needs];
      while (pending.length > 0) {
        const need = pending.pop();
        assert.ok(
          selected.has(need),
          `${lane.name} was selected without its prerequisite ${need}`,
        );
        pending.push(...(byName.get(need)?.needs ?? []));
      }
    }
  });
});
