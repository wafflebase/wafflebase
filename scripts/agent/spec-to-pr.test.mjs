import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isValidSlug,
  renderPrBody,
  commitsMissingTrailer,
  parseRepoFromRemoteUrl,
  pipelineDir,
} from "./spec-to-pr.mjs";
import { disclosesAiAuthorship, hasDisclosureTrailer, DISCLOSURE_TRAILER } from "./vendor/pipeline/disclosure.mjs";

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

// --- where the pipeline lives ----------------------------------------------
//
// The pipeline moved to wafflebase/agent-pipeline, so `review` needs a checkout of
// it — the lens RUBRICS are prose and are not vendored. Three branches, and the
// difference between the last two is the whole point: a missing option degrades,
// a wrong one does not.

const PANEL = ["packages", "pipeline", "review-panel.mjs"];

/** A directory shaped like a pipeline checkout, or deliberately not. */
function fakeCheckout({ withPanel = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "pipeline-dir-"));
  if (withPanel) {
    mkdirSync(path.join(dir, ...PANEL.slice(0, -1)), { recursive: true });
    writeFileSync(path.join(dir, ...PANEL), "// panel\n");
  }
  return dir;
}

test("pipelineDir: absent means SKIP, not failure", () => {
  // `review` is a local preview; CI reviews the branch regardless. A developer
  // without a clone of the pipeline must not be stopped by it.
  const errors = [];
  assert.equal(pipelineDir({}, {}, (m) => errors.push(m)), null);
  assert.deepEqual(errors, [], "a missing checkout must not be reported as an error");
});

test("pipelineDir: a real checkout resolves to packages/pipeline", () => {
  const dir = fakeCheckout();
  const errors = [];
  assert.equal(pipelineDir({ "pipeline-dir": dir }, {}, (m) => errors.push(m)), path.join(dir, ...PANEL.slice(0, -1)));
  assert.deepEqual(errors, []);
});

test("pipelineDir: AGENT_PIPELINE_DIR is honoured, and the flag wins", () => {
  const viaEnv = fakeCheckout();
  const viaFlag = fakeCheckout();
  assert.equal(pipelineDir({}, { AGENT_PIPELINE_DIR: viaEnv }, () => {}), path.join(viaEnv, ...PANEL.slice(0, -1)));
  assert.equal(
    pipelineDir({ "pipeline-dir": viaFlag }, { AGENT_PIPELINE_DIR: viaEnv }, () => {}),
    path.join(viaFlag, ...PANEL.slice(0, -1)),
  );
});

test("pipelineDir: a path that is NOT a pipeline checkout fails loudly", () => {
  // The distinction that matters: a typo is not the same as an absent option, and
  // silently skipping the review would make a mistyped path look like a clean run.
  const notAPipeline = fakeCheckout({ withPanel: false });
  const errors = [];
  pipelineDir({ "pipeline-dir": notAPipeline }, {}, (m) => errors.push(m));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /is not a checkout of wafflebase\/agent-pipeline/);
});

test("pipelineDir: a non-string flag is treated as absent, not stringified", () => {
  // `--pipeline-dir` with no value parses as boolean `true`; joining that into a
  // path would look for a directory literally named "true".
  const errors = [];
  assert.equal(pipelineDir({ "pipeline-dir": true }, {}, (m) => errors.push(m)), null);
  assert.deepEqual(errors, []);
});
