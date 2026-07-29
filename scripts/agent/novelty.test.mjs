import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ORIGINS,
  DEMOTING_ORIGINS,
  originFrom,
  findingLocation,
  isProbeableLine,
  noveltyOf,
} from "./novelty.mjs";

// --- originFrom: the decision table ------------------------------------------

test("originFrom: no location, or plain blame could not answer → unknown", () => {
  assert.equal(originFrom({ hasLocation: false }), "unknown");
  assert.equal(originFrom({ hasLocation: true, changeAddedLine: null }), "unknown");
  assert.equal(originFrom({}), "unknown"); // defaults are the safe ones
  assert.equal(originFrom(), "unknown");
});

test("originFrom: a line the change did NOT add is pre-existing, whatever its content", () => {
  // The property that keeps out-of-diff findings on the gate. Content evidence
  // is irrelevant here and must not be consulted.
  for (const content of [true, false, null]) {
    assert.equal(
      originFrom({ hasLocation: true, changeAddedLine: false, contentPredatesBase: content, contentFoundInBase: content }),
      "pre-existing",
    );
  }
});

test("originFrom: change added the line + content predates the base → relocated", () => {
  assert.equal(
    originFrom({ hasLocation: true, changeAddedLine: true, contentPredatesBase: true }),
    "relocated",
  );
});

test("originFrom: either content signal suffices; neither is required", () => {
  // Two independent answers to the same question. `blame -C` misses some moves
  // (#578's `structured_output` line), and the text search still answers on a
  // shallow clone — so requiring both, or ranking one above the other, loses
  // real detections. What keeps the text search honest is the strictness of the
  // match (whole-line, distinctive), not a rule about when it may speak.
  for (const [predates, found] of [[true, null], [null, true], [false, true], [true, false]]) {
    assert.equal(
      originFrom({ hasLocation: true, changeAddedLine: true, contentPredatesBase: predates, contentFoundInBase: found }),
      "relocated",
      `predates=${predates} found=${found}`,
    );
  }
});

test("originFrom: change added the line and nothing says the content is older → introduced", () => {
  assert.equal(
    originFrom({ hasLocation: true, changeAddedLine: true, contentPredatesBase: false, contentFoundInBase: false }),
    "introduced",
  );
  assert.equal(
    originFrom({ hasLocation: true, changeAddedLine: true, contentPredatesBase: null, contentFoundInBase: null }),
    "introduced",
  );
});

test("originFrom: only `relocated` ever demotes", () => {
  // The safety property of the whole module, stated as a rule about the OUTPUT
  // rather than about any one input path.
  assert.deepEqual([...DEMOTING_ORIGINS], ["relocated"]);
  for (const o of ORIGINS) {
    if (o !== "relocated") assert.equal(DEMOTING_ORIGINS.has(o), false, `${o} must not demote`);
  }
});

test("originFrom: demotion requires an AFFIRMATIVE probe on BOTH questions", () => {
  // No combination of missing/false/null evidence may produce a demoting origin.
  for (const added of [null, false, undefined]) {
    for (const predates of [null, false, undefined]) {
      for (const found of [null, false, undefined]) {
        const got = originFrom({
          hasLocation: true,
          changeAddedLine: added,
          contentPredatesBase: predates,
          contentFoundInBase: found,
        });
        assert.equal(DEMOTING_ORIGINS.has(got), false, `demoted on added=${added} predates=${predates} found=${found}`);
      }
    }
  }
});

// --- isProbeableLine ---------------------------------------------------------

test("isProbeableLine: rejects short and structural lines", () => {
  for (const bad of ["}", "});", "*/", "  }", "", "   ", "return;", "if (x) {", null, 42]) {
    assert.equal(isProbeableLine(bad), false, `expected false for ${JSON.stringify(bad)}`);
  }
});

test("isProbeableLine: accepts a distinctive line of real code", () => {
  assert.ok(isProbeableLine("const isQuota = /session limit|usage limit|quota/i.test(detail);"));
  assert.ok(isProbeableLine(" * Classify an SDK `result` message. The SDK reports failures as"));
});

test("isProbeableLine: length alone is not distinctiveness", () => {
  assert.equal(isProbeableLine("// ============================================"), false);
});

// --- findingLocation ---------------------------------------------------------

test("findingLocation: prefers the lens's explicit line", () => {
  assert.deepEqual(
    findingLocation({ file: "a/b.mjs", line: 12, evidence: "see c.mjs:99" }),
    { file: "a/b.mjs", line: 12 },
  );
});

