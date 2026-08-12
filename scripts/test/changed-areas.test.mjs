// The fail-safe is the whole point of this module, so most of what follows
// asserts that unrelated failures all land on "run everything" rather than on a
// plausible-looking small answer. Each `full: true` route gets its own test,
// because they are reached by genuinely different code paths and a shared
// assertion would hide one of them regressing.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classify,
  globToRegExp,
  laneSelected,
  readCiConfig,
  readWorkspaceGraph,
  resolve,
  reverseClosure,
} from "../changed-areas.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const GRAPH = {
  core: [],
  notes: [],
  docs: ["core"],
  sheets: ["core"],
  slides: ["core", "docs"],
  board: ["core", "docs", "slides"],
  frontend: ["board", "core", "docs", "notes", "sheets", "slides"],
  backend: ["docs", "sheets", "slides"],
  cli: ["docs", "slides"],
  documentation: [],
};

const CI = {
  inert: [
    { paths: ["scripts/agent/**"], tags: ["agent"] },
    { paths: ["docs/**", "*.md"], tags: ["docsProse"] },
    { paths: [".claude/**"], tags: [] },
    { paths: ["packages/documentation/**"], tags: ["documentation"] },
  ],
  ciConfig: ["harness.config.json", "scripts/verify-*.mjs", ".github/workflows/**"],
};

test("globToRegExp", async (t) => {
  await t.test("** crosses separators", () => {
    assert.match("docs/design/sheets/sheet.md", globToRegExp("docs/**"));
    assert.match("docs/a.md", globToRegExp("docs/**"));
  });

  await t.test("a single star stops at a separator", () => {
    // The reason packages/README.md is not treated as prose: it falls through
    // to a full run instead, which is the safe answer.
    assert.match("README.md", globToRegExp("*.md"));
    assert.doesNotMatch("packages/README.md", globToRegExp("*.md"));
    assert.doesNotMatch("docs/a.md", globToRegExp("*.md"));
  });

  await t.test("dots are literal, not wildcards", () => {
    assert.match("harness.config.json", globToRegExp("harness.config.json"));
    assert.doesNotMatch("harnessXconfig.json", globToRegExp("harness.config.json"));
  });

  await t.test("a star inside a segment", () => {
    assert.match("scripts/verify-self.mjs", globToRegExp("scripts/verify-*.mjs"));
    assert.doesNotMatch("scripts/changed-areas.mjs", globToRegExp("scripts/verify-*.mjs"));
    assert.doesNotMatch("scripts/agent/verify-x.mjs", globToRegExp("scripts/verify-*.mjs"));
  });
});

test("reverseClosure", async (t) => {
  await t.test("core reaches every package", () => {
    const out = reverseClosure(["core"], GRAPH);
    for (const pkg of ["docs", "sheets", "slides", "board", "frontend", "backend", "cli"]) {
      assert.ok(out.includes(pkg), `expected ${pkg} in core's closure`);
    }
  });

  await t.test("notes reaches only itself and the frontend", () => {
    assert.deepEqual(reverseClosure(["notes"], GRAPH), ["frontend", "notes"]);
  });

  await t.test("a transitive edge is followed", () => {
    // docs -> slides -> board, none of which is a direct dependent of docs.
    assert.ok(reverseClosure(["docs"], GRAPH).includes("board"));
  });

  await t.test("a leaf package reaches only itself", () => {
    assert.deepEqual(reverseClosure(["documentation"], GRAPH), ["documentation"]);
  });

  await t.test("a cycle terminates", () => {
    const cyclic = { a: ["b"], b: ["a"] };
    assert.deepEqual(reverseClosure(["a"], cyclic), ["a", "b"]);
  });

  await t.test("no changed packages means no closure", () => {
    assert.deepEqual(reverseClosure([], GRAPH), []);
  });
});

