import { test } from "node:test";
import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {
  isValidSlug,
  renderPrBody,
  commitsMissingTrailer,
  parseRepoFromRemoteUrl,
  roundsIn,
  nextRound,
  pickLatestVerdicts,
  roundBoundNotice,
  renderBlockingFindings,
  ambientAuthNotice,
  unsafeBaseReason,
  roundDirsToClear,
  roundsOnDisk,
  priorFindingsFor,
  verdictProduced,
  ownedPathChain,
  reviewArgsError,
  printable,
  panelArgs,
  normalizeRebuttals,
  prepareRoundInputs,
  readRebuttalRecords,
  branchKey,
  MAX_SELF_REVIEW_ROUNDS,
} from "./spec-to-pr.mjs";
import { disclosesAiAuthorship, hasDisclosureTrailer, DISCLOSURE_TRAILER } from "./disclosure.mjs";
import { findingKeyOf } from "./rebuttal.mjs";
import { readFileSync } from "node:fs";

// Written as escapes on purpose: a literal control character in a source file
// is invisible to a reader, which is the same property these tests defend the
// terminal against.
const ESC_CH = "\u001b";
const CR_CH = "\r";
const NUL_CH = "\u0000";

test("isValidSlug: lowercase kebab only", () => {
  assert.ok(isValidSlug("add-csv-import"));
  assert.ok(isValidSlug("charts"));
  assert.ok(isValidSlug("a1-b2-c3"));
  assert.ok(!isValidSlug("Add-CSV")); // uppercase
  assert.ok(!isValidSlug("trailing-")); // trailing dash
  assert.ok(!isValidSlug("-leading"));
  assert.ok(!isValidSlug("double--dash"));
  assert.ok(!isValidSlug("has space"));
  assert.ok(!isValidSlug("path/slash"));
  assert.ok(!isValidSlug(""));
  assert.ok(!isValidSlug(undefined));
});

test("parseRepoFromRemoteUrl: owner/repo from https + ssh forms", () => {
  assert.equal(parseRepoFromRemoteUrl("https://github.com/wafflebase/wafflebase.git"), "wafflebase/wafflebase");
  assert.equal(parseRepoFromRemoteUrl("https://github.com/wafflebase/wafflebase"), "wafflebase/wafflebase");
  assert.equal(parseRepoFromRemoteUrl("git@github.com:harrykim8672/wafflebase.git"), "harrykim8672/wafflebase");
  assert.equal(parseRepoFromRemoteUrl("ssh://git@github.com/owner/repo.git"), "owner/repo");
  assert.equal(parseRepoFromRemoteUrl("https://github.com/owner/repo/"), "owner/repo"); // trailing slash
  assert.equal(parseRepoFromRemoteUrl("git@github.com:owner/dotted.name.git"), "owner/dotted.name"); // dots in name
  // not a github URL → null
  assert.equal(parseRepoFromRemoteUrl("https://gitlab.com/owner/repo.git"), null);
  assert.equal(parseRepoFromRemoteUrl(""), null);
  assert.equal(parseRepoFromRemoteUrl(undefined), null);
});

