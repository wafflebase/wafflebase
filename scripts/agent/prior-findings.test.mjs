import { test } from "node:test";
import assert from "node:assert/strict";
import { tagPriorFindings, lensCheckNames, parseArgs, collectPrior } from "./prior-findings.mjs";

const NAMES = ["agent-review-correctness", "agent-review-security"];

// --- tagPriorFindings -------------------------------------------------------

test("tagPriorFindings: tags each finding with its lens, parsing lenses independently", () => {
  const runs = new Map([
    ["agent-review-correctness", { output: { text: JSON.stringify([{ severity: "major", summary: "x" }]) } }],
    ["agent-review-security", { output: { text: "{not json" } }],
    ["agent-review-design-fit", { output: { text: JSON.stringify([{ severity: "critical", summary: "y" }]) } }],
  ]);
  // ONE lens's garbage must not zero the others. Prior findings can only re-raise
  // a blocker, never clear one, so losing one lens's carry-forward is strictly
  // better than failing the round for all five.
  assert.deepEqual(tagPriorFindings(runs), [
    { severity: "major", summary: "x", lens: "correctness" },
    { severity: "critical", summary: "y", lens: "design-fit" },
  ]);
});

test("tagPriorFindings: absent output is NOT 'found nothing'; junk never throws", () => {
  // A clean lens legitimately persists "[]", so an ABSENT payload means we cannot
  // see what this lens found — carry nothing for it rather than assert innocence.
  assert.deepEqual(tagPriorFindings({ "agent-review-correctness": { output: { text: "" } } }), []);
  assert.deepEqual(tagPriorFindings({ "agent-review-correctness": { output: {} } }), []);
  assert.deepEqual(tagPriorFindings({ "agent-review-correctness": {} }), []);
  assert.deepEqual(tagPriorFindings({ "agent-review-correctness": { output: { text: "[]" } } }), []);
  // non-array payload, non-object entries inside the array
  assert.deepEqual(tagPriorFindings({ "agent-review-x": { output: { text: '{"a":1}' } } }), []);
  assert.deepEqual(tagPriorFindings({ "agent-review-x": { output: { text: "[null,7,[]]" } } }), []);
  for (const bad of [null, undefined, "x", 7, []]) assert.deepEqual(tagPriorFindings(bad), []);
  // a finding cannot spoof its origin: `lens` is applied last
  assert.equal(
    tagPriorFindings({ "agent-review-security": { output: { text: '[{"summary":"s","lens":"correctness"}]' } } })[0].lens,
    "security",
  );
});

test("lensCheckNames: manifest ids → check names; junk → []", () => {
  assert.deepEqual(lensCheckNames([{ id: "correctness" }, { id: "blast-radius" }]),
    ["agent-review-correctness", "agent-review-blast-radius"]);
  assert.deepEqual(lensCheckNames([{ id: "" }, {}, null, { id: 7 }]), []);
  for (const bad of [null, undefined, "x", 7, {}]) assert.deepEqual(lensCheckNames(bad), []);
});

// --- parseArgs --------------------------------------------------------------

test("parseArgs: flags in any position, and no prototype write", () => {
  const a = parseArgs(["node", "s", "581", "--lenses", "l.json", "--out", "o.json"]);
  assert.equal(a._[0], "581");
  assert.equal(a.lenses, "l.json");
  assert.equal(a.out, "o.json");
  // Flag-first must work too: reading the PR from argv[2] made this a usage error.
  assert.equal(parseArgs(["node", "s", "--lenses", "l.json", "581"])._[0], "581");
  // `--__proto__ x` on an object literal sets the PROTOTYPE, not a key, so the
  // value vanishes and every later object is polluted. Object.create(null) is why.
  const p = parseArgs(["node", "s", "--__proto__", '{"polluted":1}', "7"]);
  assert.equal(({}).polluted, undefined, "Object.prototype must be untouched");
  assert.equal(p.__proto__, '{"polluted":1}', "it is an ordinary key here, not the prototype");
  for (const bad of [null, undefined, "x", 7]) assert.deepEqual(parseArgs(bad)._, []);
});

// --- collectPrior: the API half ---------------------------------------------

const COMMITS = ["api", "--paginate", "repos/{owner}/{repo}/pulls/581/commits?per_page=100"];
const isCheckRuns = (args) => args[1].includes("/check-runs");
const isFullRun = (args) => /\/check-runs\/\d+$/.test(args[1]);
const findings = (n) => JSON.stringify([{ severity: "major", summary: n }]);
const run = (name, id, over = {}) => ({
  name, id, status: "completed", app: { slug: "github-actions" },
  completed_at: "2026-07-20T10:00:00Z", ...over,
});
const quiet = () => {};