test("findingLocation: uses a citation's line only when it names the SAME file", () => {
  assert.deepEqual(
    findingLocation({ file: "a/b.mjs", evidence: "the guard at a/b.mjs:44 is inverted" }),
    { file: "a/b.mjs", line: 44 },
  );
  // `./` and prefix drift still count as the same file.
  assert.deepEqual(
    findingLocation({ file: "a/b.mjs", evidence: "see ./a/b.mjs:44" }),
    { file: "a/b.mjs", line: 44 },
  );
  assert.deepEqual(
    findingLocation({ file: "pkg/a/b.mjs", evidence: "see a/b.mjs:44" }),
    { file: "pkg/a/b.mjs", line: 44 },
  );
});

test("findingLocation: a citation naming a DIFFERENT file yields no line", () => {
  // Evidence routinely cites a second location for contrast. Pairing this
  // finding's file with that file's line number invents a location that exists
  // but means nothing — git would then be asked about whatever sits at that
  // offset, and an arbitrary old line there would demote a new finding.
  assert.deepEqual(
    findingLocation({ file: "a/b.mjs", evidence: "unlike other.mjs:7, this one…" }),
    { file: "a/b.mjs", line: null },
  );
});

test("findingLocation: with no file at all, the citation is taken whole", () => {
  assert.deepEqual(
    findingLocation({ evidence: "broken at x/y.mjs:9" }),
    { file: "x/y.mjs", line: 9 },
  );
});

