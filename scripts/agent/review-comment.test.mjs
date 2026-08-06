import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bucketOf, loc, renderReviewComment, collectLenses } from "./review-comment.mjs";
import { renderSummaryMd } from "./severity.mjs";

const CLI = fileURLToPath(new URL("./review-comment.mjs", import.meta.url));
const F = (severity, file, summary, extra = {}) => ({ severity, file, summary, ...extra });
const lens = (id, title, findings, over = {}) => ({
  id, title, gating: true, applicable: true,
  conclusion: findings.some((f) => ["critical", "major"].includes(f.severity) && f.lane !== "backlog") ? "failure" : "success",
  findings, summary: "", unverified: null, ...over,
});

test("bucketOf: severity + lane → bucket", () => {
  assert.equal(bucketOf(F("critical", "a", "x")), "blocking");
  assert.equal(bucketOf(F("major", "a", "x")), "blocking");
  assert.equal(bucketOf(F("major", "a", "x", { lane: "backlog" })), "relocated");
  assert.equal(bucketOf(F("minor", "a", "x")), "suggestion");
  assert.equal(bucketOf(F("nit", "a", "x")), "nit");
  assert.equal(bucketOf(F("weird", "a", "x")), "blocking"); // unknown → major (fail-safe)
  assert.equal(bucketOf(null), "other");
});

test("loc: real blob link with line, code span without blobBase, nothing without file", () => {
  const base = "https://github.com/o/r/blob/deadbeef";
  assert.equal(loc(F("major", "src/a.ts", "x", { line: 42 }), base), "[`src/a.ts:42`](https://github.com/o/r/blob/deadbeef/src/a.ts#L42)");
  assert.equal(loc(F("major", "src/a.ts", "x"), base), "[`src/a.ts`](https://github.com/o/r/blob/deadbeef/src/a.ts)");
  assert.equal(loc(F("major", "src/a.ts", "x", { line: 42 }), ""), "`src/a.ts:42`");
  assert.equal(loc(F("major", "", "x"), base), "");
});