test("classify", async (t) => {
  await t.test("an inert-only change runs neither heavy job", () => {
    const out = classify(["scripts/agent/checks.mjs"], CI, GRAPH);
    assert.equal(out.full, false);
    assert.equal(out.heavy, false);
    assert.deepEqual(out.tags, ["agent"]);
    assert.deepEqual(out.packages, []);
  });

  await t.test("two inert areas union their tags", () => {
    const out = classify(
      ["scripts/agent/checks.mjs", "docs/design/README.md", ".claude/settings.json"],
      CI,
      GRAPH,
    );
    assert.equal(out.full, false);
    assert.deepEqual(out.tags, ["agent", "docsProse"]);
  });

  await t.test("a package change narrows lanes but still runs the heavy jobs", () => {
    const out = classify(["packages/notes/src/index.ts"], CI, GRAPH);
    assert.equal(out.full, false, "lane selection stays on");
    assert.equal(out.heavy, true, "but browser + integration still run");
    assert.deepEqual(out.packages, ["frontend", "notes"]);
  });

  await t.test("a core change closes over every package", () => {
    const out = classify(["packages/core/src/geometry/index.ts"], CI, GRAPH);
    assert.equal(out.heavy, true);
    assert.ok(out.packages.includes("backend"));
    assert.ok(out.packages.includes("frontend"));
  });

  await t.test("an unmapped path forces a full run and names the file", () => {
    const out = classify(["Dockerfile.playwright"], CI, GRAPH);
    assert.equal(out.full, true);
    assert.equal(out.heavy, true);
    assert.match(out.reasons.join(" "), /Dockerfile\.playwright/);
  });

  await t.test("one unmapped path among inert ones still forces a full run", () => {
    const out = classify(
      ["scripts/agent/checks.mjs", "docker-compose.yaml"],
      CI,
      GRAPH,
    );
    assert.equal(out.full, true);
  });

  await t.test("a CI gating file forces a full run and flags itself", () => {
    const out = classify(["harness.config.json"], CI, GRAPH);
    assert.equal(out.full, true);
    assert.equal(out.ciConfig, true);
  });

  await t.test("ciConfig wins even when everything else is inert", () => {
    // The anti-self-grading rule: a PR that edits the mapping cannot use the
    // mapping to shrink its own run.
    const out = classify(
      ["scripts/agent/checks.mjs", ".github/workflows/ci.yml"],
      CI,
      GRAPH,
    );
    assert.equal(out.full, true);
    assert.equal(out.ciConfig, true);
  });

  await t.test("a package directory with no manifest is unmapped, not a leaf", () => {
    // packages/design-sdk/ was untracked work-in-progress when this was
    // written: it matches `packages/**` but is in no graph, so it must force a
    // full run rather than quietly resolving to an empty closure.
    const out = classify(["packages/design-sdk/src/index.ts"], CI, GRAPH);
    assert.equal(out.full, true);
  });

  await t.test("an empty diff is a full run, not an empty one", () => {
    const out = classify([], CI, GRAPH);
    assert.equal(out.full, true);
    assert.match(out.reasons.join(" "), /empty diff/);
  });
});

test("resolve fail-safes", async (t) => {
  await t.test("push to main is never filtered", () => {
    const out = resolve(
      { GITHUB_EVENT_NAME: "push", GITHUB_REF_NAME: "main" },
      REPO_ROOT,
    );
    assert.equal(out.full, true);
    assert.match(out.reasons.join(" "), /deploy gate/);
  });

  await t.test("an unresolvable base is a full run", () => {
    const out = resolve(
      { WAFFLEBASE_CI_BASE: "refs/heads/definitely-not-a-real-ref" },
      REPO_ROOT,
    );
    assert.equal(out.full, true);
    assert.match(out.reasons.join(" "), /no diff base/);
  });

  await t.test("a pull_request with no readable payload is a full run", () => {
    const out = resolve(
      { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: "/nope/absent.json" },
      REPO_ROOT,
    );
    assert.equal(out.full, true);
  });

  await t.test("an unknown event is a full run", () => {
    const out = resolve({ GITHUB_EVENT_NAME: "schedule" }, REPO_ROOT);
    assert.equal(out.full, true);
  });

  await t.test("a precomputed resolution is passed through", () => {
    const areas = {
      full: false,
      heavy: false,
      packages: [],
      tags: ["agent"],
      ciConfig: false,
      reasons: ["precomputed"],
    };
    const out = resolve({ WAFFLEBASE_CHANGED_AREAS: JSON.stringify(areas) }, REPO_ROOT);
    assert.deepEqual(out, areas);
  });

  await t.test("a corrupt precomputed resolution is a full run", () => {
    const out = resolve({ WAFFLEBASE_CHANGED_AREAS: "{not json" }, REPO_ROOT);
    assert.equal(out.full, true);
  });
});

