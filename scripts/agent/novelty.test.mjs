import { test } from "node:test";
import assert from "node:assert/strict";
import { ORIGINS, originFrom, findingLocation, isProbeableLine, noveltyOf } from "./novelty.mjs";

// --- originFrom: the decision table ------------------------------------------
// Every row of the table in the module docblock, pinned explicitly. These are
// the rules the gate acts on; a silent change here changes what gets demoted.

test("originFrom: no location → unknown (nothing to place)", () => {
  assert.equal(originFrom({ hasLocation: false }), "unknown");
  assert.equal(originFrom({}), "unknown"); // defaults are the safe ones
  assert.equal(originFrom(), "unknown");
});

test("originFrom: both probes failed → unknown (learned nothing)", () => {
  assert.equal(originFrom({ hasLocation: true, probesFailed: true }), "unknown");
  // Even with values present, probesFailed wins — it means they are not trustworthy.
  assert.equal(
    originFrom({ hasLocation: true, probesFailed: true, blameIsAncestorOfBase: true }),
    "unknown",
  );
});

test("originFrom: blame says old + file is old → pre-existing", () => {
  assert.equal(
    originFrom({ hasLocation: true, blameIsAncestorOfBase: true, fileExistedInBase: true }),
    "pre-existing",
  );
});

test("originFrom: blame says old + file is new → relocated (the #578 case)", () => {
  // A function lifted verbatim into a file the PR created. This is the row that
  // the file-scoped `pre-existing` refutation ground could never express.
  assert.equal(
    originFrom({ hasLocation: true, blameIsAncestorOfBase: true, fileExistedInBase: false }),
    "relocated",
  );
});

test("originFrom: blame inconclusive but content already in base → relocated", () => {
  // The content probe is the shallow-clone fallback: it catches a move blame
  // could not follow.
  assert.equal(
    originFrom({ hasLocation: true, blameIsAncestorOfBase: null, contentFoundInBase: true }),
    "relocated",
  );
  assert.equal(
    originFrom({ hasLocation: true, blameIsAncestorOfBase: false, contentFoundInBase: true }),
    "relocated",
  );
});

test("originFrom: nothing says the code is older → introduced", () => {
  assert.equal(
    originFrom({ hasLocation: true, blameIsAncestorOfBase: false, contentFoundInBase: false }),
    "introduced",
  );
  // Blame ran and said "written here" while the content probe was skipped
  // (non-distinctive line). `introduced` is both the accurate and the
  // conservative answer, so the missing probe costs nothing.
  assert.equal(
    originFrom({ hasLocation: true, blameIsAncestorOfBase: false, contentFoundInBase: null }),
    "introduced",
  );
});

test("originFrom: only ever returns a declared origin", () => {
  const rows = [
    {}, { hasLocation: true }, { hasLocation: true, probesFailed: true },
    { hasLocation: true, blameIsAncestorOfBase: true, fileExistedInBase: true },
    { hasLocation: true, blameIsAncestorOfBase: true, fileExistedInBase: false },
    { hasLocation: true, blameIsAncestorOfBase: true, fileExistedInBase: null },
    { hasLocation: true, blameIsAncestorOfBase: false, contentFoundInBase: true },
    { hasLocation: true, blameIsAncestorOfBase: false, contentFoundInBase: false },
  ];
  for (const r of rows) assert.ok(ORIGINS.includes(originFrom(r)), JSON.stringify(r));
});

test("originFrom: demotion requires an AFFIRMATIVE probe result", () => {
  // The safety property of the whole module: no combination of missing or null
  // evidence may produce a demoting origin. Only `true` demotes.
  const demoting = new Set(["pre-existing", "relocated"]);
  for (const blame of [null, false, undefined]) {
    for (const content of [null, false, undefined]) {
      for (const fileIn of [null, true, false, undefined]) {
        const got = originFrom({
          hasLocation: true,
          blameIsAncestorOfBase: blame,
          contentFoundInBase: content,
          fileExistedInBase: fileIn,
        });
        assert.equal(demoting.has(got), false, `demoted on blame=${blame} content=${content}`);
      }
    }
  }
});

// --- isProbeableLine ---------------------------------------------------------
// The guard that stops `}` from demoting every finding it touches.

test("isProbeableLine: rejects short and structural lines", () => {
  for (const bad of ["}", "});", "*/", "  }", "", "   ", "return;", "if (x) {", null, 42]) {
    assert.equal(isProbeableLine(bad), false, `expected false for ${JSON.stringify(bad)}`);
  }
});

test("isProbeableLine: accepts a distinctive line of real code", () => {
  assert.ok(isProbeableLine("const isQuota = /session limit|usage limit|quota/i.test(detail);"));
  assert.ok(isProbeableLine(" * Classify an SDK `result` message. The SDK reports failures as"));
});

test("isProbeableLine: a long line of punctuation is still not probeable", () => {
  // Length alone is not distinctiveness — it must carry identifiers too.
  assert.equal(isProbeableLine("// ============================================"), false);
});

// --- findingLocation ---------------------------------------------------------

test("findingLocation: prefers the lens's explicit line", () => {
  assert.deepEqual(
    findingLocation({ file: "a/b.mjs", line: 12, evidence: "see c.mjs:99" }),
    { file: "a/b.mjs", line: 12 },
  );
});

test("findingLocation: falls back to the first citation in evidence", () => {
  assert.deepEqual(
    findingLocation({ file: "a/b.mjs", evidence: "the guard at a/b.mjs:44 is inverted" }),
    { file: "a/b.mjs", line: 44 },
  );
});

