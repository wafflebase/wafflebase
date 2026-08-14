import { test } from "node:test";
import assert from "node:assert/strict";
import { tagPriorFindings, lensCheckNames, collectPrior } from "./prior-findings.mjs";
import { parseArgs, commitCheckRuns, prCommitsWithCheckRuns } from "./gh-checks.mjs";

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

test("tagPriorFindings: an infra/quota record is never carried forward", () => {
  // A lens that hit a 429 session limit writes a synthetic infra record so it
  // fails closed. That is not a code finding — carrying it into the next round
  // would make the panel re-check "the review could not run", and the verifier
  // (biased to keep) cannot refute it. It must be dropped on read — whether it
  // carries the { infra: true } flag (records written after the fix) OR only the
  // stable message prefix with the synthetic shape (records persisted BEFORE the
  // flag existed — a PR contaminated by a pre-fix 429 round, which stuck #632).
  const runs = new Map([
    // Mixed check: the synthetic infra record AND a real finding — the infra one
    // is dropped, the real finding is preserved (CodeRabbit: real prior findings
    // followed by an infrastructure failure must survive).
    ["agent-review-correctness", { output: { text: JSON.stringify([
      { severity: "major", summary: "Review could not run — Claude API/quota error (429): You've hit your session limit", infra: true },
      { severity: "major", file: "src/a.ts", summary: "real blocker" },
    ]) } }],
    // Legacy record: no `infra` flag, matched by prefix + synthetic shape (no file).
    ["agent-review-security", { output: { text: JSON.stringify([
      { severity: "major", summary: "Review could not run — Claude API/quota error (429): You've hit your session limit · resets 3:40am (UTC)" },
    ]) } }],
  ]);
  assert.deepEqual(tagPriorFindings(runs), [
    { severity: "major", file: "src/a.ts", summary: "real blocker", lens: "correctness" },
  ]);
});

