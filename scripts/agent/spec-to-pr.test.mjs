import { test } from "node:test";
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