test("findingLocation: the finding's own `file` outranks the citation's path", () => {
  // The citation is prose the model wrote and may name a file it was merely
  // discussing; `file` is the field the gate and the fixer already key on.
  assert.deepEqual(
    findingLocation({ file: "a/b.mjs", evidence: "compare with other.mjs:7" }),
    { file: "a/b.mjs", line: 7 },
  );
});

test("findingLocation: file with no resolvable line → line null (does not demote)", () => {
  assert.deepEqual(findingLocation({ file: "a/b.mjs" }), { file: "a/b.mjs", line: null });
  assert.deepEqual(findingLocation({ file: "a/b.mjs", line: 0 }), { file: "a/b.mjs", line: null });
  assert.deepEqual(findingLocation({ file: "a/b.mjs", line: "12" }), { file: "a/b.mjs", line: null });
});

test("findingLocation: nothing locatable → null", () => {
  for (const bad of [null, undefined, {}, { file: "  " }, { evidence: "no citation here" }, 42]) {
    assert.equal(findingLocation(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// --- noveltyOf: guards -------------------------------------------------------
// These must answer WITHOUT running git, so they are safe to assert anywhere.

test("noveltyOf: no base sha → unknown (the gate is inert, not wrong)", () => {
  const r = noveltyOf({ repo: "/tmp", file: "a.mjs", line: 1, baseSha: null });
  assert.equal(r.origin, "unknown");
  assert.equal(r.blameSha, null);
});

test("noveltyOf: a malformed base sha is refused rather than guessed at", () => {
  for (const bad of ["main", "HEAD~1", "zzz", "", 42, "12345"]) {
    assert.equal(noveltyOf({ repo: "/tmp", file: "a.mjs", line: 1, baseSha: bad }).origin, "unknown");
  }
});

test("noveltyOf: missing repo or file → unknown", () => {
  const base = "f26c77692341111111111111111111111111abcd";
  assert.equal(noveltyOf({ repo: null, file: "a.mjs", line: 1, baseSha: base }).origin, "unknown");
  assert.equal(noveltyOf({ repo: "/tmp", file: "", line: 1, baseSha: base }).origin, "unknown");
  assert.equal(noveltyOf({ repo: "/tmp", file: "   ", line: 1, baseSha: base }).origin, "unknown");
});

test("noveltyOf: no line + authoritative changed-files that omit the file → pre-existing", () => {
  // The file-scoped rule the verifier prompt already makes, kept for findings
  // that carry no line at all.
  const r = noveltyOf({
    repo: "/tmp",
    file: "untouched.mjs",
    line: null,
    baseSha: "f26c77692341111111111111111111111111abcd",
    changedFiles: ["other.mjs"],
    changedFilesAuthoritative: true,
  });
  assert.equal(r.origin, "pre-existing");
});

test("noveltyOf: no line + NON-authoritative changed-files → unknown", () => {
  // A file absent from a TRUNCATED list is not untouched, merely unlisted —
  // the one way this list could fail open.
  const r = noveltyOf({
    repo: "/tmp",
    file: "untouched.mjs",
    line: null,
    baseSha: "f26c77692341111111111111111111111111abcd",
    changedFiles: ["other.mjs"],
    changedFilesAuthoritative: false,
  });
  assert.equal(r.origin, "unknown");
});

test("noveltyOf: no line + the file IS in the changed set → unknown, never demoted", () => {
  const r = noveltyOf({
    repo: "/tmp",
    file: "touched.mjs",
    line: null,
    baseSha: "f26c77692341111111111111111111111111abcd",
    changedFiles: ["touched.mjs"],
    changedFilesAuthoritative: true,
  });
  assert.equal(r.origin, "unknown");
});

test("noveltyOf: a git failure degrades to unknown rather than throwing", () => {
  // Nonexistent repo → every git call fails → both probes fail. The panel must
  // survive this: an unrunnable gate keeps findings blocking.
  const r = noveltyOf({
    repo: "/nonexistent-path-for-novelty-test",
    file: "a.mjs",
    line: 1,
    baseSha: "f26c77692341111111111111111111111111abcd",
  });
  assert.equal(r.origin, "unknown");
});

test("noveltyOf: a repo that is not a git repo → unknown, not a confident answer", () => {
  // The distinction that matters: git's exit code is an ANSWER for some
  // commands (`grep` 1 = no match, `--is-ancestor` 1 = no) and an ERROR for
  // everything else. If the two were collapsed, a broken lookup here would be
  // recorded as "not an ancestor" + "content not in base" → `introduced`, which
  // still blocks (safe) but lies in `unknownOrigin`, the counter whose only job
  // is to reveal that the gate ran blind. /tmp is a real directory and not a
  // repo, so every probe fails with a git error rather than a clean answer.
  const r = noveltyOf({
    repo: "/tmp",
    file: "a.mjs",
    line: 1,
    baseSha: "f26c77692341111111111111111111111111abcd",
  });
  assert.equal(r.origin, "unknown");
});

test("noveltyOf: the cache is consulted before any git work", () => {
  const cache = new Map();
  const cached = { origin: "relocated", blameSha: "deadbeef", alsoAt: "base:x.mjs:1" };
  cache.set("a.mjs:7", cached);
  const r = noveltyOf({
    repo: "/nonexistent-path-for-novelty-test", // would fail if git ran
    file: "a.mjs",
    line: 7,
    baseSha: "f26c77692341111111111111111111111111abcd",
    cache,
  });
  assert.deepEqual(r, cached);
});
