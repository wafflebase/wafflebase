// Reading the repository's open issues as prior reports.
//
// The tests that matter here are about the COMPARISON, not the transport: a
// wrong duplicate verdict routes a real report to a comment on somebody else's
// issue and never files it, which is the one outcome the whole pipeline exists
// to prevent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_FOR_SCORING, MAX_TITLE, openIssuesAsPrior, priorFromIssue } from "./report-prior.mjs";
import { findDuplicate } from "./report-intake.mjs";

test("an issue becomes the shape the ledger already uses", () => {
  const prior = priorFromIssue({
    number: 512,
    title: "Toolbar icons are cramped",
    body: "Steps: open a doc, look at the row.",
    url: "https://example.invalid/512",
  });
  assert.equal(prior.ref, "#512");
  assert.equal(prior.title, "Toolbar icons are cramped");
  assert.equal(prior.source, "issue");
  assert.ok(prior.key, "an exact-key match must still be possible");
  // Title first, so truncation can never cost the part written to identify it.
  assert.ok(prior.text.startsWith("Toolbar icons are cramped"));
});

test("issue text is cleaned before anyone reads it", () => {
  // Written by strangers, and it ends up in front of a person deciding whether
  // their own report is a duplicate.
  const prior = priorFromIssue({
    number: 1,
    title: "Cramped\u200btoolbar\u202e",
    body: "a\u0000b",
  });
  // Zero-width and bidi characters are REMOVED, not turned into spaces: they are
  // invisible, so replacing them with a space would let anyone forge an apparent
  // word boundary and change how the text tokenises for the duplicate score.
  assert.equal(prior.title, "Crampedtoolbar");
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[\u0000-\u001F\u007F-\u009F\u200B\u202E]/.test(prior.text), prior.text);
  assert.match(prior.text, /a b/, "a control character becomes a space");
});

test("a title and body longer than the caps are truncated", () => {
  const prior = priorFromIssue({ number: 2, title: "t".repeat(400), body: "b".repeat(9000) });
  assert.equal(prior.title.length, MAX_TITLE);
  assert.ok(prior.text.length <= MAX_TITLE + 1 + MAX_BODY_FOR_SCORING);
});

test("a long issue body does NOT swallow a one-sentence report", () => {
  // THE REGRESSION THIS MODULE EXISTS FOR. `tokenOverlap` is containment
  // (`shared / min(|a|, |b|)`) and its own docblock warns it is blind to the
  // longer operand — so an issue whose body merely contains the words of a short
  // sentence scores 1.0 and the report is routed to `duplicate`, commented onto
  // an unrelated issue, and never filed.
  const report = { note: "the toolbar icons are cramped" };
  const distinct = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  const body = `the toolbar icons are cramped ${distinct}`;

  const asIssue = findDuplicate(report, [
    { key: "k", text: body, ref: "#1", title: "Something else", source: "issue" },
  ]);
  assert.equal(asIssue, null, "Dice must not call this a duplicate");

  // Same text, same threshold, no `source` — the ledger path still uses
  // containment, where one sentence restating another at length is real evidence.
  const asLedger = findDuplicate(report, [{ key: "k", text: body, ref: "r" }]);
  assert.ok(asLedger, "the ledger comparison is deliberately unchanged");
});

test("a genuine duplicate of an issue is still caught, and names it", () => {
  const report = { note: "the merged cell border looks broken" };
  const prior = [
    priorFromIssue({
      number: 77,
      title: "Merged cell border looks broken",
      body: "The border on a merged cell renders wrong.",
    }),
  ];
  const found = findDuplicate(report, prior);
  assert.ok(found, "an issue about the same defect must be found");
  assert.equal(found.duplicateOf ?? found.match.ref, "#77");
  // The reporter is told WHICH issue, not just that a number crossed a bar.
  assert.match(found.why, /#77/);
  assert.match(found.why, /Merged cell border/);
});

test("an exact title match is a duplicate without needing the prose test", () => {
  const prior = [priorFromIssue({ number: 9, title: "Toolbar icons are cramped", body: "" })];
  // `reportKey` puts the draft title in the summary slot and an issue has no
  // address, so both sides key on the summary alone.
  const found = findDuplicate({ note: "x", draft: { title: "Toolbar icons are cramped" } }, prior);
  assert.ok(found);
  assert.equal(found.why, "same place, same summary");
});

test("an unreachable `gh` carries nothing rather than failing the run", () => {
  // `gh` may be absent, the caller offline, or the repository private to them.
  // The cost of getting this wrong is one duplicate comment; the cost of
  // refusing to run is a report nobody sees.
  const logged = [];
  const prior = openIssuesAsPrior({
    api: () => {
      throw new Error("gh: command not found");
    },
    log: (m) => logged.push(m),
  });
  assert.deepEqual(prior, []);
  assert.match(logged.join(" "), /carrying none/);
});

test("the issue query is read-only and scoped to open issues", () => {
  let seen;
  openIssuesAsPrior({ api: (args) => ((seen = args), []), repo: "owner/name", limit: 5 });
  assert.deepEqual(seen.slice(0, 2), ["issue", "list"]);
  assert.ok(seen.includes("--state") && seen[seen.indexOf("--state") + 1] === "open");
  assert.ok(seen.includes("--repo") && seen[seen.indexOf("--repo") + 1] === "owner/name");
  assert.equal(seen[seen.indexOf("--limit") + 1], "5");
  // Nothing here may create, edit or comment on anything.
  assert.ok(!seen.some((a) => /^(create|edit|comment|close|delete)$/.test(a)), seen.join(" "));
});
