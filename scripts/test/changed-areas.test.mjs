// The fail-safe is the whole point of this module, so most of what follows
// asserts that unrelated failures all land on "run everything" rather than on a
// plausible-looking small answer. Each `full: true` route gets its own test,
// because they are reached by genuinely different code paths and a shared
// assertion would hide one of them regressing.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  changedPaths,
  classify,
  globToRegExp,
  isResolution,
  laneSelected,
  resolveRefs,
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

  await t.test("isResolution accepts only a usable resolution", () => {
    assert.equal(isResolution({ full: true, packages: [], tags: [] }), true);
    assert.equal(isResolution({ full: false, packages: ["a"], tags: ["b"] }), true);
    for (const bad of [
      null,
      undefined,
      [],
      7,
      "full",
      {},
      { full: true, packages: [] },
      { full: true, tags: [] },
      { full: "true", packages: [], tags: [] },
      { full: true, packages: {}, tags: [] },
    ]) {
      assert.equal(isResolution(bad), false, `${JSON.stringify(bad)} is not a resolution`);
    }
  });

  await t.test("valid JSON of the wrong shape is a full run", () => {
    // Parsing is not validating. Each of these parses cleanly, and each would
    // reach `selectLaneNames`: `{"full":false}` gives `packages: undefined`,
    // which `laneSelected` dereferences, and the last one selects ZERO lanes and
    // reports a green run that tested nothing.
    for (const payload of [
      "null",
      "[]",
      "7",
      '"full"',
      "{}",
      '{"full":false}',
      '{"full":false,"packages":[]}',
      '{"full":"yes","packages":[],"tags":[]}',
    ]) {
      const out = resolve({ WAFFLEBASE_CHANGED_AREAS: payload }, REPO_ROOT);
      assert.equal(out.full, true, `${payload} must force a full run`);
      assert.ok(Array.isArray(out.packages), `${payload} must yield a usable shape`);
      assert.ok(Array.isArray(out.tags), `${payload} must yield a usable shape`);
    }
  });

  await t.test("a well-formed hand-off is still passed through untouched", () => {
    const areas = {
      full: false,
      heavy: true,
      packages: ["notes"],
      tags: [],
      ciConfig: false,
      reasons: ["ok"],
    };
    assert.deepEqual(
      resolve({ WAFFLEBASE_CHANGED_AREAS: JSON.stringify(areas) }, REPO_ROOT),
      areas,
    );
  });

  await t.test("changedPaths returns null when the base is not a commit", () => {
    // The "failed git diff" route. It is what makes a shallow clone safe — CI's
    // `verify-self` job checks out at depth 1, so if the hand-off is ever missing
    // this is the fail-safe that runs everything instead of diffing nothing.
    assert.equal(changedPaths({ base: "0".repeat(40) }, REPO_ROOT), null);
    assert.equal(changedPaths({ base: "not-a-ref-at-all" }, REPO_ROOT), null);
    assert.equal(changedPaths({ base: null }, REPO_ROOT), null);
    assert.equal(changedPaths(null, REPO_ROOT), null);
    assert.equal(changedPaths(undefined, REPO_ROOT), null);
  });

  await t.test("changedPaths attributes only the head's own commits", () => {
    // THE #805 REGRESSION, as a real git scenario rather than a description.
    //
    // #805 changed five inert files and ran the entire suite anyway, because the
    // diff was taken against the pull request's MERGE COMMIT. A merge commit
    // already contains the base, so the three-dot merge base collapsed to the
    // base itself and the base branch's own recent history — including
    // `.github/workflows/ci.yml` and `harness.config.json`, both `ciConfig` —
    // was attributed to the pull request.
    //
    // Built here from scratch so it does not depend on this repository's history:
    // a base branch that moves on independently, a feature branch that does not,
    // and a merge of the two.
    const tmp = mkdtempSync(path.join(tmpdir(), "wb-refs-"));
    const git = (...args) =>
      execFileSync("git", args, { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "T");
      writeFileSync(path.join(tmp, "seed.txt"), "seed\n");
      git("add", "-A");
      git("commit", "-qm", "seed");

      // The feature branch: one inert-looking file.
      git("checkout", "-q", "-b", "feature");
      writeFileSync(path.join(tmp, "feature.txt"), "mine\n");
      git("add", "-A");
      git("commit", "-qm", "feature change");
      const head = git("rev-parse", "HEAD");

      // Meanwhile the base branch gains an unrelated, expensive-looking file.
      git("checkout", "-q", "main");
      writeFileSync(path.join(tmp, "ci-config.yml"), "someone else\n");
      git("add", "-A");
      git("commit", "-qm", "unrelated base change");
      const base = git("rev-parse", "HEAD");

      // Three-dot against the head's own commit: the base branch's independent
      // commit is NOT attributed to the pull request.
      assert.deepEqual(
        changedPaths({ base, head }, tmp),
        ["feature.txt"],
        "the pull request's own commit is the whole change",
      );

      // Two-dot is the other way to get this wrong, and it is reachable by a
      // one-character edit: it compares the trees, so the base's own file reads
      // as a deletion-shaped change belonging to this pull request.
      const twoDot = execFileSync("git", ["diff", "--name-only", `${base}..${head}`], {
        cwd: tmp,
        encoding: "utf8",
      })
        .split("\n")
        .filter(Boolean);
      assert.ok(
        twoDot.includes("ci-config.yml"),
        "sanity: two-dot drags in the base's own file, which is why three-dot is used",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("'Update branch' re-resolves to the pull request's own files", () => {
    // GitHub's "Update branch" button merges the base INTO the head branch, so
    // `head.sha` becomes a merge commit — and it fires `synchronize`, which
    // re-runs CI and lets the reporter re-decide the `ci-config-changed` label.
    //
    // Worth pinning because the arithmetic looks like the bug this file exists
    // for: `merge-base(base, head)` IS `base` here, so three-dot collapses to
    // two-dot exactly as it did for #805. The difference is what the merge commit
    // is. #805 diffed the throwaway `refs/pull/N/merge` — a commit that was never
    // on the branch — against a STALE `base.sha`, so the collapse attributed
    // other people's commits to the pull request. After "Update branch" the merge
    // is genuinely the head branch's own tip, so the collapsed answer is the right
    // one: everything head has that base does not is precisely this PR's change.
    const tmp = mkdtempSync(path.join(tmpdir(), "wb-update-branch-"));
    const git = (...args) =>
      execFileSync("git", args, { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "T");
      writeFileSync(path.join(tmp, "seed.txt"), "seed\n");
      git("add", "-A");
      git("commit", "-qm", "seed");

      git("checkout", "-q", "-b", "feature");
      writeFileSync(path.join(tmp, "feature.txt"), "mine\n");
      git("add", "-A");
      git("commit", "-qm", "feature change");

      // The base gains a ciConfig-shaped file this pull request never touched.
      git("checkout", "-q", "main");
      writeFileSync(path.join(tmp, "harness.config.json"), "{}\n");
      git("add", "-A");
      git("commit", "-qm", "unrelated base change");
      const base = git("rev-parse", "HEAD");

      // The button: merge the base into the head branch.
      git("checkout", "-q", "feature");
      git("merge", "-q", "--no-edit", "main");
      const head = git("rev-parse", "HEAD");

      assert.equal(
        git("merge-base", base, head),
        base,
        "sanity: after Update branch the head contains the base, so three-dot collapses",
      );
      assert.deepEqual(
        changedPaths({ base, head }, tmp),
        ["feature.txt"],
        "the merged-in base change must not be attributed to this pull request",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("a rebased branch is not measured against a stale base.sha", async (t2) => {
    // `payload.base.sha` is stamped at create/synchronise and then left alone, so
    // it drifts behind `main`. Harmless while the branch is BEHIND it — the fork
    // point is still the fork point — and wrong the moment the branch goes AHEAD,
    // which is what a rebase, a force-push, or "Update branch" does. Then `head`
    // contains those commits, `merge-base(stale_base, head)` collapses to
    // `stale_base`, and the base branch's own history is charged to this pull
    // request again. That is the pre-merge state of nearly every pull request.
    const tmp = mkdtempSync(path.join(tmpdir(), "wb-stale-base-"));
    const git = (...args) =>
      execFileSync("git", args, { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const resolveWith = (payload) => {
      const file = path.join(tmp, "event.json");
      writeFileSync(file, JSON.stringify(payload));
      return resolveRefs(
        { GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: file },
        tmp,
      );
    };
    try {
      git("init", "-q", "-b", "main");
      git("config", "user.email", "t@example.com");
      git("config", "user.name", "T");
      writeFileSync(path.join(tmp, "seed.txt"), "seed\n");
      git("add", "-A");
      git("commit", "-qm", "seed");
      const staleBase = git("rev-parse", "HEAD");

      git("checkout", "-q", "-b", "feature");
      writeFileSync(path.join(tmp, "feature.txt"), "mine\n");
      git("add", "-A");
      git("commit", "-qm", "feature");

      // `main` moves on, including a ciConfig-shaped file this PR never touched.
      git("checkout", "-q", "main");
      writeFileSync(path.join(tmp, "harness.config.json"), "{}\n");
      git("add", "-A");
      git("commit", "-qm", "someone else edits a gating file");
      const freshBase = git("rev-parse", "HEAD");

      // The rebase: the branch now sits on top of main's new tip.
      git("checkout", "-q", "feature");
      git("rebase", "-q", "main");
      const head = git("rev-parse", "HEAD");
      const payload = {
        pull_request: { base: { sha: staleBase, ref: "main" }, head: { sha: head } },
      };

      await t2.test("via the merge ref's first parent", () => {
        // What CI sees: HEAD at a real two-parent `refs/pull/N/merge`.
        git("checkout", "-q", "-B", "merge-ref", "main");
        git("merge", "-q", "--no-ff", "--no-edit", "feature");
        const refs = resolveWith(payload);
        assert.equal(refs.base, freshBase, "the merge ref's first parent is the base tip");
        assert.deepEqual(changedPaths(refs, tmp), ["feature.txt"]);
      });

      await t2.test("via the base branch ref when the merge ref fast-forwarded", () => {
        // A rebased branch is fast-forwardable, and a fast-forwarded ref has no
        // second parent to read — so the base branch ref has to cover this.
        git("checkout", "-q", "feature");
        const refs = resolveWith(payload);
        assert.equal(refs.base, freshBase);
        assert.deepEqual(changedPaths(refs, tmp), ["feature.txt"]);
      });

      await t2.test("falls back to the stale sha, which over-reports safely", () => {
        // Neither fresh source available. The answer is wrong in the direction
        // that runs MORE ci, which is the only acceptable direction to be wrong.
        git("branch", "-m", "main", "main-hidden");
        try {
          const refs = resolveWith(payload);
          assert.equal(refs.base, staleBase);
          assert.ok(
            changedPaths(refs, tmp).includes("harness.config.json"),
            "the fallback must over-report rather than under-report",
          );
        } finally {
          git("branch", "-m", "main-hidden", "main");
        }
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("a pull_request resolves head from the payload, never as HEAD", () => {
    // The #805 fix, pinned at the seam where it went wrong. On a `pull_request`,
    // `actions/checkout` leaves HEAD at the MERGE COMMIT — so taking the head
    // from the checkout instead of from the payload attributes the merge's
    // contents, i.e. other people's commits, to this pull request.
    const dir = mkdtempSync(path.join(tmpdir(), "wb-payload-"));
    const writeEvent = (payload) => {
      const file = path.join(dir, `event-${Object.keys(payload)[0]}.json`);
      writeFileSync(file, JSON.stringify(payload));
      return file;
    };
    const sha = (rev) =>
      execFileSync("git", ["rev-parse", rev], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).trim();

    try {
      // Real commits: both ends come back as 40-hex shas, and neither is the
      // literal string "HEAD".
      const refs = resolveRefs(
        {
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_EVENT_PATH: writeEvent({
            pull_request: { base: { sha: sha("HEAD~1") }, head: { sha: sha("HEAD") } },
          }),
        },
        REPO_ROOT,
      );
      assert.ok(refs, "real shas must resolve");
      assert.notEqual(refs.head, "HEAD", "head must be the payload sha, not the checkout");
      assert.match(refs.base, /^[0-9a-f]{40}$/);
      assert.match(refs.head, /^[0-9a-f]{40}$/);
      assert.equal(refs.base, sha("HEAD~1"));
      assert.equal(refs.head, sha("HEAD"));

      // A payload naming a commit this checkout does not have resolves to null
      // rather than to a plausible-looking partial answer — the diff would fail
      // anyway, and failing here says so once.
      assert.equal(
        resolveRefs(
          {
            GITHUB_EVENT_NAME: "pull_request",
            GITHUB_EVENT_PATH: writeEvent({
              pull_request: { base: { sha: "0".repeat(40) }, head: { sha: sha("HEAD") } },
            }),
          },
          REPO_ROOT,
        ),
        null,
      );

      // A payload with no head at all — the shape that used to fall back to HEAD.
      assert.equal(
        resolveRefs(
          {
            GITHUB_EVENT_NAME: "pull_request",
            GITHUB_EVENT_PATH: writeEvent({
              pull_request: { base: { sha: sha("HEAD~1") } },
            }),
          },
          REPO_ROOT,
        ),
        null,
        "a missing head must fail safe, not silently become the checkout",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("merge_group resolves both ends from the payload", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wb-mg-"));
    const file = path.join(dir, "event.json");
    const sha = (rev) =>
      execFileSync("git", ["rev-parse", rev], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    try {
      writeFileSync(
        file,
        JSON.stringify({ merge_group: { base_sha: sha("HEAD~1"), head_sha: sha("HEAD") } }),
      );
      const refs = resolveRefs(
        { GITHUB_EVENT_NAME: "merge_group", GITHUB_EVENT_PATH: file },
        REPO_ROOT,
      );
      assert.deepEqual(refs, { base: sha("HEAD~1"), head: sha("HEAD") });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("an EMPTY precomputed resolution falls through, not to {}", () => {
    // ci.yml's whole fail-safe rests on this. If the `changes` job crashes it
    // produces no `areas` output, so the env var arrives as an empty string —
    // and `verify-self` runs anyway (`if: !cancelled()`). Parsing "" as an
    // object would yield `{ full: undefined }`, which `selectLaneNames` reads as
    // "not full" and would select ZERO lanes: a green run that tested nothing.
    // It must instead be ignored so resolution continues and fails safe.
    const out = resolve({ WAFFLEBASE_CHANGED_AREAS: "" }, REPO_ROOT);
    assert.equal(out.full, true);
    assert.notEqual(out.reasons?.length, 0, "a full run must say why");
  });
});

test("laneSelected", async (t) => {
  const resolved = { full: false, packages: ["notes", "frontend"], tags: ["agent"] };

  await t.test("matches on package", () => {
    assert.equal(laneSelected({ name: "notes:check", pkgs: ["notes"] }, resolved), true);
    assert.equal(laneSelected({ name: "sheets:check", pkgs: ["sheets"] }, resolved), false);
  });

  await t.test("matches on any one of several packages", () => {
    const dts = { name: "verify:dts", pkgs: ["core", "sheets", "docs", "notes"] };
    assert.equal(laneSelected(dts, resolved), true);
  });

  await t.test("anyPkg matches whenever some package changed", () => {
    const entropy = { name: "verify:entropy", anyPkg: true };
    assert.equal(laneSelected(entropy, resolved), true);
    assert.equal(
      laneSelected(entropy, { full: false, packages: [], tags: ["agent"] }),
      false,
      "anyPkg must not fire when only non-package areas changed",
    );
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

  // Leaf packages nothing imports, each with its own lane. Enumerated rather
  // than derived, so adding one has to be a deliberate edit here: this is the
  // list that decides which packages can skip the browser and integration jobs.
  const INERT_PACKAGES = new Set(["documentation", "design-editor"]);

  await t.test("no inert glob reaches a source package", () => {
    // If an inert entry ever matched, say, packages/frontend/**, every frontend
    // PR would skip the browser job. Assert the blast radius directly.
    for (const pkg of Object.keys(graph)) {
      if (INERT_PACKAGES.has(pkg)) continue;
      const out = classify([`packages/${pkg}/src/index.ts`], ci, graph);
      assert.equal(out.heavy, true, `packages/${pkg} must run the heavy jobs`);
    }
  });

  await t.test("no inert package is imported by anything in the workspace", () => {
    // The condition that makes the entries above safe, checked against the
    // manifests rather than trusted. A dependency edge into one of these — the
    // frontend importing the design editor, say — would make a reduced run a
    // lie, and this is the only place that would notice.
    for (const [pkg, deps] of Object.entries(graph)) {
      for (const dep of deps) {
        assert.ok(
          !INERT_PACKAGES.has(dep),
          `packages/${pkg} depends on packages/${dep}, which is listed inert`,
        );
      }
    }
  });

  await t.test("the documentation package is inert and builds its own lane", () => {
    const out = classify(["packages/documentation/index.md"], ci, graph);
    assert.equal(out.full, false);
    assert.equal(out.heavy, false);
    assert.deepEqual(out.tags, ["documentation"]);
  });

  await t.test("the design-editor package is inert and checks its own lane", () => {
    const out = classify(
      ["packages/design-editor/src/mutate.ts", "packages/design-editor/README.md"],
      ci,
      graph,
    );
    assert.equal(out.full, false);
    assert.equal(out.heavy, false);
    assert.deepEqual(out.tags, ["designEditor"]);
    // No package, so no reverse closure and no heavy job — the lane is reached
    // by the tag alone. That the tag actually reaches it is asserted in
    // scripts/test/verify-self-lanes.test.mjs, which owns the lane graph.
    assert.deepEqual(out.packages, []);
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

  await t.test("every ciConfig path is also owned in CODEOWNERS", () => {
    // The two halves of the same guard: `ci.ciConfig` forces a full suite on a PR
    // touching these files, CODEOWNERS requires a maintainer to look at it. An
    // entry present in the config and missing here is a file that can quietly
    // change every later PR's coverage with nobody required to read the diff —
    // which is exactly how this drifted when the block was first written (only 4
    // of 9 entries were owned).
    const owners = readFileSync(path.join(REPO_ROOT, ".github/CODEOWNERS"), "utf8");
    const owned = owners
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => l.trim().split(/\s+/)[0]);

    for (const glob of ci.ciConfig) {
      // `a/b/**` is owned by the directory rule `/a/b/`; everything else maps to
      // its own path, wildcards included (CODEOWNERS understands `*`).
      const expected = glob.endsWith("/**")
        ? `/${glob.slice(0, -3)}/`
        : `/${glob}`;
      assert.ok(
        owned.includes(expected),
        `ci.ciConfig lists \`${glob}\` but CODEOWNERS has no \`${expected}\` rule`,
      );
    }
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