test("tagPriorFindings: a REAL finding is not suppressed by mimicking the infra text", () => {
  // `summary` is model output. A genuine finding whose summary happens to begin
  // with the infra sentinel (or one an injected diff crafts to look like it) must
  // stay a blocker: it cites a `file`, which the script-authored synthetic record
  // never does, and only `infra: true` (script-set) is authoritative on its own.
  const runs = new Map([
    ["agent-review-security", { output: { text: JSON.stringify([
      { severity: "critical", file: "src/auth.ts", summary: "Review could not run — Claude API/quota error is logged with the raw token" },
    ]) } }],
  ]);
  assert.deepEqual(tagPriorFindings(runs), [
    { severity: "critical", file: "src/auth.ts", summary: "Review could not run — Claude API/quota error is logged with the raw token", lens: "security" },
  ]);
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

// --- commitCheckRuns --------------------------------------------------------

test("commitCheckRuns: slurps and flattens, exactly as the multi-commit path does", () => {
  const api = (args) => {
    assert.ok(args.includes("--slurp"), "check-runs MUST be slurped or the JSON is invalid");
    assert.ok(args.some((a) => a.includes("/commits/abc/check-runs")));
    return [{ check_runs: [{ id: 1 }] }, { check_runs: [{ id: 2 }] }];
  };
  assert.deepEqual(commitCheckRuns("abc", { api }), [{ id: 1 }, { id: 2 }]);
  for (const junk of [null, "x", 7, [null, {}, { check_runs: null }]]) {
    assert.deepEqual(commitCheckRuns("abc", { api: () => junk }), []);
  }
});

// The two functions fail in OPPOSITE directions, and callers depend on which.
// `prCommitsWithCheckRuns` swallows per commit, because losing one commit's runs
// must not cost the other commits'. `commitCheckRuns` has no catch at all: its
// caller asked about ONE commit, so swallowing would hand back "this commit had
// no check runs" — which reads as "the panel never ran" — when the truth is "we
// could not look". harvest.mjs relies on being able to tell those apart.
test("commitCheckRuns: THROWS on a bad response, unlike the per-commit path", () => {
  const boom = () => { throw new Error("422 unprocessable"); };
  assert.throws(() => commitCheckRuns("abc", { api: boom }), /422/);
  const api = (args) =>
    args.includes("--paginate") && args.some((a) => a.includes("/pulls/"))
      ? [{ sha: "bad" }]
      : boom();
  assert.deepEqual(prCommitsWithCheckRuns("1", { api, log: () => {} }), [{ sha: "bad", checkRuns: [] }]);
});

test("parseArgs: value-less flags must be DECLARED, not inferred from what follows", () => {
  // Inference fails in both directions. `--append` at the end of argv reads the
  // next token — undefined — and becomes falsy, which is how harvest.mjs printed
  // instead of writing while exiting 0 and reporting success.
  const a = parseArgs(["node", "s", "--pr", "548", "--append"], { booleans: ["append"] });
  assert.equal(a.append, true);
  assert.equal(a.pr, "548");
  // Order must not matter for a boolean either.
  assert.equal(parseArgs(["node", "s", "--append", "--pr", "548"], { booleans: ["append"] }).pr, "548");
  // Undeclared → unchanged, so no existing caller shifts behavior.
  assert.equal(parseArgs(["node", "s", "--append"]).append, undefined);
  // An EMPTY string is a value, not a flag — review-panel.mjs passes possibly-empty
  // --since-sha/--review-mode unconditionally and relies on this.
  assert.equal(parseArgs(["node", "s", "--since-sha", "", "--head", "x"])["since-sha"], "");
});

test("commitCheckRuns: a non-array check_runs contributes nothing, not itself", () => {
  // `p?.check_runs ?? []` would spread a scalar or object straight into the run
  // list via flatMap, and it would travel downstream as if it were a run.
  for (const payload of [7, "x", { id: 1 }, true]) {
    assert.deepEqual(commitCheckRuns("abc", { api: () => [{ check_runs: payload }] }), []);
  }
  // A good page alongside a junk one still yields the good runs.
  assert.deepEqual(
    commitCheckRuns("abc", { api: () => [{ check_runs: 7 }, { check_runs: [{ id: 2 }] }] }),
    [{ id: 2 }],
  );
});

// --- permissionResolver -----------------------------------------------------

test("permissionResolver: accepts write-ish levels from either field", async () => {
  const { permissionResolver } = await import("./gh-checks.mjs");
  // The legacy `permission` field collapses maintain→write on some responses and
  // the granular `role_name` is absent on others; the workflows accept either.
  for (const d of [{ permission: "admin" }, { permission: "maintain" }, { permission: "write" }, { role_name: "maintain" }]) {
    assert.equal(permissionResolver({ api: () => d })("u"), true, JSON.stringify(d));
  }
  for (const d of [{ permission: "read" }, { permission: "none" }, { role_name: "triage" }, {}]) {
    assert.equal(permissionResolver({ api: () => d })("u"), false, JSON.stringify(d));
  }
});

test("permissionResolver: an API failure is null, not false", async () => {
  const { permissionResolver } = await import("./gh-checks.mjs");
  // A 404 really is "not a collaborator", but a 403/5xx is "we could not ask" and
  // the CLI's exit status cannot tell them apart — so the caller decides.
  const r = permissionResolver({ api: () => { throw new Error("gh: 502"); }, log: () => {} });
  assert.equal(r("u"), null);
  assert.equal(r(""), null, "an empty login is unknown, never a lookup");
  assert.equal(r(undefined), null);
});

test("permissionResolver: memoizes per login, failures included", async () => {
  const { permissionResolver } = await import("./gh-checks.mjs");
  let calls = 0;
  const r = permissionResolver({ api: () => { calls++; return { permission: "write" }; } });
  r("a"); r("a"); r("b"); r("a");
  assert.equal(calls, 2, "one call per distinct login");
  // A login that failed must not be re-asked for every comment on the PR.
  let boom = 0;
  const r2 = permissionResolver({ api: () => { boom++; throw new Error("404"); }, log: () => {} });
  r2("x"); r2("x"); r2("x");
  assert.equal(boom, 1);
});

test("permissionResolver: the login is URL-encoded into the path", async () => {
  const { permissionResolver } = await import("./gh-checks.mjs");
  let seen = "";
  permissionResolver({ api: (a) => { seen = a[1]; return {}; } })("odd name/../x");
  assert.equal(seen.includes("/../"), false, "a login must not escape the path");
  assert.match(seen, /collaborators\/odd%20name%2F\.\.%2Fx\/permission$/);
});
