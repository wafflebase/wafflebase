import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractNonGoals,
  extractDeferralLines,
  renderDeferrals,
  loadScopedDocs,
  renderIssues,
  fetchIssues,
} from "./hunt-corpus.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

test("extractNonGoals: finds the section at ANY heading depth", () => {
  // The regression that motivated this. A first cut anchored on `^## Non-Goals`
  // silently produced a 198-token digest because docs/design/cli.md uses `###`,
  // so the real non-goals never reached the model. A digest that quietly finds
  // nothing looks identical to "this doc has no non-goals".
  for (const h of ["## Non-Goals", "### Non-Goals", "#### Non-Goal"]) {
    const got = extractNonGoals(`# Doc\n\n## Summary\n\ntext\n\n${h}\n\n- no device flow\n- no encryption\n\n## Next\n\nother`);
    assert.match(got, /no device flow/, h);
    assert.match(got, /no encryption/, h);
    assert.doesNotMatch(got, /other/, `${h}: must stop at the next same-or-shallower heading`);
  }
});

test("extractNonGoals: a DEEPER heading stays inside the section", () => {
  const got = extractNonGoals("### Non-Goals\n\n- a\n\n#### Later\n\n- b\n\n### Proposal\n\n- c");
  assert.match(got, /- a/);
  assert.match(got, /- b/, "a subsection of non-goals is still non-goals");
  assert.doesNotMatch(got, /- c/);
});

test("extractNonGoals: absent section yields empty, not the whole document", () => {
  assert.equal(extractNonGoals("# Doc\n\n## Summary\n\nno such section"), "");
  assert.equal(extractNonGoals(""), "");
  assert.equal(extractNonGoals(undefined), "");
});

test("extractDeferralLines: catches deferral phrasing with citable line numbers", () => {
  const lines = extractDeferralLines(
    ["intro", "This is deferred to P1.", "plain", "Out of scope for v1.", "may be added later"].join("\n"),
  );
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^2: /, "line numbers are 1-based so a maintainer can cite them");
  assert.match(lines[1], /Out of scope/);
  assert.equal(extractDeferralLines("nothing here").length, 0);
  // Bounded, so one sprawling roadmap cannot crowd out the issue corpus.
  assert.equal(extractDeferralLines(Array(99).fill("deferred").join("\n"), { max: 5 }).length, 5);
});

test("renderDeferrals: labels the digest as project decisions, not defects", () => {
  const out = renderDeferrals(new Map([["docs/design/cli.md", "### Non-Goals\n\n- Device flow\n"]]));
  assert.match(out, /CONSCIOUS project decisions, not defects/);
  assert.match(out, /docs\/design\/cli\.md/, "the source is named so the model can cite it");
  assert.match(out, /Device flow/);
  // An empty digest says so explicitly rather than rendering a bare header that
  // reads as "there are none".
  assert.match(renderDeferrals(new Map()), /no deferrals found/);
});

test("loadScopedDocs: reads concrete paths and SKIPS globs", () => {
  // Globs are skipped on purpose: expanding packages/cli/skills/** pulls ~32 KB
  // of near-zero-deferral-density files and spends budget better used on issues.
  const docs = loadScopedDocs(REPO, ["docs/design/cli.md", "packages/cli/skills/**", "does/not/exist.md"]);
  assert.ok(docs.has("docs/design/cli.md"));
  assert.ok(!docs.has("packages/cli/skills/**"), "globs are skipped");
  assert.ok(!docs.has("does/not/exist.md"), "missing files are skipped, not thrown on");
});

test("INTEGRATION: the real cli.md digest contains the non-goals that caused false positives", () => {
  // Reads the SHIPPED doc rather than a fixture. These four are the specific
  // deferrals a contract hunter would otherwise file as violations, so if a doc
  // edit moves them out of the digest this test should fail loudly.
  const docs = loadScopedDocs(REPO, ["docs/design/cli.md"]);
  const digest = renderDeferrals(docs);
  for (const phrase of [/Device flow/i, /Encrypting stored tokens/i, /Block-level write/i, /Image upload/i]) {
    assert.match(digest, phrase, `the digest must carry ${phrase}`);
  }
  assert.ok(digest.length > 1000, `digest looks too thin (${digest.length} chars) — the 198-token failure again?`);
});

test("renderIssues: closed issues are included, bodies truncated not dropped", () => {
  const out = renderIssues([
    { number: 274, state: "OPEN", title: "INDEX() over arrays", body: "x".repeat(2000) },
    { number: 101, state: "CLOSED", title: "wont fix this", body: "short" },
  ]);
  assert.match(out, /#274 \[OPEN\]/);
  // A defect closed as "working as intended" is exactly what a hunter would
  // otherwise re-report with conviction, so closed issues must be in the corpus.
  assert.match(out, /#101 \[CLOSED\]/);
  assert.ok(!out.includes("x".repeat(700)), "long bodies are truncated");
  assert.match(out, /Issues already filed \(2\)/);
  assert.equal(renderIssues([]), "(no issues supplied)");
  assert.equal(renderIssues(null), "(no issues supplied)");
});

test("fetchIssues: parses gh output, and degrades instead of aborting the run", () => {
  const ok = fetchIssues("o/r", { runner: () => JSON.stringify([{ number: 1, title: "t", state: "OPEN", body: "b" }]) });
  assert.equal(ok.length, 1);
  // A gh auth hiccup must not lose a whole paid run. Weaker suppression is
  // survivable — the verifiers' own duplicate check still guards — so this
  // returns an error marker for the caller to warn about.
  const bad = fetchIssues("o/r", { runner: () => { throw new Error("gh: not authenticated"); } });
  assert.match(bad.error, /not authenticated/);
  assert.deepEqual(fetchIssues("o/r", { runner: () => "not json" }).error !== undefined, true);
});