test("findingLocation: nothing locatable → null", () => {
  for (const bad of [null, undefined, {}, { file: "  " }, { evidence: "no citation here" }, 42]) {
    assert.equal(findingLocation(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// --- noveltyOf: guards (answer without running git) --------------------------

test("noveltyOf: no base sha → unknown (the gate is inert, not wrong)", async () => {
  const r = await noveltyOf({ repo: "/tmp", file: "a.mjs", line: 1, baseSha: null });
  assert.equal(r.origin, "unknown");
});

test("noveltyOf: a malformed base sha is refused rather than guessed at", async () => {
  for (const bad of ["main", "HEAD~1", "zzz", "", 42, "12345"]) {
    const r = await noveltyOf({ repo: "/tmp", file: "a.mjs", line: 1, baseSha: bad });
    assert.equal(r.origin, "unknown", `expected unknown for ${JSON.stringify(bad)}`);
  }
});

test("noveltyOf: no line → unknown, with NO file-level fallback", async () => {
  // Deliberate: demoting because a `file` string is absent from a changed-file
  // list is a string comparison, not a git answer — a `./` prefix or a path the
  // model spelled differently would drop a real blocker off the gate.
  const r = await noveltyOf({
    repo: "/tmp",
    file: "untouched.mjs",
    line: null,
    baseSha: "f26c77692341111111111111111111111111abcd",
  });
  assert.equal(r.origin, "unknown");
});

test("noveltyOf: a broken repo degrades to unknown rather than throwing", async () => {
  for (const repo of ["/nonexistent-path-for-novelty-test", "/tmp"]) {
    const r = await noveltyOf({
      repo,
      file: "a.mjs",
      line: 1,
      baseSha: "f26c77692341111111111111111111111111abcd",
    });
    assert.equal(r.origin, "unknown");
  }
});

test("noveltyOf: the cache is consulted before any git work", async () => {
  const cache = new Map();
  const cached = { origin: "relocated", addedBy: "deadbeef", contentSha: "cafe", alsoAt: "base:x.mjs:1" };
  cache.set("a.mjs:7", cached);
  const r = await noveltyOf({
    repo: "/nonexistent-path-for-novelty-test", // would fail if git ran
    file: "a.mjs",
    line: 7,
    baseSha: "f26c77692341111111111111111111111111abcd",
    cache,
  });
  assert.deepEqual(r, cached);
});

// --- noveltyOf: against a REAL git repository --------------------------------
// The probes are the whole point of this module, and mocking them would only
// re-assert the decision table that is already pinned above. Build an actual
// repo with an actual refactor in it and read the actual answers, so a change
// that renders the gate inert (or demoting) cannot ship green.

/** git with a fixed identity, so the test does not depend on global config. */
function git(dir, ...args) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * A repo whose HEAD commit performs the #578 refactor:
 *   - `moved.mjs` is NEW and contains a function lifted verbatim from `old.mjs`
 *   - it also contains one genuinely new line
 *   - `untouched.mjs` is not modified at all
 */
function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "novelty-test-"));
  git(dir, "init", "-q", "-b", "main");

  const movedFn = [
    "export function classifyResult(result) {",
    "  const isQuota = /session limit|usage limit|quota/i.test(result.detail);",
    "  return { retryable: !isQuota, detail: result.detail };",
    "}",
  ].join("\n");

  writeFileSync(path.join(dir, "old.mjs"), `// original home\n${movedFn}\n`);
  writeFileSync(path.join(dir, "untouched.mjs"), "export const UNTOUCHED_CONSTANT = 'never edited here';\n");
  // A base line that CONTAINS a distinctive fragment. The refactor below adds
  // that fragment as a line of its own — a substring search would call it
  // "already in base"; whole-line comparison must not.
  writeFileSync(
    path.join(dir, "banner.mjs"),
    'export const NOTE = "validateSessionToken(request) is deprecated";\n',
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  const base = git(dir, "rev-parse", "HEAD").trim();

  // The refactor: lift the function verbatim into a new file, add one new line.
  writeFileSync(path.join(dir, "old.mjs"), "// original home\nexport { classifyResult } from './moved.mjs';\n");
  writeFileSync(
    path.join(dir, "moved.mjs"),
    `${movedFn}\n` +
      "export function brandNewHelper(x) { return String(x).padStart(12, '0'); }\n" +
      "validateSessionToken(request) is deprecated\n", // substring of banner.mjs's line
  );
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "extract classifyResult into moved.mjs");

  return { dir, base };
}

test("noveltyOf [real git]: verbatim-moved code is `relocated` and demotes", async () => {
  const { dir, base } = makeRepo();
  try {
    // line 2 of moved.mjs is the quota regex, moved verbatim from old.mjs.
    const r = await noveltyOf({ repo: dir, file: "moved.mjs", line: 2, baseSha: base });
    assert.equal(r.origin, "relocated");
    assert.ok(DEMOTING_ORIGINS.has(r.origin));
    // …and it reports WHERE the code already lived, so the demotion is auditable.
    assert.match(String(r.alsoAt), /old\.mjs:\d+$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("noveltyOf [real git]: genuinely new code in the same new file is `introduced`", async () => {
  const { dir, base } = makeRepo();
  try {
    const r = await noveltyOf({ repo: dir, file: "moved.mjs", line: 5, baseSha: base });
    assert.equal(r.origin, "introduced");
    assert.equal(DEMOTING_ORIGINS.has(r.origin), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("noveltyOf [real git]: an untouched line is `pre-existing` and does NOT demote", async () => {
  // THE regression test for the blast-radius class. That lens is told to cite
  // the bypassing site, "not the diff line that introduced the guard" — so its
  // findings land on code the change never touched. Demoting them would take the
  // whole lens off the merge gate.
  const { dir, base } = makeRepo();
  try {
    const r = await noveltyOf({ repo: dir, file: "untouched.mjs", line: 1, baseSha: base });
    assert.equal(r.origin, "pre-existing");
    assert.equal(DEMOTING_ORIGINS.has(r.origin), false, "an out-of-diff finding must keep gating");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("noveltyOf [real git]: a line the change did not add stays pre-existing in a MODIFIED file", async () => {
  // old.mjs was edited by the change, but line 1 was not — file-level scoping
  // would call this "touched"; line-level provenance must not.
  const { dir, base } = makeRepo();
  try {
    const r = await noveltyOf({ repo: dir, file: "old.mjs", line: 1, baseSha: base });
    assert.equal(r.origin, "pre-existing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("noveltyOf [real git]: a line out of range degrades to unknown", async () => {
  const { dir, base } = makeRepo();
  try {
    const r = await noveltyOf({ repo: dir, file: "moved.mjs", line: 9999, baseSha: base });
    assert.equal(r.origin, "unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("noveltyOf [real git]: a line that is only a SUBSTRING of a base line stays gating", () => {
  // `git grep -F` is a substring search over the whole base tree, so grepping
  // `validateSessionToken(request) is deprecated` also hits the longer line that
  // merely contains it. If a substring hit counted, any new line whose text
  // happens to occur inside an existing one would drop off the merge gate — a
  // false-demotion source, and one an author could aim at on purpose. Every hit
  // is re-checked for whole-line equality, so this must NOT demote.
  return (async () => {
    const { dir, base } = makeRepo();
    try {
      const r = await noveltyOf({ repo: dir, file: "moved.mjs", line: 6, baseSha: base });
      assert.equal(r.origin, "introduced");
      assert.equal(DEMOTING_ORIGINS.has(r.origin), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});
