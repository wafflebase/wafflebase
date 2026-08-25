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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  laneOrderViolations,
  readCiConfig,
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

  await t.test("every inert tag in harness.config.json is claimed by a lane", () => {
    // The failure this catches is silent and expensive: an inert entry whose tag
    // no lane selects stops forcing a full run AND leaves its paths tested by
    // nothing, which reads as a fast CI rather than as missing coverage. It bites
    // hardest for the inert *packages* — an inert match short-circuits the
    // packages/ classification, so `pkgs` alone can never select their lane.
    const laneTags = new Set(LANES.flatMap((l) => l.tags));
    for (const entry of readCiConfig(REPO_ROOT).inert) {
      for (const tag of entry.tags ?? []) {
        assert.ok(
          laneTags.has(tag),
          `inert tag "${tag}" (${entry.paths.join(", ")}) is claimed by no lane`,
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

  await t.test("every lane that loads design-editor's dist declares its build", () => {
    // PINNED BY NAME, because the generic "a selected lane never runs without its
    // prerequisites" check below is self-consistent: delete the edge and it still
    // passes. The failure that costs is specific and opaque — with
    // packages/design-editor/dist absent, knip's own load of the package dies and
    // `verify:entropy` reports `Could not parse knip output as JSON`, while
    // design-sandbox's tsc reports "Cannot find module '@wafflebase/design-editor'"
    // against three files at once. Neither names a missing build.
    //
    // These three all reach `exports["."]` → `dist/plugin/index.js`: knip resolves it
    // while analysing the workspace, design-sandbox's program contains it, and
    // design-editor's own typecheck emits it.
    for (const name of ["design-editor:check", "design-sandbox:check", "verify:entropy"]) {
      assert.ok(
        byName.get(name)?.needs.includes("design-editor:build"),
        `${name} loads packages/design-editor/dist, so it must need design-editor:build`,
      );
    }
  });

  await t.test("design-editor:build produces what its exports map names", () => {
    // The edge above is only worth having if the lane builds the path the consumers
    // resolve. `exports["."]` is the contract between them; a build script that stopped
    // emitting there would leave the lane green and every consumer broken.
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "packages/design-editor/package.json"), "utf8"),
    );
    assert.match(pkg.exports?.["."]?.default ?? "", /^\.\/dist\//);
    assert.ok(
      (pkg.scripts?.build ?? "").includes("build:plugin"),
      "design-editor:build runs `pnpm … build`, which must emit dist/plugin",
    );
  });

  await t.test("every workspace package is covered by some lane", () => {
    // A package with no lane naming it would be typechecked and tested by
    // nothing on a filtered run, while still looking covered because the full
    // run tests it. Only packages with a manifest are in the graph, which is why a
    // manifest-less directory (`packages/design-sdk` was one) cannot appear here.
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

  await t.test("a design-editor change runs its check AND the knip gate", () => {
    // `packages` is empty on purpose: harness.config.json lists
    // packages/design-editor/** as inert, so the resolver never puts the package
    // in the closure and the tag is each lane's only route in.
    const selected = select({
      full: false,
      packages: [],
      tags: ["designEditor"],
    });
    assert.ok(selected.has("design-editor:check"));
    // The consumer of that package's SOURCE. design-sandbox imports design-editor
    // through its `exports` map, so its typecheck program contains design-editor's
    // files and a change here can break it. Neither package lands in `packages`
    // (both are inert), so the shared tag is the only thing that runs this lane —
    // which is why changed-areas.test.mjs asserts the two share one.
    assert.ok(
      selected.has("design-sandbox:check"),
      "a design-editor change must typecheck the package that consumes its source",
    );
    // knip analyses packages/design-editor, so this is the one gate a change here
    // can fail. `anyPkg` cannot reach it for an inert package — only the tag can.
    assert.ok(
      selected.has("verify:entropy"),
      "a design-editor change must still run the dead-code gate",
    );
    // Pulled in by the `needs` of all three above, not by the tag. Named here as well
    // as in the graph test so a dropped edge fails at BOTH altitudes: the declaration
    // and the selection that has to honour it.
    assert.ok(
      selected.has("design-editor:build"),
      "the lanes that load packages/design-editor/dist must drag its build along",
    );
    // Pulled in by entropy's `needs`, not by the tag.
    assert.ok(selected.has("core:build"));
    // Still nothing that cannot be affected.
    assert.ok(!selected.has("frontend:test"));
    assert.ok(!selected.has("backend:test"));
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