// The defect this module was reported for: reading output.text off the LIST
// response. GitHub omits or truncates it there, so the payload either fails to
// parse or is absent, and the lens's whole carry-forward silently becomes zero.
test("collectPrior: back-fills output.text with a per-run fetch, not the list copy", () => {
  const calls = [];
  const api = (args) => {
    calls.push(args);
    if (args.join(" ") === COMMITS.join(" ")) return [{ sha: "s1" }];
    // The list response as GitHub actually returns it: no output.text at all.
    if (isFullRun(args)) return { ...run("agent-review-correctness", 11), output: { text: findings("real") } };
    return [{ check_runs: [run("agent-review-correctness", 11, { output: { title: "t" } })] }];
  };
  const got = collectPrior({ pr: "581", names: NAMES, api, log: quiet });
  assert.deepEqual(got, [{ severity: "major", summary: "real", lens: "correctness" }]);
  assert.ok(calls.some((c) => isFullRun(c)), "must fetch the selected run in full");
  // A truncated list copy is worse than an absent one — it fails JSON.parse.
  const truncated = (args) => {
    if (args.join(" ") === COMMITS.join(" ")) return [{ sha: "s1" }];
    if (isFullRun(args)) return { output: { text: findings("real") } };
    return [{ check_runs: [run("agent-review-correctness", 11, { output: { text: findings("real").slice(0, 20) } })] }];
  };
  assert.equal(collectPrior({ pr: "581", names: NAMES, api: truncated, log: quiet }).length, 1);
});

// `--slurp` on the object-wrapped check-runs endpoint. Plain --paginate emits
// concatenated per-page objects, which is invalid JSON; the repo verified this
// once already in review-round-guard.mjs. A stub that returns PAGES proves the
// call asks for slurped output and that pages are flattened.
test("collectPrior: asks for --slurp on check-runs and flattens every page", () => {
  const api = (args) => {
    if (args.join(" ") === COMMITS.join(" ")) return [{ sha: "s1" }];
    if (isFullRun(args)) {
      const id = Number(args[1].split("/").pop());
      return { output: { text: findings(id === 11 ? "page1" : "page2") } };
    }
    assert.ok(args.includes("--slurp"), "check-runs MUST be slurped or the JSON is invalid");
    // Two pages, one lens run on each.
    return [
      { check_runs: [run("agent-review-correctness", 11)] },
      { check_runs: [run("agent-review-security", 12)] },
    ];
  };
  const got = collectPrior({ pr: "581", names: NAMES, api, log: quiet });
  assert.deepEqual(got.map((f) => f.lens).sort(), ["correctness", "security"]);
});

// Fail isolation. The single outer try this replaced turned any one failed call
// into "0 prior findings for all five lenses" — indistinguishable from a clean
// round, and it silently disables the cross-round re-check.
test("collectPrior: one bad commit or one bad run-fetch does not zero the rest", () => {
  const api = (args) => {
    if (args.join(" ") === COMMITS.join(" ")) return [{ sha: "bad" }, { sha: "good" }];
    if (isFullRun(args)) {
      if (args[1].endsWith("/12")) throw new Error("500 on the full fetch");
      return { output: { text: findings("kept") } };
    }
    if (args[1].includes("/bad/")) throw new Error("422 unprocessable");
    return [{
      check_runs: [
        run("agent-review-correctness", 11),
        // Its full fetch throws, so the list copy is used — which here HAS text.
        run("agent-review-security", 12, { output: { text: findings("fallback") } }),
      ],
    }];
  };
  const got = collectPrior({ pr: "581", names: NAMES, api, log: quiet });
  assert.deepEqual(got.map((f) => f.summary).sort(), ["fallback", "kept"]);
});

test("collectPrior: never throws — a failed commit list is [] and junk is []", () => {
  const boom = () => { throw new Error("gh: not authenticated"); };
  assert.deepEqual(collectPrior({ pr: "581", names: NAMES, api: boom, log: quiet }), []);
  for (const payload of [null, "x", 7, {}, [null, 7, { sha: null }]]) {
    assert.deepEqual(collectPrior({ pr: "581", names: NAMES, api: () => payload, log: quiet }), []);
  }
  // No lens names → nothing can match, and it must not throw on the way there.
  assert.deepEqual(collectPrior({ pr: "581", names: [], api: () => [{ sha: "s1" }], log: quiet }), []);
});
