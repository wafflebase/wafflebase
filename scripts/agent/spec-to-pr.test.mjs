import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
  MAX_SELF_REVIEW_ROUNDS,
} from "./spec-to-pr.mjs";
import { disclosesAiAuthorship, hasDisclosureTrailer, DISCLOSURE_TRAILER } from "./disclosure.mjs";

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
  // The key is what a --rebuttals record is addressed to, so it has to be
  // copyable from the terminal rather than reconstructed by hand.
  assert.match(out, /key: a\.ts::off by one/);
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
    write(1, "correctness", { findings: [{ severity: "critical", file: "a.ts", summary: "one" }] });
    write(1, "docs", { findings: [{ severity: "major", file: "d.ts", summary: "doc gap" }] });
    write(2, "correctness", { findings: [{ severity: "major", file: "b.ts", summary: "two" }] });
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

    // An unparseable verdict costs that lens its carry-forward and nothing else.
    writeFileSync(path.join(base, "round-2", "correctness", "verdict.json"), "{ not json");
    assert.deepEqual(priorFindingsFor(base, 3).map((f) => f.lens), ["docs"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