test("headline counts + verdict, blocking expanded and first", () => {
  const out = renderReviewComment([
    lens("correctness", "Correctness", [F("critical", "a.ts", "boom", { line: 5 }), F("minor", "a.ts", "small")]),
    lens("security", "Security", [F("major", "b.ts", "leak")]),
    lens("docs", "Docs", []), // zero findings → omitted
  ], { blobBase: "https://github.com/o/r/blob/sha" });
  assert.match(out, /^### 🔴 Review panel: changes suggested/);
  assert.match(out, /\*\*2 blocking · 1 suggestion · 0 nits\*\* across 2 lenses/);
  // blocking section present, critical first, linked, lens-tagged
  assert.match(out, /#### 🚫 Blocking \(2\)/);
  const blkIdx = out.indexOf("#### 🚫 Blocking");
  const detIdx = out.indexOf("<details>");
  assert.ok(blkIdx < detIdx, "blocking section comes before any collapsed block");
  assert.match(out, /\*\*\[`a\.ts:5`\]\(https:\/\/github\.com\/o\/r\/blob\/sha\/a\.ts#L5\)\*\* — boom <sup>Correctness<\/sup>/);
  // Docs (no findings) omitted entirely
  assert.doesNotMatch(out, /Docs/);
});

test("minor/nit collapse per lens with counts; single-severity omits per-row prefix", () => {
  const out = renderReviewComment([
    lens("correctness", "Correctness", [F("minor", "a.ts", "m1"), F("minor", "b.ts", "m2"), F("nit", "c.ts", "n1")]),
  ]);
  // mixed block → counts of both, and per-row severity prefixes
  assert.match(out, /<summary>💡 Correctness — 2 suggestions · 1 nit<\/summary>/);
  assert.match(out, /_\(minor\)_ \*\*`a\.ts`\*\* — m1/);
  assert.match(out, /_\(nit\)_ \*\*`c\.ts`\*\* — n1/);

  const single = renderReviewComment([lens("naming", "Naming & style", [F("nit", "a", "x"), F("nit", "b", "y"), F("nit", "c", "z"), F("nit", "d", "w")])]);
  assert.match(single, /<summary>💡 Naming & style — 4 nits<\/summary>/);
  assert.doesNotMatch(single, /_\(nit\)_/); // single-severity block → no per-row prefix
});

test("unverified: headline flag + one aggregated note, not per lens", () => {
  const out = renderReviewComment([
    lens("correctness", "Correctness", [F("major", "a.ts", "x")], { unverified: { errored: 1, sent: 5 } }),
    lens("design", "Design-fit", [F("major", "b.ts", "y")], { unverified: { errored: 2, sent: 5 } }),
  ]);
  assert.match(out, /· ⚠️ 3 unverified/);
  assert.match(out, /> ⚠️ 3 blocking findings across 2 lenses could not be verified/);
});

test("relocated (lane=backlog) collapses separately with its proof line, not in blocking count", () => {
  const out = renderReviewComment([
    lens("correctness", "Correctness", [
      F("major", "a.ts", "real blocker"),
      F("major", "old.ts", "predates", { lane: "backlog", novelty: { alsoAt: "old.ts:9" } }),
    ]),
  ]);
  assert.match(out, /\*\*1 blocking · 0 suggestions · 0 nits\*\* across 1 lens · 1 relocated/);
  assert.match(out, /<summary>📦 Relocated \/ pre-existing — not this PR's to fix \(1\)<\/summary>/);
  assert.match(out, /this line already exists at `old\.ts:9`/);
});

test("reviewer prose collapses; a zero-finding lens contributes no note", () => {
  const out = renderReviewComment([
    lens("correctness", "Correctness", [F("major", "a.ts", "x")], { summary: "Long rationale about the change." }),
    lens("docs", "Docs", [], { summary: "Not applicable." }),
  ]);
  assert.match(out, /<summary>🗒️ Reviewer notes \(1 lens\)<\/summary>/);
  assert.match(out, /\*\*Correctness\*\* — Long rationale about the change\./);
  assert.doesNotMatch(out, /Not applicable/); // docs omitted (no findings)
});

test("nothing to say → empty string (caller falls back)", () => {
  assert.equal(renderReviewComment([lens("docs", "Docs", [])]), "");
  assert.equal(renderReviewComment([]), "");
});

// ACCEPTANCE: every finding present before is still present after — demonstrate.
test("preservation: every finding's summary survives the reorganisation", () => {
  const findingsA = [
    F("critical", "a.ts", "crit one", { line: 1 }),
    F("major", "b.ts", "major two"),
    F("minor", "c.ts", "minor three"),
    F("nit", "d.ts", "nit four"),
    F("major", "old.ts", "relocated five", { lane: "backlog", novelty: { contentSha: "abcdef123" } }),
  ];
  const findingsB = [F("major", "e.ts", "sec one"), F("minor", "f.ts", "sec two")];
  const out = renderReviewComment([
    lens("correctness", "Correctness", findingsA, { summary: "prose A" }),
    lens("security", "Security", findingsB, { summary: "prose B" }),
  ], { blobBase: "https://github.com/o/r/blob/sha" });

  // Every finding the OLD per-lens renderer showed must still appear in the NEW
  // output — demonstrated by extracting each summary the old renderer emitted and
  // asserting it survived the reorganisation (not merely that counts match).
  const oldBullets = [];
  for (const [findings, prose] of [[findingsA, "prose A"], [findingsB, "prose B"]]) {
    const old = renderSummaryMd("Lens review", findings, prose);
    for (const m of old.match(/^- .+$/gm) || []) {
      // strip the leading "- ", the `file` code span, and any trailing marker
      oldBullets.push(m.replace(/^- (?:`[^`]*` — )?/, "").replace(/ _\(.*$/, "").trim());
    }
  }
  assert.equal(oldBullets.length, findingsA.length + findingsB.length, "old renderer emitted one bullet per finding");
  for (const summary of oldBullets) {
    assert.ok(out.includes(summary), `old finding "${summary}" must still be present after reorganisation`);
  }
});

test("truncation drops WHOLE collapsed blocks with a stated count; blocking stays", () => {
  const many = Array.from({ length: 40 }, (_, i) => F("minor", `f${i}.ts`, `suggestion ${i} ${"x".repeat(50)}`));
  const out = renderReviewComment([
    lens("correctness", "Correctness", [F("critical", "a.ts", "the blocker"), ...many]),
  ], { maxChars: 400 });
  assert.match(out, /#### 🚫 Blocking \(1\)/); // blocking always kept
  assert.match(out, /the blocker/);
  assert.match(out, /hidden for length/); // truncation stated
});

// ---- CLI + collectLenses over a real .agent-review tree --------------------
function fakeReviewDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "review-comment-"));
  const write = (id, verdict) => {
    mkdirSync(path.join(dir, id), { recursive: true });
    writeFileSync(path.join(dir, id, "verdict.json"), JSON.stringify(verdict));
  };
  write("correctness", { findings: [F("critical", "a.ts", "boom", { line: 3 }), F("minor", "a.ts", "small")], summary: "prose", conclusion: "failure" });
  write("docs", { findings: [], summary: "n/a", conclusion: "success" });
  writeFileSync(path.join(dir, "panel.json"), JSON.stringify([
    { id: "correctness", applicable: true, blocking: true, conclusion: "failure" },
    { id: "docs", applicable: true, blocking: true, conclusion: "success" },
  ]));
  const manifest = [
    { id: "correctness", title: "Correctness", gating: "blocking" },
    { id: "docs", title: "Docs", gating: "blocking" },
  ];
  writeFileSync(path.join(dir, "lenses.json"), JSON.stringify(manifest));
  return { dir, manifest };
}

test("collectLenses merges verdict.json + panel.json in manifest order", () => {
  const { dir, manifest } = fakeReviewDir();
  const got = collectLenses(dir, manifest);
  assert.equal(got.length, 2);
  assert.equal(got[0].id, "correctness");
  assert.equal(got[0].findings.length, 2);
  assert.equal(got[0].conclusion, "failure");
  // missing dir → fail-safe empty
  assert.deepEqual(collectLenses(path.join(dir, "nope"), manifest)[0].findings, []);
});

test("CLI writes the rendered region to --out and echoes it", () => {
  const { dir } = fakeReviewDir();
  const outFile = path.join(dir, "region.md");
  const stdout = execFileSync("node", [CLI, "--review-dir", dir, "--lenses", path.join(dir, "lenses.json"), "--blob-base", "https://github.com/o/r/blob/sha", "--out", outFile], { encoding: "utf8" });
  const written = readFileSync(outFile, "utf8");
  assert.match(written, /### 🔴 Review panel: changes suggested/);
  assert.match(written, /🚫 Blocking \(1\)/);
  assert.match(written, /\[`a\.ts:3`\]/); // linked
  assert.doesNotMatch(written, /Docs/); // zero-finding lens omitted
  assert.equal(stdout.trim(), written.trim());
});