test("renderPrBody: fills the template and injects Fixes only with an issue", () => {
  const withIssue = renderPrBody({ slug: "charts", title: "Add charts", issue: "42" });
  assert.match(withIssue, /## Summary/);
  assert.match(withIssue, /Add charts/);
  assert.match(withIssue, /Fixes #42/);
  assert.match(withIssue, /## Notes for Reviewers/);
  const noIssue = renderPrBody({ slug: "charts" });
  assert.match(noIssue, /Fixes #\s*$|Fixes #\n/); // bare "Fixes #" placeholder
  assert.doesNotMatch(noIssue, /Fixes #\d/);
  // title defaults from slug
  assert.match(noIssue, /Implement charts/);
});

// The load-bearing invariant: the rendered body MUST satisfy the exact predicate
// mark-ready.mjs enforces. Because both import disclosesAiAuthorship from
// disclosure.mjs, this is a single source of truth — not a copied regex — so it
// cannot drift. Guard it anyway.
test("renderPrBody: output satisfies the ready-gate disclosure predicate", () => {
  assert.ok(disclosesAiAuthorship(renderPrBody({ slug: "x" })));
  assert.ok(disclosesAiAuthorship(renderPrBody({ slug: "y", title: "t", issue: "7" })));
});

test("disclosesAiAuthorship: needs BOTH autonomous AND an AI-tool token", () => {
  assert.ok(disclosesAiAuthorship("Authored autonomously by Claude Code"));
  assert.ok(disclosesAiAuthorship("autonomous run; AI tools assisted"));
  assert.ok(disclosesAiAuthorship("Autonomous, ai-assisted change"));
  assert.ok(!disclosesAiAuthorship("autonomous change")); // no AI token
  assert.ok(!disclosesAiAuthorship("written with Claude")); // not autonomous
  assert.ok(!disclosesAiAuthorship("")); // empty
  assert.ok(!disclosesAiAuthorship(undefined));
});

test("hasDisclosureTrailer / commitsMissingTrailer", () => {
  const good = `Add a thing\n\nBody.\n\n${DISCLOSURE_TRAILER}`;
  const bad = "Add a thing\n\nBody with no trailer.";
  assert.ok(hasDisclosureTrailer(good));
  assert.ok(!hasDisclosureTrailer(bad));
  assert.deepEqual(commitsMissingTrailer([good, good]), []);
  assert.deepEqual(commitsMissingTrailer([good, bad]), [bad]);
  assert.deepEqual(commitsMissingTrailer([]), []);
});

// --- the self-review loop's round bookkeeping --------------------------------

test("roundsIn / nextRound: a round is a directory, junk is ignored", () => {
  assert.deepEqual(roundsIn(["round-1", "round-3", "pr.diff", "round-x", "round-0", ".DS_Store"]), [1, 3]);
  assert.equal(nextRound(["round-1", "round-3"]), 4);
  assert.equal(nextRound([]), 1);
  assert.equal(nextRound(undefined), 1);
  // Ordering on disk is not sorted, and "round-10" must not read as older than
  // "round-9" the way a string compare would have it.
  assert.equal(nextRound(["round-10", "round-9"]), 11);
});

test("nextRound: a round that reviewed nothing does not consume a number", () => {
  // A panel run can end with every lens failing on an HTTP 429 and still leave a
  // directory. Counting it would let a quota outage push a branch toward a bound
  // that is supposed to mean "this is not converging".
  const reviewed = [
    { round: 1, lenses: ["correctness", "docs"] },
    { round: 2, lenses: ["correctness"] },
  ];
  assert.equal(nextRound(reviewed), 3);
  assert.equal(nextRound([...reviewed, { round: 3, lenses: [] }]), 3);
  // Every round an outage: still round 1, and the retry overwrites it.
  assert.equal(nextRound([{ round: 1, lenses: [] }]), 1);
  assert.equal(nextRound([]), 1);
});

test("pickLatestVerdicts: latest round PER LENS, below the current one", () => {
  const available = [
    { round: 1, lenses: ["correctness", "security", "docs"] },
    { round: 2, lenses: ["correctness", "security"] }, // docs crashed this round
  ];
  // docs still carries its round-1 verdict — the false negative this exists to
  // prevent is a lens's findings vanishing because its latest round produced none.
  assert.deepEqual(pickLatestVerdicts(available, 3), { correctness: 2, security: 2, docs: 1 });
  // A round at or above the current one is the future, not the past.
  assert.deepEqual(pickLatestVerdicts(available, 2), { correctness: 1, security: 1, docs: 1 });
  assert.deepEqual(pickLatestVerdicts(available, 1), {});
  assert.deepEqual(pickLatestVerdicts(undefined, 3), {});
  assert.deepEqual(pickLatestVerdicts([{ round: "x", lenses: ["a"] }, { round: 1, lenses: [null, ""] }], 3), {});
});

test("roundBoundNotice: advisory past the bound, silent within it", () => {
  assert.equal(roundBoundNotice(1), "");
  assert.equal(roundBoundNotice(MAX_SELF_REVIEW_ROUNDS), "");
  const notice = roundBoundNotice(MAX_SELF_REVIEW_ROUNDS + 1);
  assert.match(notice, /past the self-review bound/);
  // It must point somewhere: a bound that only says "stop" leaves the developer
  // with a branch and no next step.
  assert.match(notice, /human|@claude review/);
});

test("renderBlockingFindings: cites location, summary and the rebuttal key", () => {
  const out = renderBlockingFindings([
    { lens: "correctness", findings: [{ severity: "critical", file: "a.ts", line: 12, summary: "Off by one" }] },
    { lens: "docs", findings: [{ severity: "major", summary: "Undocumented flag" }] },
  ]);
  assert.match(out, /\[critical\] correctness — a\.ts:12/);
  assert.match(out, /Off by one/);
  // The key is the one a --rebuttals record carries (`rebuttal.mjs`'s
  // lens::file::words), so it is copyable rather than reconstructed by hand.
  assert.match(out, /key: correctness::a\.ts::off-by-one/);
  // No file cited is a real shape (an absence claim); it must still print.
  assert.match(out, /\[major\] docs — \(no file cited\)/);
  assert.equal(renderBlockingFindings([]), "");
  assert.equal(renderBlockingFindings(undefined), "");
  // A junk entry must not crash the report the developer is about to read.
  assert.equal(renderBlockingFindings([null, 42]), "");
});

test("renderBlockingFindings: a blocking lens with nothing to print says so", () => {
  // The "review could not run" record is dropped by the carry-forward, so an
  // infra-failed lens arrives here empty. Printing nothing would read as "failed
  // but found nothing" — the one reading that must not be available.
  const out = renderBlockingFindings([{ lens: "security", findings: [] }]);
  assert.match(out, /no finding recorded \(the lens may not have run\)/);
  assert.match(out, /security\/summary\.md/);
  // A non-empty findings array of pure junk takes the per-finding path, not the
  // "did not run" one: the lens DID produce a verdict, it just cited nothing.
  assert.equal(renderBlockingFindings([{ lens: "x", findings: [null] }]), "");
});

test("ambientAuthNotice: silent with a pooled token, warns without one", () => {
  assert.equal(ambientAuthNotice({ CLAUDE_CODE_OAUTH_TOKEN: "sk-tok" }), "");
  // Whitespace is not a credential.
  assert.notEqual(ambientAuthNotice({ CLAUDE_CODE_OAUTH_TOKEN: "   " }), "");
  assert.notEqual(ambientAuthNotice({}), "");
  assert.notEqual(ambientAuthNotice(undefined), "");
  // It must say that the run is going to COST something: the old behaviour was a
  // silent skip, so a warning that only mentions the missing variable would read
  // as "nothing happened" — the exact confusion this replaced.
  assert.match(ambientAuthNotice({}), /bills the account/);
  // It must name BOTH halves of the contract: a developer reading it has to be
  // able to tell "this is the local mode" from "something is misconfigured".
  assert.match(ambientAuthNotice({}), /intended local mode/);
  assert.match(ambientAuthNotice({}), /CI pins a pooled credential/);
});

// --- refusing an unsafe review directory -------------------------------------

const dirStat = (over = {}) => ({
  isSymbolicLink: () => false,
  isDirectory: () => true,
  uid: 501,
  mode: 0o40700,
  ...over,
});

test("unsafeBaseReason: accepts our own 0700 directory, refuses everything else", () => {
  assert.equal(unsafeBaseReason(dirStat(), 501), "");
  // The pre-creation attack: mkdirSync on a symlink to a directory SUCCEEDS, and
  // every write then lands wherever it points.
  assert.match(unsafeBaseReason(dirStat({ isSymbolicLink: () => true }), 501), /symlink/);
  assert.match(unsafeBaseReason(dirStat({ isDirectory: () => false }), 501), /not a directory/);
  assert.match(unsafeBaseReason(dirStat({ uid: 0 }), 501), /owned by uid 0/);
  // Any group or other bit: the branch diff lives here, and so does the JSON fed
  // into the next round's verifier prompt.
  assert.match(unsafeBaseReason(dirStat({ mode: 0o40755 }), 501), /group\/other accessible/);
  assert.match(unsafeBaseReason(dirStat({ mode: 0o40701 }), 501), /group\/other accessible/);
  // Fails closed.
  assert.match(unsafeBaseReason(null, 501), /could not be inspected/);
  // No getuid (Windows): ownership is unknowable, so it must not refuse on it.
  assert.equal(unsafeBaseReason(dirStat({ uid: 0 }), undefined), "");
});

test("roundDirsToClear: --fresh can only delete this base's round dirs", () => {
  // The base itself is NEVER a deletion target: `--out ~/project --fresh` used to
  // take the project with it, and `--out --fresh` resolves to `./true`.
  assert.deepEqual(roundDirsToClear(["round-1", "round-2", "pr.diff", "src", ".git"]), ["round-1", "round-2"]);
  assert.deepEqual(roundDirsToClear([]), []);
  assert.deepEqual(roundDirsToClear(undefined), []);
  assert.ok(!roundDirsToClear(["round-1", "..", "."]).some((n) => n === "." || n === ".."));
});

// --- the on-disk carry-forward wiring, against a real directory --------------

test("roundsOnDisk + priorFindingsFor: read verdicts back off disk", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-test-"));
  try {
    const write = (round, lens, verdict) => {
      mkdirSync(path.join(base, `round-${round}`, lens), { recursive: true });
      writeFileSync(path.join(base, `round-${round}`, lens, "verdict.json"), JSON.stringify(verdict));
    };
    // `valid` + `conclusion` are what review-panel.mjs actually writes; a fixture
    // without them is not a verdict the producer would ever emit.
    const real = (findings) => ({ valid: true, conclusion: "failure", findings });
    write(1, "correctness", real([{ severity: "critical", file: "a.ts", summary: "one" }]));
    write(1, "docs", real([{ severity: "major", file: "d.ts", summary: "doc gap" }]));
    write(2, "correctness", real([{ severity: "major", file: "b.ts", summary: "two" }]));
    // A lens directory with no verdict.json is not a verdict.
    mkdirSync(path.join(base, "round-2", "security"), { recursive: true });
    // Files in the round directory (the panel writes pr.diff and panel.json there)
    // must not be mistaken for lenses.
    writeFileSync(path.join(base, "round-2", "panel.json"), "[]");

    assert.deepEqual(roundsOnDisk(base), [
      { round: 1, lenses: ["correctness", "docs"] },
      { round: 2, lenses: ["correctness"] },
    ]);

    // Round 3 carries correctness from round 2 (the later one) and docs from
    // round 1 — the per-lens rule, exercised end to end rather than on a fixture.
    const prior = priorFindingsFor(base, 3);
    assert.deepEqual(prior.map((f) => [f.lens, f.file]).sort(), [["correctness", "b.ts"], ["docs", "d.ts"]]);

    // An unparseable verdict does not settle the lens, so it reaches further back
    // rather than silently carrying nothing: correctness falls back to its ROUND-1
    // finding. Losing a round's output must not look like "the issue is resolved".
    writeFileSync(path.join(base, "round-2", "correctness", "verdict.json"), "{ not json");
    assert.deepEqual(
      priorFindingsFor(base, 3).map((f) => [f.lens, f.file]).sort(),
      [["correctness", "a.ts"], ["docs", "d.ts"]],
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// --- "a verdict.json exists" is not "the lens reviewed" ----------------------

test("verdictProduced: a skipped or crashed lens did not settle anything", () => {
  assert.equal(verdictProduced({ valid: true, conclusion: "failure", findings: [] }), true);
  assert.equal(verdictProduced({ valid: true, conclusion: "success", findings: [] }), true);
  // review-panel.mjs writes BOTH of these files; counting them as verdicts made
  // the lens carry nothing and silently drop its earlier real findings.
  assert.equal(verdictProduced({ valid: true, conclusion: "skipped" }), false);
  assert.equal(verdictProduced({ valid: false, conclusion: "failure" }), false);
  assert.equal(verdictProduced(null), false);
  assert.equal(verdictProduced("{}"), false);
});

test("a skipped round lets the lens keep reaching further back", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-skip-"));
  try {
    const write = (round, lens, verdict) => {
      mkdirSync(path.join(base, `round-${round}`, lens), { recursive: true });
      writeFileSync(path.join(base, `round-${round}`, lens, "verdict.json"), JSON.stringify(verdict));
    };
    write(1, "security", { valid: true, conclusion: "failure", findings: [{ severity: "critical", file: "a.ts", summary: "real" }] });
    // Round 2: the lens did not apply to that round's diff. Its round-1 finding is
    // still open and must still be carried.
    write(2, "security", { valid: true, conclusion: "skipped", findings: [] });
    assert.deepEqual(roundsOnDisk(base), [{ round: 1, lenses: ["security"] }, { round: 2, lenses: [] }]);
    assert.deepEqual(priorFindingsFor(base, 3).map((f) => [f.lens, f.file]), [["security", "a.ts"]]);

    // Same for a crashed/quota round (valid: false).
    write(2, "security", { valid: false, conclusion: "failure", findings: [] });
    assert.deepEqual(priorFindingsFor(base, 3).map((f) => [f.lens, f.file]), [["security", "a.ts"]]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// --- argument guards + the owned-path walk ----------------------------------

test("reviewArgsError: a valueless flag is a usage error, not silent data loss", () => {
  assert.equal(reviewArgsError({}), "");
  assert.equal(reviewArgsError({ out: "/tmp/x", round: "2", rebuttals: "r.json" }), "");
  // `parseArgs` yields `true`; `Number(true)` is 1 and `String(true)` is "true".
  assert.match(reviewArgsError({ out: true }), /--out needs a value/);
  assert.match(reviewArgsError({ round: true }), /--round needs a value/);
  assert.match(reviewArgsError({ rebuttals: true }), /--rebuttals needs a file path/);
  assert.match(reviewArgsError({ round: "zero" }), /positive integer/);
  assert.match(reviewArgsError({ round: "0" }), /positive integer/);
  assert.match(reviewArgsError({ round: "-1" }), /positive integer/);
  assert.match(reviewArgsError({ round: "1.5" }), /positive integer/);
  assert.equal(reviewArgsError(undefined), "");
});

test("ownedPathChain: every level we created, leaf first, excluding the boundary", () => {
  assert.deepEqual(ownedPathChain("/tmp/a/b/c", "/tmp"), ["/tmp/a/b/c", "/tmp/a/b", "/tmp/a"]);
  assert.deepEqual(ownedPathChain("/tmp/a", "/tmp"), ["/tmp/a"]);
  // The boundary itself is never ours to judge: refusing because /tmp is
  // world-writable would refuse every run on every machine.
  assert.deepEqual(ownedPathChain("/tmp", "/tmp"), []);
  // A base outside the boundary must terminate, not walk to the root forever.
  assert.deepEqual(ownedPathChain("/var/other", "/tmp"), []);
});

// --- a dry run must not consume a round -------------------------------------
//
// Driven through the CLI on purpose: the bug was in `cmdReview`'s ORDERING (the
// round directory was created before the dry-run return), which no test of a
// pure helper can see. Two probes of this command pushed a real round from 3 to
// 5 and tripped the round bound.

test("review --dry-run repeats the same round and writes nothing", () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "spec-to-pr.mjs");
  const base = path.join(mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-dry-")), "base");
  try {
    const run = () =>
      execFileSync("node", [script, "review", "--dry-run", "--out", base], { encoding: "utf8" });
    const first = run();
    assert.match(first, /round 1 would review/);
    // Same answer every time, and no round directory left behind for `nextRound`
    // to count.
    assert.match(run(), /round 1 would review/);
    assert.match(run(), /round 1 would review/);
    assert.deepEqual(readdirSync(base), []);
  } finally {
    rmSync(path.dirname(base), { recursive: true, force: true });
  }
});

// --- model text is data, never terminal markup -------------------------------

test("printable: control characters cannot move the cursor", () => {
  // A CSI sequence in a finding summary could erase the findings printed above it
  // and forge a clean line on the surface a developer reads to decide.
  assert.equal(printable("before" + ESC_CH + "[2Jafter"), "before [2Jafter");
  assert.equal(printable("a" + CR_CH + "b"), "a b");
  assert.equal(printable("a" + NUL_CH + "b"), "a b");
  assert.equal(printable("  spaced   out  "), "spaced out");
  assert.equal(printable(undefined), "");
  assert.equal(printable(null), "");
  // Capped so one finding cannot scroll the others off the screen.
  const long = printable("x".repeat(600));
  assert.equal(long.length, 501);
  assert.ok(long.endsWith("\u2026"));
  // Ordinary text is untouched.
  assert.equal(printable("scripts/agent/spec-to-pr.mjs"), "scripts/agent/spec-to-pr.mjs");
});

test("renderBlockingFindings strips control characters from model text", () => {
  const out = renderBlockingFindings([
    {
      lens: "sec" + ESC_CH + "[31m",
      findings: [{ severity: "critical", file: "a.ts", line: 3, summary: "hide" + ESC_CH + "[2Jthis" }],
    },
  ]);
  assert.ok(!out.includes(ESC_CH), "no ESC may reach the terminal");
  assert.ok(!out.includes(CR_CH), "no carriage return may reach the terminal");
  // The text still SHOWS, defanged — dropping it would hide a real finding.
  assert.match(out, /hide \[2Jthis/);
});

// --- the panel's argv, asserted rather than eyeballed ------------------------

test("panelArgs: round inputs are passed, and omitted when absent", () => {
  const common = { panel: "p.mjs", diffFile: "d", changedFile: "c", lensesDir: "L", outDir: "o" };
  const first = panelArgs({ ...common, baseSha: null, priorFile: null, rebuttals: null });
  assert.deepEqual(first, ["p.mjs", "--diff-file", "d", "--changed-files", "c", "--lenses-dir", "L", "--out", "o"]);
  // Absent is not the same claim as empty: no --prior-findings means "first
  // round", an empty one means "the previous round found nothing".
  assert.ok(!first.includes("--prior-findings"));
  assert.ok(!first.includes("--rebuttals"));

  const later = panelArgs({ ...common, baseSha: "abc123", priorFile: "pf.json", rebuttals: "r.json" });
  assert.deepEqual(later.slice(later.indexOf("--base-sha")), [
    "--base-sha", "abc123",
    "--prior-findings", "pf.json",
    "--rebuttals", "r.json",
    "--lenses-dir", "L",
    "--out", "o",
  ]);
});

// --- --dry-run is inert, including --fresh -----------------------------------

test("review --dry-run --fresh reports the reset round without deleting one", () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "spec-to-pr.mjs");
  const base = path.join(mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-fresh-")), "base");
  try {
    // 0700, because that is what the command creates and what its base guard
    // requires — a fixture at the default umask is refused, as it should be.
    mkdirSync(path.join(base, "round-1", "docs"), { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(base, "round-1", "docs", "verdict.json"),
      JSON.stringify({
        valid: true,
        conclusion: "failure",
        findings: [{ severity: "major", file: "a.ts", summary: "x" }],
      }),
    );
    const out = execFileSync("node", [script, "review", "--dry-run", "--fresh", "--out", base], { encoding: "utf8" });
    // It reports the round the REAL run would use (1, after the reset) while
    // leaving intact the verdicts a later round would have carried forward.
    assert.match(out, /round 1 would review/);
    assert.deepEqual(readdirSync(base), ["round-1"]);
    assert.ok(readdirSync(path.join(base, "round-1")).includes("docs"));
  } finally {
    rmSync(path.dirname(base), { recursive: true, force: true });
  }
});

test("a 429-shaped round leaves the counter where it was", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-429-"));
  try {
    const write = (round, lens, verdict) => {
      mkdirSync(path.join(base, `round-${round}`, lens), { recursive: true });
      writeFileSync(path.join(base, `round-${round}`, lens, "verdict.json"), JSON.stringify(verdict));
    };
    write(1, "docs", { valid: true, conclusion: "failure", findings: [{ severity: "major", file: "a.ts", summary: "x" }] });
    // What a quota outage writes: every lens invalid, holding only the synthesised
    // "review did not run" record.
    for (const lens of ["docs", "correctness", "security"]) {
      write(2, lens, { valid: false, conclusion: "failure", findings: [] });
    }
    assert.equal(nextRound(roundsOnDisk(base)), 2, "the outage round is retried, not skipped past");
    // And the real round-1 findings are still carried into that retry.
    assert.deepEqual(priorFindingsFor(base, 2).map((f) => [f.lens, f.file]), [["docs", "a.ts"]]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// --- a hand-written rebuttal has to reach the lens it names ------------------

test("normalizeRebuttals: strips the check-run prefix the panel does not", () => {
  // review-panel.mjs partitions with `r.lens === lensId` against the BARE id, and
  // the cloud's records get there through parseRebuttalComment. A hand-written
  // file skips that parser, so copying the check-run name — the thing GitHub
  // actually shows you — would adjudicate nothing, silently.
  assert.deepEqual(
    normalizeRebuttals([{ lens: "agent-review-security", claim: "no" }]),
    [{ lens: "security", claim: "no" }],
  );
  assert.deepEqual(normalizeRebuttals([{ lens: "  agent-review-docs  " }]), [{ lens: "docs" }]);
  // A bare id is already correct and must be left alone.
  assert.deepEqual(normalizeRebuttals([{ lens: "correctness" }]), [{ lens: "correctness" }]);
  // Only the prefix is touched — the rest is the author's claim, read as written.
  const rec = { lens: "agent-review-docs", file: "a.ts", claim: "the flag IS documented", evidence: ["README:3"] };
  assert.deepEqual(normalizeRebuttals([rec])[0], { ...rec, lens: "docs" });
  // Junk cannot become a record.
  assert.deepEqual(normalizeRebuttals([null, 42, ["x"]]), []);
  assert.deepEqual(normalizeRebuttals(undefined), []);
  // A record with no lens passes through: the panel adjudicates it against every
  // lens, which is the pre-existing behaviour and not this function's call.
  assert.deepEqual(normalizeRebuttals([{ claim: "x" }]), [{ claim: "x" }]);
});

// --- the directory guard, end to end ----------------------------------------

test("review refuses a review directory that is not ours", () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "spec-to-pr.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-guard-"));
  const base = path.join(root, "base");
  try {
    // Group/other accessible: the branch diff and the JSON fed to the next
    // round's verifier both live here.
    mkdirSync(base, { recursive: true, mode: 0o755 });
    let failed = false;
    try {
      execFileSync("node", [script, "review", "--dry-run", "--out", base], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      failed = true;
      assert.match(String(e.stderr), /refusing to use the review directory/);
      assert.match(String(e.stderr), /group\/other accessible/);
    }
    assert.ok(failed, "a world-readable review directory must be refused, not used");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("review rejects a --rebuttals file that is missing or unusable", () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "spec-to-pr.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-reb-"));
  const base = path.join(root, "base");
  const run = (file) => {
    try {
      execFileSync("node", [script, "review", "--out", base, "--rebuttals", file], { encoding: "utf8", stdio: "pipe" });
      return "";
    } catch (e) {
      return String(e.stderr);
    }
  };
  try {
    mkdirSync(base, { recursive: true, mode: 0o700 });
    assert.match(run(path.join(root, "nope.json")), /--rebuttals file not found/);
    const bad = path.join(root, "bad.json");
    writeFileSync(bad, "{ not json");
    assert.match(run(bad), /not a readable JSON array/);
    const empty = path.join(root, "empty.json");
    writeFileSync(empty, "[]");
    // Silently adjudicating nothing is the failure mode; an empty argument is a
    // usage error, not a quiet no-op.
    assert.match(run(empty), /holds no usable records/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- the wiring between the carry-forward and the panel ----------------------
//
// Three consecutive rounds raised this gap. Both ends were tested; what was not
// was that the file gets written and that the path written is the path passed.

test("prepareRoundInputs: writes the carried findings and points the panel at them", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-inputs-"));
  try {
    const prior = [{ lens: "docs", severity: "major", file: "a.ts", summary: "x" }];
    const out = prepareRoundInputs({ dir, prior, rebuttalsPath: null });
    assert.equal(out.priorFile, path.join(dir, "prior-findings.json"));
    assert.deepEqual(JSON.parse(readFileSync(out.priorFile, "utf8")), prior);
    assert.equal(out.rebuttals, null);
    assert.equal(out.rebuttalCount, 0);

    // ...and the path it returned is the one panelArgs passes through.
    const argv = panelArgs({
      panel: "p", diffFile: "d", changedFile: "c", baseSha: null,
      priorFile: out.priorFile, rebuttals: out.rebuttals, lensesDir: "L", outDir: dir,
    });
    assert.equal(argv[argv.indexOf("--prior-findings") + 1], out.priorFile);

    // Round 1 carries nothing: no file, and no flag for the panel to read as
    // "the previous round found nothing".
    const first = prepareRoundInputs({ dir, prior: [], rebuttalsPath: null });
    assert.equal(first.priorFile, null);
    assert.ok(!panelArgs({ panel: "p", diffFile: "d", changedFile: "c", priorFile: first.priorFile,
      rebuttals: null, baseSha: null, lensesDir: "L", outDir: dir }).includes("--prior-findings"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareRoundInputs: normalizes rebuttals into the round, or throws", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-inputs2-"));
  try {
    const supplied = path.join(dir, "mine.json");
    writeFileSync(supplied, JSON.stringify([{ lens: "agent-review-security", claim: "no" }]));
    const out = prepareRoundInputs({ dir, prior: [], rebuttalsPath: supplied });
    // The panel reads the NORMALIZED copy, not the hand-written original.
    assert.equal(out.rebuttals, path.join(dir, "rebuttals.json"));
    assert.notEqual(out.rebuttals, supplied);
    assert.deepEqual(JSON.parse(readFileSync(out.rebuttals, "utf8")), [{ lens: "security", claim: "no" }]);
    assert.equal(out.rebuttalCount, 1);

    // Unusable input throws instead of quietly adjudicating nothing.
    assert.throws(() => prepareRoundInputs({ dir, prior: [], rebuttalsPath: path.join(dir, "nope.json") }), /not found/);
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    assert.throws(() => prepareRoundInputs({ dir, prior: [], rebuttalsPath: bad }), /not a readable JSON array/);
    const empty = path.join(dir, "empty.json");
    writeFileSync(empty, "[]");
    assert.throws(() => prepareRoundInputs({ dir, prior: [], rebuttalsPath: empty }), /no usable records/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the printed key has to be the one a rebuttal record carries -------------

test("renderBlockingFindings prints rebuttal.mjs's key, not finding-key.mjs's", () => {
  const finding = { severity: "major", file: "a.ts", summary: "The flag is never documented anywhere" };
  const out = renderBlockingFindings([{ lens: "docs", findings: [finding] }]);
  // The two modules key the same finding differently, and an earlier version
  // printed the wrong one while claiming it was this one.
  assert.match(out, new RegExp(`key: ${findingKeyOf({ ...finding, lens: "docs" })}`));
  assert.match(out, /key: docs::a\.ts::the-flag-is-never-documented/);
  // It carries the lens, which the other key format has no room for.
  assert.ok(findingKeyOf({ ...finding, lens: "docs" }).startsWith("docs::"));
});

test("renderBlockingFindings: the key survives a very long summary", () => {
  // The old key was the whole summary, capped at 300 characters with an ellipsis,
  // so copying it out of a long finding produced a string nothing matches.
  const out = renderBlockingFindings([
    { lens: "security", findings: [{ severity: "critical", file: "a.ts", summary: "word ".repeat(200) }] },
  ]);
  const keyLine = out.split("\n").find((l) => l.includes("key:"));
  assert.ok(!keyLine.includes("\u2026"), "the key must not be truncated");
  assert.match(keyLine, /key: security::a\.ts::word-word-word-word-word-word$/);
});

// --- ancestors answer a different question than the leaf ---------------------

test("unsafeBaseReason: an ancestor must be un-replaceable, not private", () => {
  const anc = (mode, uid = 0) => ({ isSymbolicLink: () => false, isDirectory: () => true, uid, mode });
  // 0755 is every home directory and /Users; refusing it (the leaf rule) refused
  // every ordinary --out path, which is why the ancestor chain went unchecked.
  assert.equal(unsafeBaseReason(anc(0o40755), 501, { leaf: false }), "");
  // Root-owned is SAFER than ours, so ownership is a leaf rule only.
  assert.equal(unsafeBaseReason(anc(0o40755, 0), 501, { leaf: false }), "");
  assert.match(unsafeBaseReason(anc(0o40755, 0), 501, { leaf: true }), /owned by uid 0/);
  // Foreign-writable and not sticky is the TOCTOU: another user can replace our
  // directory between the check and the writes.
  assert.match(unsafeBaseReason(anc(0o40777), 501, { leaf: false }), /writable by another user and not sticky/);
  assert.match(unsafeBaseReason(anc(0o40757), 501, { leaf: false }), /writable by another user/);
  // Sticky makes a world-writable directory safe again — only an owner may
  // replace an entry. /tmp is the case this exists for.
  assert.equal(unsafeBaseReason(anc(0o41777), 501, { leaf: false }), "");
  // A symlinked or non-directory ancestor is still refused.
  assert.match(unsafeBaseReason({ ...anc(0o40755), isSymbolicLink: () => true }, 501, { leaf: false }), /symlink/);
});

test("unsafeBaseReason: a THIRD user's ancestor is refused, sticky or not", () => {
  const anc = (mode, uid) => ({ isSymbolicLink: () => false, isDirectory: () => true, uid, mode });
  // Mode bits on somebody else's directory are theirs to change the instant
  // after we read them, so a tight mode proves nothing about a foreign owner.
  assert.match(unsafeBaseReason(anc(0o40755, 999), 501, { leaf: false }), /neither root nor 501/);
  assert.match(unsafeBaseReason(anc(0o40700, 999), 501, { leaf: false }), /neither root nor 501/);
  // And sticky is NOT an exemption here: the bit restrains everyone except the
  // directory's own owner, who is exactly the attacker in this case.
  assert.match(unsafeBaseReason(anc(0o41777, 999), 501, { leaf: false }), /neither root nor 501/);
  // Root and ourselves remain the two owners that cannot be that attacker.
  assert.equal(unsafeBaseReason(anc(0o41777, 0), 501, { leaf: false }), "");
  assert.equal(unsafeBaseReason(anc(0o40755, 501), 501, { leaf: false }), "");
  // No getuid (Windows) → skip rather than refuse every run.
  assert.equal(unsafeBaseReason(anc(0o40755, 999), undefined, { leaf: false }), "");
});

// --- a detached HEAD is not a branch name ------------------------------------

test("branchKey: a detached HEAD never keys the round store as `HEAD`", () => {
  assert.equal(branchKey("feat/x", { sha: "abc", env: {} }), "feat/x");
  // Every detached checkout on the machine reports the literal "HEAD": sharing
  // one key would share one round counter AND one carry-forward store, feeding
  // another change's verdicts into this round's verifier prompt.
  assert.equal(
    branchKey("HEAD", { sha: "0123456789abcdef0123", env: {} }),
    "detached-0123456789ab",
  );
  // CI is a documented mode and knows the ref it checked out, so prefer it.
  assert.equal(branchKey("HEAD", { sha: "abc", env: { GITHUB_HEAD_REF: "feat/y" } }), "feat/y");
  assert.equal(branchKey("HEAD", { sha: "abc", env: { GITHUB_REF_NAME: "feat/z" } }), "feat/z");
  assert.equal(
    branchKey("HEAD", { sha: "abc", env: { GITHUB_HEAD_REF: "", GITHUB_REF_NAME: "HEAD" } }),
    "detached-abc",
  );
  // Two detached commits are two reviews, so they must not collide.
  assert.notEqual(branchKey("HEAD", { sha: "aaaa" }), branchKey("HEAD", { sha: "bbbb" }));
  assert.equal(branchKey("HEAD", {}), "detached-unknown");
  assert.equal(branchKey("", { sha: "abc" }), "detached-abc");
});

// --- the bound is enforced, with one explicit override -----------------------

test("review --fresh cannot walk past the bound by renumbering to round 1", () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "spec-to-pr.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-freshbound-"));
  const base = path.join(root, "base");
  try {
    // 0700, because the leaf guard refuses anything looser — see `unsafeBaseReason`.
    mkdirSync(base, { recursive: true, mode: 0o700 });
    chmodSync(base, 0o700);
    // Exactly the state the bound exists for: MAX rounds that really reviewed.
    for (let r = 1; r <= MAX_SELF_REVIEW_ROUNDS; r++) {
      const lens = path.join(base, `round-${r}`, "security");
      mkdirSync(lens, { recursive: true });
      writeFileSync(path.join(lens, "verdict.json"), JSON.stringify({ valid: true, conclusion: "failure", findings: [] }));
    }
    const run = (extra) => {
      try {
        return { out: execFileSync("node", [script, "review", "--dry-run", "--out", base, ...extra],
          { encoding: "utf8", stdio: "pipe" }), stderr: "", ok: true };
      } catch (e) {
        return { out: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), ok: false };
      }
    };
    // Without --fresh the refusal is the documented one.
    const plain = run([]);
    assert.equal(plain.ok, false);
    assert.match(plain.stderr, /past the self-review bound/);
    // WITH --fresh the run renumbers itself to round 1 — and must still be
    // refused, naming the rounds it would have discarded. A fourth round that
    // reports as a clean first one is the failure this asserts against.
    const fresh = run(["--fresh"]);
    assert.equal(fresh.ok, false);
    assert.match(fresh.stderr, /past the self-review bound/);
    assert.match(fresh.stderr, new RegExp(`${MAX_SELF_REVIEW_ROUNDS} rounds have already run`));
    // `--force` is the one advertised door, and it stays open.
    const forced = run(["--fresh", "--force"]);
    assert.equal(forced.ok, true, forced.stderr);
    assert.match(forced.out, /\[dry-run\] round 1 /);
    // The dry run wrote nothing: the staged rounds are still there.
    assert.deepEqual(roundsIn(readdirSync(base)), [1, 2, 3]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("roundBoundNotice: names --force as the way past it", () => {
  const notice = roundBoundNotice(MAX_SELF_REVIEW_ROUNDS + 1);
  // A bound that only warns is not a bound; one with no override refuses the
  // legitimate case (a reworked branch). The message has to offer the door.
  assert.match(notice, /--force/);
});

// --- a dry run validates what the real run would reject ----------------------

test("readRebuttalRecords: shared by both modes, so a dry run cannot lie", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-reb2-"));
  try {
    const good = path.join(dir, "good.json");
    writeFileSync(good, JSON.stringify([{ lens: "agent-review-docs", claim: "no" }]));
    assert.deepEqual(readRebuttalRecords(good), [{ lens: "docs", claim: "no" }]);
    assert.throws(() => readRebuttalRecords(path.join(dir, "nope.json")), /not found/);
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    assert.throws(() => readRebuttalRecords(bad), /not a readable JSON array/);
    const empty = path.join(dir, "empty.json");
    writeFileSync(empty, "[]");
    assert.throws(() => readRebuttalRecords(empty), /no usable records/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review --dry-run rejects a rebuttals file the real run would reject", () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "spec-to-pr.mjs");
  const root = mkdtempSync(path.join(os.tmpdir(), "spec-to-pr-dryreb-"));
  try {
    let stderr = "";
    try {
      execFileSync("node", [script, "review", "--dry-run", "--out", path.join(root, "base"),
        "--rebuttals", path.join(root, "nope.json")], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      stderr = String(e.stderr);
    }
    // Announcing that it will adjudicate a file the real run rejects is the one
    // answer this mode must never give.
    assert.match(stderr, /--rebuttals file not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