test("laneSelected", async (t) => {
  const resolved = { full: false, packages: ["notes", "frontend"], tags: ["agent"] };

  await t.test("matches on package", () => {
    assert.equal(laneSelected({ name: "notes:check", pkg: "notes" }, resolved), true);
    assert.equal(laneSelected({ name: "sheets:check", pkg: "sheets" }, resolved), false);
  });

  await t.test("matches on tag", () => {
    assert.equal(laneSelected({ name: "agent:tests", tags: ["agent"] }, resolved), true);
    assert.equal(laneSelected({ name: "entropy", tags: ["docsProse"] }, resolved), false);
  });

  await t.test("an untagged lane is not selected", () => {
    assert.equal(laneSelected({ name: "loose" }, resolved), false);
  });

  await t.test("full selects everything, including untagged lanes", () => {
    const full = { full: true, packages: [], tags: [] };
    assert.equal(laneSelected({ name: "loose" }, full), true);
  });
});

test("the real repository config", async (t) => {
  const ci = readCiConfig(REPO_ROOT);
  const graph = readWorkspaceGraph(REPO_ROOT);

  await t.test("the workspace graph is read from the manifests", () => {
    assert.ok(Object.hasOwn(graph, "frontend"));
    assert.ok(graph.frontend.includes("core"));
    assert.ok(graph.docs.includes("core"));
    assert.deepEqual(graph.core, [], "core depends on no workspace package");
  });

  await t.test("a brand-new top-level directory forces a full run", () => {
    // The fail-safe that matters most, because it is the one nobody will
    // remember to re-check: adding a directory must not silently inherit a
    // reduced run.
    const out = classify(["some-new-thing/index.ts"], ci, graph);
    assert.equal(out.full, true);
  });

  await t.test("a brand-new package forces a full run", () => {
    const out = classify(["packages/brand-new/src/index.ts"], ci, graph);
    assert.equal(out.full, true);
  });

  await t.test("no inert glob reaches a source package", () => {
    // If an inert entry ever matched, say, packages/frontend/**, every frontend
    // PR would skip the browser job. Assert the blast radius directly.
    for (const pkg of Object.keys(graph)) {
      if (pkg === "documentation") continue;
      const out = classify([`packages/${pkg}/src/index.ts`], ci, graph);
      assert.equal(out.heavy, true, `packages/${pkg} must run the heavy jobs`);
    }
  });

  await t.test("the documentation package is inert and builds its own lane", () => {
    const out = classify(["packages/documentation/index.md"], ci, graph);
    assert.equal(out.full, false);
    assert.equal(out.heavy, false);
    assert.deepEqual(out.tags, ["documentation"]);
  });

  await t.test("an agent-only change runs no heavy job", () => {
    const out = classify(
      ["scripts/agent/review-panel.mjs", "scripts/agent/checks.test.mjs"],
      ci,
      graph,
    );
    assert.equal(out.full, false);
    assert.equal(out.heavy, false);
    assert.deepEqual(out.tags, ["agent"]);
  });

  await t.test("every ciConfig glob matches a file that exists", () => {
    // A glob with a typo silently protects nothing. This does not enumerate the
    // tree; it checks the fixed paths and asserts the patterned ones match at
    // least one known real file.
    const known = [
      "harness.config.json",
      "scripts/verify-self.mjs",
      "scripts/changed-areas.mjs",
      ".github/workflows/ci.yml",
      ".github/CODEOWNERS",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "knip.json",
    ];
    for (const glob of ci.ciConfig) {
      const hit = known.some((f) => globToRegExp(glob).test(f));
      assert.ok(hit, `ciConfig glob \`${glob}\` matches none of the known files`);
    }
  });
});
