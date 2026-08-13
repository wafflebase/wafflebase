import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPTURE_ARTIFACT_PREFIX, CAPTURE_META_SCHEMA,
  MAX_FILES_PER_ARTIFACT,
  collect, daysBetween, expiryReport, isHostileEntry, isLegacyArtifactName, isLoudSkip, keyFor, parseMeta,
  planCollection, prepareArtifact, runIdsFromKeys, safeEntries, summarize, walkArtifacts,
} from "./collect-captures.mjs";
import { createCaptureStore } from "./capture-store.mjs";
import { fixtureGitEnv } from "./vendor/pipeline/git-env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** What #673's producer writes, field for field. */
const META = {
  schema: CAPTURE_META_SCHEMA,
  pr: 669,
  headSha: "c18b6abbd7df4247c865fe12fc0f0d3530c294d6",
  baseSha: "268fb507b1cf1de6b5b6cbb2fd5ba49b3ab0e9c1",
  channel: "advisory",
  workflow: "agent-review-on-demand.yml",
  runId: 30889625585,
  runAttempt: 1,
  event: "issue_comment",
  panelSha: "268fb507b1cf1de6b5b6cbb2fd5ba49b3ab0e9c1",
  lenses: ["blast-radius", "correctness", "design-fit", "security", "test-adequacy"],
  capturedAt: "2026-08-04T07:53:22Z",
};

// --- parseMeta -----------------------------------------------------------------

test("parseMeta: accepts what the producer writes, as text or as an object", () => {
  const fromObject = parseMeta(META);
  const fromText = parseMeta(JSON.stringify(META));
  assert.deepEqual(fromObject, fromText);
  assert.equal(fromObject.pr, 669);
  assert.equal(fromObject.runId, 30889625585);
  assert.equal(fromObject.channel, "advisory");
});

test("parseMeta: a numeric field arriving as a string is still a NUMBER", () => {
  // The producer writes numbers, but a hand-written backfill meta.json is a
  // plausible source and `"669"` in a key segment reads identically. Coercing
  // here means `keyFor` never has to care which it got.
  const m = parseMeta({ ...META, pr: "669", runId: "30889625585", runAttempt: "2" });
  assert.equal(m.pr, 669);
  assert.equal(m.runAttempt, 2);
});

test("parseMeta: REFUSES every field it cannot validate, naming the field", () => {
  // One table, because the property is uniform: partial trust is not an option
  // the design allows, so every one of these is a refusal and not a default.
  const cases = [
    [{ pr: "../../etc" }, /pr must be a positive integer/],
    [{ pr: 0 }, /pr must be a positive integer/],
    [{ pr: -1 }, /pr must be a positive integer/],
    [{ pr: "1e3" }, /pr must be a positive integer/],
    [{ pr: " 12" }, /pr must be a positive integer/],
    [{ pr: 1.5 }, /pr must be a positive integer/],
    [{ pr: null }, /pr must be a positive integer/],
    [{ headSha: "c18b6ab" }, /headSha must be 40 lowercase hex/],
    [{ headSha: "C18B6ABBD7DF4247C865FE12FC0F0D3530C294D6" }, /headSha must be 40 lowercase hex/],
    [{ headSha: "../../../../etc/passwd/aaaaaaaaaaaaaaaaaaaaaa" }, /headSha must be 40 lowercase hex/],
    [{ baseSha: "nope" }, /baseSha must be 40 lowercase hex/],
    [{ channel: "gatingg" }, /channel must be one of/],
    [{ channel: "" }, /channel must be one of/],
    [{ workflow: "agent-review-panel" }, /workflow must be a workflow file name/],
    [{ workflow: "../../../evil.yml" }, /workflow must be a workflow file name/],
    [{ runId: 0 }, /runId must be a positive integer/],
    [{ runAttempt: "x" }, /runAttempt must be a positive integer/],
    [{ event: "Issue_Comment" }, /event must be a GitHub event name/],
    [{ panelSha: "" }, /panelSha must be 40 lowercase hex/],
    [{ lenses: [] }, /lenses must be a non-empty array/],
    [{ lenses: "correctness" }, /lenses must be a non-empty array/],
    [{ lenses: ["../etc"] }, /lenses\[\] must be a lowercase kebab-case slug/],
    [{ lenses: ["Correctness"] }, /lenses\[\] must be a lowercase kebab-case slug/],
    [{ capturedAt: "2026-08-04T07:53:22+09:00" }, /capturedAt must be an ISO 8601 UTC timestamp/],
    [{ capturedAt: "2026-08-04" }, /capturedAt must be an ISO 8601 UTC timestamp/],
  ];
  for (const [patch, re] of cases) {
    assert.throws(() => parseMeta({ ...META, ...patch }), re, `accepted ${JSON.stringify(patch)}`);
  }
});

test("parseMeta: an unknown schema MAJOR is refused, not guessed at", () => {
  // A collector that guesses at a format it does not know writes plausible
  // garbage into the corpus, and no later check would notice.
  assert.throws(() => parseMeta({ ...META, schema: "wafflebase/stage-capture-meta@2" }), /schema must be/);
  assert.throws(() => parseMeta({ ...META, schema: "wafflebase/stage-capture@1" }), /schema must be/);
  assert.throws(() => parseMeta({ ...META, schema: "" }), /schema must be/);
  const noSchema = { ...META };
  delete noSchema.schema;
  assert.throws(() => parseMeta(noSchema), /schema must be/);
});

test("parseMeta: the schema is checked BEFORE any other field", () => {
  // Order matters for the log line: an `@2` file whose fields also changed shape
  // must report "unknown schema", not "pr must be a positive integer". The
  // second message sends a reader to fix the wrong thing.
  assert.throws(
    () => parseMeta({ schema: "wafflebase/stage-capture-meta@2", pr: "nonsense" }),
    /schema must be/,
  );
});

test("parseMeta: baseSha is null when unknown and a REFUSAL when malformed", () => {
  // The producer records `null` for "the diff step never ran", which is a fact.
  // A malformed one is not.
  assert.equal(parseMeta({ ...META, baseSha: null }).baseSha, null);
  const absent = { ...META };
  delete absent.baseSha;
  assert.equal(parseMeta(absent).baseSha, null);
  assert.throws(() => parseMeta({ ...META, baseSha: "" }), /baseSha must be/);
});

test("parseMeta: non-JSON, a JSON array and JSON null are all refusals", () => {
  assert.throws(() => parseMeta("not json at all"), /not valid JSON/);
  assert.throws(() => parseMeta(""), /not valid JSON/);
  assert.throws(() => parseMeta("[1,2,3]"), /meta must be a JSON object/);
  assert.throws(() => parseMeta("null"), /meta must be a JSON object/);
});

test("parseMeta: reads a Buffer, because that is what the zip reader returns", () => {
  assert.equal(parseMeta(Buffer.from(JSON.stringify(META))).pr, 669);
});

// --- keyFor --------------------------------------------------------------------

test("keyFor: the key scheme, for meta.json and for a lens", () => {
  assert.equal(
    keyFor(parseMeta(META)),
    "stage-detail/channel=advisory/pr=669/sha=c18b6abb/run=30889625585/attempt=1/meta.json",
  );
  assert.equal(
    keyFor(parseMeta(META), "correctness"),
    "stage-detail/channel=advisory/pr=669/sha=c18b6abb/run=30889625585/attempt=1/correctness.json",
  );
});

test("keyFor: two gating rounds of ONE pull request do not collide", () => {
  // #648 and #632 each have two gating captures — separate rounds ~17h apart
  // with identical file sets and, for #648, the same head sha. Without `run=` in
  // the key the second round overwrites the first and one PR silently becomes
  // one measurement instead of two. This is invariant B, and it is the reason
  // retry safety, concurrency safety and re-scan safety are one problem.
  const round1 = parseMeta({ ...META, pr: 648, channel: "gating", workflow: "agent-review-panel.yml", event: "workflow_run", runId: 30891782298 });
  const round2 = parseMeta({ ...META, pr: 648, channel: "gating", workflow: "agent-review-panel.yml", event: "workflow_run", runId: 30967268504 });
  assert.notEqual(keyFor(round1, "correctness"), keyFor(round2, "correctness"));
  assert.match(keyFor(round1, "correctness"), /run=30891782298\//);
  assert.match(keyFor(round2, "correctness"), /run=30967268504\//);
});

test("keyFor: a re-run (attempt 2) is a distinct record, not a collision", () => {
  const first = parseMeta({ ...META, runAttempt: 1 });
  const rerun = parseMeta({ ...META, runAttempt: 2 });
  assert.notEqual(keyFor(first, "security"), keyFor(rerun, "security"));
  assert.match(keyFor(rerun, "security"), /attempt=2\//);
});

test("keyFor: a gating and an advisory review of the SAME commit stay apart", () => {
  // Normal, and must not be deduplicated away: they are two different
  // measurements of one revision.
  const gating = parseMeta({ ...META, channel: "gating", workflow: "agent-review-panel.yml", event: "workflow_run" });
  const advisory = parseMeta(META);
  assert.notEqual(keyFor(gating, "correctness"), keyFor(advisory, "correctness"));
});

test("keyFor: REFUSES to build a key from unvalidated input (invariant A)", () => {
  // The whole invariant, and the reason `keyFor` re-checks what `parseMeta`
  // already checked: this is the function that CONCATENATES, and it is reachable
  // from a raw `JSON.parse`, a test fixture, or a future caller that skipped the
  // validator. A `pr` of `../../..` writes outside the store.
  const raw = JSON.parse(JSON.stringify(META));
  assert.throws(() => keyFor({ ...raw, pr: "../../.." }), /pr must be a positive integer/);
  assert.throws(() => keyFor({ ...raw, pr: "669/../../evil" }), /pr must be a positive integer/);
  assert.throws(() => keyFor({ ...raw, headSha: "../../../../etc/passwd" }), /headSha must be/);
  assert.throws(() => keyFor({ ...raw, channel: "gating/../.." }), /channel must be one of/);
  assert.throws(() => keyFor({ ...raw, runId: "1/../2" }), /runId must be a positive integer/);
  assert.throws(() => keyFor({ ...raw, runAttempt: undefined }), /runAttempt must be a positive integer/);
  assert.throws(() => keyFor(null), /meta must be an object/);
  assert.throws(() => keyFor(undefined), /meta must be an object/);
});

test("keyFor: refuses a lens name that is not a slug", () => {
  const m = parseMeta(META);
  for (const bad of ["../evil", "correctness/../..", "Correctness", "correctness.json", "a b", ""]) {
    assert.throws(() => keyFor(m, bad), /lens must be a lowercase kebab-case slug/, `accepted lens ${JSON.stringify(bad)}`);
  }
});

test("keyFor: every key it returns matches the key grammar", () => {
  // The whole-key assertion, not just the field checks. It is the one place that
  // sees the assembled string.
  const m = parseMeta(META);
  for (const lens of [null, ...m.lenses]) {
    assert.match(
      keyFor(m, lens),
      /^stage-detail\/channel=(?:gating|advisory)\/pr=[1-9][0-9]*\/sha=[0-9a-f]{8}\/run=[1-9][0-9]*\/attempt=[1-9][0-9]*\/[a-z0-9.-]+\.json$/,
    );
  }
});

test("runIdsFromKeys: reads the producing run back out of stored keys", () => {
  // This is what lets the read-only expiry warning work without downloading a
  // single artifact: invariant B put the run id in the key, and the artifact
  // list carries the same id.
  const ids = runIdsFromKeys([
    "stage-detail/channel=advisory/pr=669/sha=c18b6abb/run=30889625585/attempt=1/meta.json",
    "stage-detail/channel=gating/pr=648/sha=aaaaaaaa/run=30891782298/attempt=2/security.json",
    "not-a-key.json",
    null,
  ]);
  assert.deepEqual([...ids].sort(), [30889625585, 30891782298]);
});

// --- safeEntries ---------------------------------------------------------------

test("safeEntries: accepts exactly meta.json and <lens>/stage-detail.json", () => {
  const { entries, rejected } = safeEntries([
    "meta.json",
    "correctness/stage-detail.json",
    "blast-radius/stage-detail.json",
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(entries.map((e) => `${e.kind}:${e.lens}`), ["meta:null", "lens:correctness", "lens:blast-radius"]);
});

test("safeEntries: rejects traversal, absolute paths and everything unexpected", () => {
  // The artifact was assembled by a runner that processed the branch under
  // review, so the zip is untrusted input. Names are whitelisted, never
  // sanitised: sanitising turns a hostile name into a plausible one.
  const names = [
    "../meta.json",
    "correctness/../../etc/passwd",
    "/etc/passwd",
    "C:\\Windows\\system32",
    "correctness\\stage-detail.json",
    "meta.json\0.png",
    "correctness/stage-detail.json.bak",
    "correctness/notes/stage-detail.json",
    "Correctness/stage-detail.json",
    "stage-detail.json",
    "correctness/",
  ];
  const { entries, rejected } = safeEntries(names);
  assert.deepEqual(entries, [], "nothing in that list may be read");
  assert.equal(rejected.length, names.length);
  const byName = new Map(rejected.map((r) => [r.name, r.reason]));
  assert.equal(byName.get("../meta.json"), "path-traversal");
  assert.equal(byName.get("correctness/../../etc/passwd"), "path-traversal");
  assert.equal(byName.get("/etc/passwd"), "absolute-path");
  assert.equal(byName.get("C:\\Windows\\system32"), "absolute-path");
  assert.equal(byName.get("correctness\\stage-detail.json"), "backslash-path");
  assert.equal(byName.get("meta.json\0.png"), "nul-byte");
  assert.equal(byName.get("correctness/"), "directory-entry");
  assert.equal(byName.get("Correctness/stage-detail.json"), "unexpected-name");
});

test("safeEntries: a duplicate entry name is rejected, not read twice", () => {
  // A zip may carry the same name twice and an extractor writing to disk keeps
  // the LAST one, so "what was validated" and "what landed" can differ. Reading
  // the first and refusing the rest removes the ambiguity.
  const { entries, rejected } = safeEntries(["meta.json", "meta.json", "correctness/stage-detail.json"]);
  assert.equal(entries.length, 2);
  assert.deepEqual(rejected, [{ name: "meta.json", reason: "duplicate-entry" }]);
});

test("safeEntries: a traversal that ALSO ends in a slash is hostile, not a directory entry", () => {
  // Order of checks inside `rejectReason`, and it is the whole correctness of
  // that function. A trailing slash is the most superficial property a name has
  // — `../` and `/etc/` both have one — so testing for it first files a
  // traversal attempt under the one reason the caller treats as benign, and the
  // artifact carries on being collected with the alarm silenced. Every hostile
  // shape must be ruled out before the benign-looking one is allowed to match.
  for (const name of ["../", "..", "/etc/", "C:\\Windows\\", "correctness/../"]) {
    const { rejected } = safeEntries([name]);
    assert.equal(isHostileEntry(rejected[0].reason), true, `${JSON.stringify(name)} was classified ${rejected[0].reason}, which is treated as benign`);
  }
  assert.equal(isHostileEntry(safeEntries(["correctness/"]).rejected[0].reason), false, "and a plain directory entry stays benign");
});

test("isHostileEntry: a directory entry is scruffy, a `../` is not", () => {
  // The distinction earns its keep in the log: lumping benign listings in with
  // traversal trains a reader to skim past the line that matters.
  assert.equal(isHostileEntry("path-traversal"), true);
  assert.equal(isHostileEntry("absolute-path"), true);
  assert.equal(isHostileEntry("backslash-path"), true);
  assert.equal(isHostileEntry("nul-byte"), true);
  assert.equal(isHostileEntry("directory-entry"), false);
  assert.equal(isHostileEntry("unexpected-name"), false);
  assert.equal(isHostileEntry("duplicate-entry"), false);
});

// --- planCollection ------------------------------------------------------------

const artifact = (over = {}) => ({
  id: 8883738002,
  name: "review-panel-stage-detail",
  created_at: "2026-08-04T07:25:05Z",
  expires_at: "2026-09-03T07:25:04Z",
  expired: false,
  size_in_bytes: 18252,
  workflow_run: { id: 30886864158 },
  ...over,
});

const NOW = new Date("2026-08-05T12:00:00Z");

test("planCollection: matches BOTH artifact name forms — today's and #673's", () => {
  const plan = planCollection(
    [artifact(), artifact({ id: 2, name: "review-panel-stage-detail-pr-673" })],
    { now: NOW },
  );
  assert.equal(plan.fetch.length, 2);
  assert.deepEqual(plan.unexpectedNames, []);
});

test("planCollection: counts non-capture artifacts rather than listing them", () => {
  // 3809 artifacts live in this repository (measured 2026-08-05). A skip record
  // for each would bury the ten that matter.
  const others = Array.from({ length: 50 }, (_, i) => artifact({ id: 1000 + i, name: i % 2 ? "harness-reports" : "review-panel-execution" }));
  const plan = planCollection([...others, artifact()], { now: NOW });
  assert.equal(plan.ignored, 50);
  assert.equal(plan.fetch.length, 1);
  assert.equal(plan.skipped.length, 0);
});

test("planCollection: an unknown name under the prefix is COLLECTED and reported", () => {
  // Failing toward "collect it" on purpose. A strict matcher that stopped
  // recognising a renamed artifact would collect nothing and say nothing —
  // precisely this subsystem's signature failure.
  const plan = planCollection([artifact({ name: "review-panel-stage-detail-v2" })], { now: NOW });
  assert.equal(plan.fetch.length, 1);
  assert.deepEqual(plan.unexpectedNames, ["review-panel-stage-detail-v2"]);
});

test("planCollection: an expired artifact is skipped BEFORE it is downloaded", () => {
  // The list already told us. A download of an expired artifact is a 410 we paid
  // a request to learn.
  const plan = planCollection([artifact({ expired: true })], { now: NOW });
  assert.equal(plan.fetch.length, 0);
  assert.equal(plan.skipped[0].reason, "expired");
  assert.equal(isLoudSkip("expired"), true, "an expired uncollected capture is lost data — it must go red");
});

test("planCollection: --since drops what is older, comparing INSTANTS not strings", () => {
  // ISO strings with a UTC offset sort wrong lexicographically; this codebase
  // has been bitten by that once already.
  const plan = planCollection(
    [
      artifact({ id: 1, created_at: "2026-08-05T00:00:00Z" }),
      artifact({ id: 2, created_at: "2026-08-04T23:00:00Z" }),
      artifact({ id: 3, created_at: "2026-08-05T08:00:00+09:00" }), // 2026-08-04T23:00:00Z
    ],
    { now: NOW, since: new Date("2026-08-04T23:30:00Z") },
  );
  assert.deepEqual(plan.fetch.map((f) => f.id), [1]);
  assert.deepEqual(plan.skipped.map((s) => s.id).sort(), [2, 3]);
});

test("planCollection: an unparseable created_at is a LOUD skip, not a silent pass", () => {
  const plan = planCollection([artifact({ created_at: "yesterday" })], { now: NOW });
  assert.equal(plan.skipped[0].reason, "bad-created-at");
  assert.equal(isLoudSkip("bad-created-at"), true);
});

test("planCollection: the cap reports EXACTLY what it dropped", () => {
  // Invariant F. Silent truncation is the failure mode that reads as "everything
  // was collected" when it was not — the trap that hid the original capture bug
  // for five rounds. The dropped set is named by count, cap, date range and ids,
  // and `summarize` turns it into a non-zero exit.
  const many = Array.from({ length: 12 }, (_, i) =>
    artifact({ id: 100 + i, created_at: `2026-08-${String(20 - i).padStart(2, "0")}T00:00:00Z` }));
  const plan = planCollection(many, { now: NOW, maxArtifacts: 5 });
  assert.equal(plan.fetch.length, 5);
  assert.equal(plan.dropped.count, 7);
  assert.equal(plan.dropped.cap, 5);
  assert.equal(plan.dropped.newest, "2026-08-15T00:00:00Z");
  assert.equal(plan.dropped.oldest, "2026-08-09T00:00:00Z");
  assert.deepEqual(plan.dropped.ids, [105, 106, 107, 108, 109, 110, 111]);
  // The oldest go, not the newest: the list is newest-first and the tail is both
  // the least urgent and the most likely to be collected already.
  assert.deepEqual(plan.fetch.map((f) => f.id), [100, 101, 102, 103, 104]);
  assert.equal(summarize({ dropped: plan.dropped }).exitCode, 1, "a cap that dropped data must go red");
});

test("planCollection: no cap hit means no dropped record at all", () => {
  assert.equal(planCollection([artifact()], { now: NOW, maxArtifacts: 5 }).dropped, null);
});

test("planCollection: carries days-to-expiry, computed from an INJECTED clock", () => {
  const plan = planCollection([artifact({ expires_at: "2026-09-03T07:25:04Z" })], { now: NOW });
  assert.equal(plan.fetch[0].daysLeft, 28);
  assert.equal(daysBetween(NOW, null), null, "an unreadable expiry is unknown, never zero");
});

// --- walkArtifacts (pagination) --------------------------------------------------

/**
 * A fake artifact list of `total` items, newest-first, one per minute going
 * backwards from `startAt` — the shape the real endpoint returns.
 */
function fakePages(total, startAt = Date.parse("2026-08-05T12:00:00Z")) {
  const all = Array.from({ length: total }, (_, i) =>
    artifact({ id: 900000 + i, name: i % 400 === 0 ? "review-panel-stage-detail" : "ci-logs", created_at: new Date(startAt - i * 60000).toISOString().replace(/\.\d{3}Z$/, "Z") }));
  const calls = [];
  return {
    all,
    calls,
    fetchPage(page, perPage) {
      calls.push(page);
      return all.slice((page - 1) * perPage, page * perPage);
    },
  };
}

test("walkArtifacts: STOPS early against a 3809-artifact list", () => {
  // The repository holds 3809 artifacts (measured on the live API, 2026-08-05),
  // and the list endpoint is newest-first with no server-side date filter. A
  // `--paginate` of the whole thing is 39 requests every night to find the ten
  // that matter. The first item older than the window means every remaining item
  // is too, so the walk stops there. Proved with a fake page sequence rather
  // than assumed — the early stop is the only thing bounding this job's cost.
  const f = fakePages(3809);
  // 7 days back is far beyond this fake list's span (3809 minutes ≈ 2.6 days),
  // so a 7-day window legitimately reads everything; the interesting case is the
  // narrow one.
  const narrow = walkArtifacts({ fetchPage: f.fetchPage, since: new Date(Date.parse("2026-08-05T12:00:00Z") - 250 * 60000) });
  assert.equal(narrow.stoppedEarly, true);
  assert.equal(narrow.pages, 3, "251 items in the window → 3 pages of 100, then stop");
  assert.equal(narrow.artifacts.length, 300);
  assert.deepEqual(f.calls, [1, 2, 3], "and it must not fetch page 4 of 39");
  assert.equal(narrow.truncated, false);
  assert.equal(narrow.failed, null);
});

test("walkArtifacts: a short page ends the walk without a wasted request", () => {
  const f = fakePages(150);
  const w = walkArtifacts({ fetchPage: f.fetchPage, since: null });
  assert.equal(w.pages, 2);
  assert.equal(w.artifacts.length, 150);
  assert.deepEqual(f.calls, [1, 2]);
});

test("walkArtifacts: a failed page keeps what it has and SAYS the walk was partial", () => {
  // Fails toward fewer records — the artifacts stay alive for their retention
  // window and the next run retries. But a run that saw half the window must not
  // read as a run that saw all of it, so `failed` is reported and the CLI turns
  // it into a non-zero exit.
  const f = fakePages(3809);
  const logged = [];
  const w = walkArtifacts({
    fetchPage: (page, perPage) => { if (page === 3) throw new Error("HTTP 502"); return f.fetchPage(page, perPage); },
    since: null,
    log: (m) => logged.push(m),
  });
  assert.equal(w.pages, 2);
  assert.equal(w.artifacts.length, 200);
  assert.match(w.failed, /page 3: HTTP 502/);
  assert.ok(logged.some((l) => /could not read artifact page 3/.test(l)));
});

test("walkArtifacts: the page cap is reported as TRUNCATED, never silently", () => {
  const f = fakePages(3809);
  const logged = [];
  const w = walkArtifacts({ fetchPage: f.fetchPage, since: null, maxPages: 4, log: (m) => logged.push(m) });
  assert.equal(w.pages, 4);
  assert.equal(w.truncated, true);
  assert.ok(logged.some((l) => /stopped at the 4-page cap/.test(l) && /MORE remaining/.test(l)));
});

// --- summarize -------------------------------------------------------------------

test("summarize: prints every count, including the zeros", () => {
  // "0 collected" is either fine or an emergency and the only way to tell them
  // apart is to look. A count that is only printed when it is interesting is a
  // count nobody can act on.
  const s = summarize({ collected: 0, files: 0, bytes: 0, present: 0, skipped: [], scanned: 0 });
  assert.match(s.line, /collected 0 capture\(s\), 0 file\(s\), 0 KB/);
  assert.match(s.line, /0 already present/);
  assert.match(s.line, /0 skipped/);
  assert.match(s.line, /0 capture artifact\(s\) scanned/);
  assert.equal(s.exitCode, 0);
});

test("summarize: a no-meta skip goes RED, and the reason is in the line", () => {
  // §9.3, and the behaviour on every capture that exists today. Before #673
  // lands this exits 1 on every run and says why — a collector correctly
  // refusing to guess, not a broken one. After it lands, the same non-zero means
  // a producer regressed.
  const s = summarize({ collected: 0, skipped: [{ reason: "no-meta" }, { reason: "no-meta" }], scanned: 2 });
  assert.equal(s.exitCode, 1);
  assert.equal(s.loudSkips, 2);
  assert.match(s.line, /2 skipped \(2 no-meta\)/);
});

test("summarize: a routine skip does NOT go red", () => {
  // `older-than-since` is the sweep doing its job. If every skip were loud the
  // exit code would be permanently 1 and would stop meaning anything.
  const s = summarize({ collected: 1, files: 6, bytes: 61440, skipped: [{ reason: "older-than-since" }], scanned: 2 });
  assert.equal(s.exitCode, 0);
  assert.match(s.line, /60 KB/);
  assert.equal(isLoudSkip("older-than-since"), false);
});

test("summarize: a dropped FILE is counted by reason, named in the line, and goes RED", () => {
  // Not only a log line. A file dropped by a cap, or one that could not be read
  // or written, is data that existed and was not collected — and the artifact
  // expires on schedule regardless. It is the same class of event as a skipped
  // capture, only smaller, so it gets the same exit code. Invariant F: no silent
  // truncation.
  const s = summarize({ collected: 1, files: 4, droppedFiles: [{ reason: "over-file-cap" }, { reason: "unparseable" }, { reason: "over-file-cap" }] });
  assert.match(s.line, /DROPPED 3 file\(s\) \(2 over-file-cap, 1 unparseable\)/);
  assert.equal(s.droppedFiles, 3);
  assert.equal(s.exitCode, 1);
  // And a run with none of them says nothing about drops and stays green.
  const clean = summarize({ collected: 1, files: 4, droppedFiles: [] });
  assert.equal(clean.exitCode, 0);
  assert.equal(/DROPPED/.test(clean.line), false);
});

test("summarize: an incomplete artifact walk goes red even with nothing skipped", () => {
  assert.equal(summarize({ walkFailed: "page 3: HTTP 502" }).exitCode, 1);
  assert.equal(summarize({ walkTruncated: true }).exitCode, 1);
});

test("summarize: a dry run says 'would collect', so a log cannot be misread", () => {
  assert.match(summarize({ collected: 3, dryRun: true }).line, /would collect 3 capture/);
  assert.match(summarize({ collected: 3 }).line, /collected 3 capture/);
});

// --- expiryReport ------------------------------------------------------------------

test("expiryReport: prints the uncollected count explicitly when it is ZERO", () => {
  // The residual risk in the design is "nobody notices it is broken". A zero
  // that is printed is a zero someone can question.
  const r = expiryReport([artifact()], runIdsFromKeys(["stage-detail/channel=advisory/pr=1/sha=aaaaaaaa/run=30886864158/attempt=1/meta.json"]), { now: NOW });
  assert.equal(r.uncollected.length, 0);
  assert.match(r.lines[0], /1 stage-detail artifact\(s\) known · 1 already collected · 0 UNCOLLECTED · 0 expired uncollected/);
  assert.match(r.lines[1], /0 uncollected\. Either everything is collected, or no review has run/);
  assert.equal(r.exitCode, 0);
});

test("expiryReport: an uncollected capture near expiry goes RED and is named", () => {
  const r = expiryReport([artifact({ expires_at: "2026-08-12T00:00:00Z" })], new Set(), { now: NOW, warnWithinDays: 14 });
  assert.equal(r.uncollected.length, 1);
  assert.equal(r.urgent.length, 1);
  assert.equal(r.soonest, 6);
  assert.equal(r.exitCode, 1);
  assert.ok(r.lines.some((l) => /run 30886864158 .* expires 2026-08-12T00:00:00Z — 6 day\(s\) left/.test(l)));
});

test("expiryReport: comfortably distant expiries are counted but not red", () => {
  const r = expiryReport([artifact({ expires_at: "2026-11-01T00:00:00Z" })], new Set(), { now: NOW, warnWithinDays: 14 });
  assert.equal(r.uncollected.length, 1);
  assert.equal(r.urgent.length, 0);
  assert.equal(r.exitCode, 0);
  assert.match(r.lines[1], /soonest uncollected expiry in 87 day\(s\); 0 within 14 day\(s\)/);
});

test("expiryReport: an unreadable expiry counts as URGENT, never as far away", () => {
  const r = expiryReport([artifact({ expires_at: null })], new Set(), { now: NOW });
  assert.equal(r.urgent.length, 1);
  assert.equal(r.exitCode, 1);
});

test("expiryReport: an already-expired uncollected artifact says the data is GONE", () => {
  const r = expiryReport([artifact({ expired: true })], new Set(), { now: NOW });
  assert.equal(r.alreadyExpired.length, 1);
  assert.equal(r.uncollected.length, 0, "it cannot be collected any more, so it is not pending work");
  assert.ok(r.lines.some((l) => /have ALREADY expired uncollected — that data is gone/.test(l)));
  assert.equal(r.exitCode, 1);
});

test("expiryReport: ignores everything that is not a stage-detail artifact", () => {
  const r = expiryReport([artifact({ name: "harness-reports" }), artifact({ name: "review-panel-execution" })], new Set(), { now: NOW });
  assert.equal(r.total, 0);
  assert.equal(r.exitCode, 0);
});

// --- the real captures, as fixtures ------------------------------------------------

/**
 * The nine live stage-detail artifacts, as measured on the GitHub API and in the
 * rescued local copies on 2026-08-05. Only what the collector actually consumes
 * is reproduced — artifact metadata and zip ENTRY NAMES — because the collector
 * is content-blind by design; it never reads inside a `stage-detail.json` beyond
 * checking that it parses. That is also why 944 KB of real capture payload does
 * not need to live in this repository to test this code.
 *
 * `lane` records whether that capture's payload carries #668's lane field: seven
 * do, the two oldest predate the merge and do not. It is asserted on below for
 * exactly one reason — to prove it makes no difference.
 */
const REAL_CAPTURES = [
  { id: 8883738002, runId: 30886864158, created: "2026-08-04T07:25:05Z", expires: "2026-09-03T07:25:04Z", size: 18252, lane: false, lenses: ["blast-radius", "correctness", "design-fit", "security", "test-adequacy"] },
  { id: 8883891947, runId: 30887069068, created: "2026-08-04T07:31:15Z", expires: "2026-09-03T07:31:15Z", size: 29161, lane: false, lenses: ["blast-radius", "correctness", "design-fit", "security", "test-adequacy"] },
  { id: 8884706412, runId: 30889625585, created: "2026-08-04T08:01:47Z", expires: "2026-09-03T08:01:46Z", size: 10341, lane: true, lenses: ["blast-radius", "correctness", "design-fit", "security", "test-adequacy"] },
  { id: 8885722640, runId: 30891782298, created: "2026-08-04T08:37:51Z", expires: "2026-09-03T08:37:51Z", size: 35229, lane: true, lenses: ["blast-radius", "correctness", "design-fit", "docs", "security", "test-adequacy"] },
  { id: 8885756944, runId: 30891940585, created: "2026-08-04T08:39:04Z", expires: "2026-09-03T08:39:03Z", size: 26708, lane: true, lenses: ["blast-radius", "correctness", "design-fit", "docs", "security", "test-adequacy"] },
  { id: 8900488876, runId: 30928076920, created: "2026-08-04T16:30:18Z", expires: "2026-09-03T16:30:17Z", size: 26529, lane: true, lenses: ["blast-radius", "correctness", "design-fit", "docs", "security", "test-adequacy"] },
  { id: 8915448730, runId: 30967262124, created: "2026-08-05T01:58:06Z", expires: "2026-09-04T01:58:06Z", size: 29469, lane: true, lenses: ["blast-radius", "correctness", "design-fit", "docs", "security", "test-adequacy"] },
  { id: 8915462583, runId: 30967268504, created: "2026-08-05T01:58:53Z", expires: "2026-09-04T01:58:52Z", size: 37130, lane: true, lenses: ["blast-radius", "correctness", "design-fit", "docs", "security", "test-adequacy"] },
  { id: 8916035419, runId: 30968985871, created: "2026-08-05T02:33:20Z", expires: "2026-09-04T02:33:19Z", size: 36225, lane: true, lenses: ["blast-radius", "correctness", "design-fit", "docs", "security", "test-adequacy"] },
];

const realArtifactList = () => REAL_CAPTURES.map((c) => ({
  id: c.id,
  name: CAPTURE_ARTIFACT_PREFIX,
  created_at: c.created,
  expires_at: c.expires,
  expired: false,
  size_in_bytes: c.size,
  workflow_run: { id: c.runId },
}));

/**
 * An `io` that serves a fixed entry list and payload per artifact id. No network,
 * no filesystem, no zip.
 */
function fakeIo(byId) {
  const reads = [];
  return {
    listPage: (page) => (page === 1 ? Object.values(byId).map((a) => a.artifact) : []),
    download: (id) => { if (!byId[id]) throw new Error(`no such artifact ${id}`); return `zip:${id}`; },
    entries: (zip) => byId[zip.slice(4)].entries,
    read: (zip, name) => {
      reads.push(`${zip}:${name}`);
      const payload = byId[zip.slice(4)].payload[name];
      if (payload === undefined) throw new Error(`entry ${name} is unreadable`);
      return Buffer.from(payload);
    },
    cleanup: () => {},
    reads,
  };
}

/** Every real capture, with no `meta.json` — which is the state all nine are in. */
function realIo() {
  const byId = {};
  for (const c of REAL_CAPTURES) {
    const entries = c.lenses.map((l) => `${l}/stage-detail.json`);
    const payload = Object.fromEntries(entries.map((e) => [e, JSON.stringify({
      lensDiffSha256: "6a3f1fb9bb5e5ba77291f4de8766fef681311e5bdd82e40157cbcd2428d53c39",
      samples: [[]],
      // The one payload difference between the two generations of capture.
      ...(c.lane ? { verified: [{ lane: "blocking" }] } : { verified: [{}] }),
    })]));
    byId[String(c.id)] = { artifact: realArtifactList().find((a) => a.id === c.id), entries, payload };
  }
  return { byId, io: fakeIo(byId) };
}

test("the nine real captures: ALL nine are skipped, counted, and NOT an alarm", () => {
  // The honest first result against real data, and the best available test of
  // "attribution is never inferred". Every one of these carries the file paths
  // its lenses reviewed, which a human has in fact used to attribute seven of
  // them by hand. The collector has the same information and refuses to use it:
  // a capture filed against the wrong PR corrupts the corpus in a way no later
  // check would notice, whereas a missing one is visible.
  //
  // WHAT CHANGED, AND WHY, because this test used to assert `exitCode === 1`.
  // These nine still cannot be collected — that part is unchanged and is the
  // point above. But they made the job go RED on every run for as long as they
  // sat inside the seven-day window, and "history exists" is not news: the first
  // live collector run (30988338870) collected 11 real files and still reported
  // failure, purely because of these. A red X that fires on a healthy run is a
  // signal that gets ignored, and an ignored signal is how this subsystem lost
  // five rounds of uploads to "No files were found". So the skip is now
  // `no-meta-legacy`: still refused, still counted BY NAME in the line below,
  // still listed as uncollected by the expiry report, and no longer an alarm.
  const { io } = realIo();
  const store = createCaptureStore(path.join(tmpdir(), `collect-test-unused-${process.pid}`));
  const logs = [];
  const { summary, skipped } = collect({ io, store, since: new Date("2026-08-01T00:00:00Z"), now: NOW, dryRun: true, log: (m) => logs.push(m) });

  assert.equal(skipped.length, 9);
  assert.deepEqual([...new Set(skipped.map((s) => s.reason))], ["no-meta-legacy"]);
  assert.match(summary.line, /would collect 0 capture\(s\), 0 file\(s\), 0 KB/);
  assert.match(summary.line, /9 skipped \(9 no-meta-legacy\)/);
  assert.match(summary.line, /9 capture artifact\(s\) scanned/);
  assert.equal(summary.exitCode, 0, "nine pre-#673 captures are the expected state of history, not a producer regression");
  assert.equal(store.listCaptures().length, 0, "and quiet must not mean collected — nothing was guessed");
  assert.equal(existsSync(path.join(tmpdir(), `collect-test-unused-${process.pid}`)), false, "a refusal must not create the store");
  // The skip names the PR it could have guessed at — nowhere. It names what is
  // missing, why it is missing, and that the window to recover it is finite.
  assert.ok(logs.some((l) => /no-meta-legacy: 5 lens file\(s\), uploaded before #673/.test(l)));
  assert.ok(logs.some((l) => /no-meta-legacy: 6 lens file\(s\), uploaded before #673/.test(l)));
  assert.ok(logs.some((l) => /recoverable only by hand, and only until it expires/.test(l)));
});

test("the two pre-#668 captures are treated EXACTLY like the seven that carry a lane", () => {
  // The collector is a mover. It parses a lens payload to check that it parses
  // and throws the result away, so a capture from before #668 and one from after
  // take the same path. If this ever diverges, something started reading the
  // payload — which is the scorer's job and a different PR.
  const { byId, io } = realIo();
  const withLane = REAL_CAPTURES.find((c) => c.lane);
  const withoutLane = REAL_CAPTURES.find((c) => !c.lane);
  const a = prepareArtifact({ id: String(withLane.id), name: CAPTURE_ARTIFACT_PREFIX, runId: withLane.runId }, io);
  const b = prepareArtifact({ id: String(withoutLane.id), name: CAPTURE_ARTIFACT_PREFIX, runId: withoutLane.runId }, io);
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal(a.reason, b.reason);
  assert.equal(a.reason, "no-meta-legacy");
  // And the payloads really did differ, or this test proves nothing.
  const laneText = byId[String(withLane.id)].payload[`${withLane.lenses[0]}/stage-detail.json`];
  const plainText = byId[String(withoutLane.id)].payload[`${withoutLane.lenses[0]}/stage-detail.json`];
  assert.ok(laneText.includes('"lane"') && !plainText.includes('"lane"'));
});

test("the real artifact list: the expiry warning counts nine uncollected and goes red", () => {
  // Measured expiries: every live capture dies 2026-09-03 or 2026-09-04, and
  // `expires_at` is fixed at upload, so #673's retention bump cannot move them.
  const r = expiryReport(realArtifactList(), new Set(), { now: new Date("2026-08-25T00:00:00Z"), warnWithinDays: 14 });
  assert.equal(r.total, 9);
  assert.equal(r.uncollected.length, 9);
  assert.equal(r.urgent.length, 9);
  assert.equal(r.soonest, 9);
  assert.equal(r.exitCode, 1);
  // And with two of them collected, the count moves — the store's keys are the
  // only input that changes.
  const collected = runIdsFromKeys([
    `stage-detail/channel=advisory/pr=666/sha=aaaaaaaa/run=${REAL_CAPTURES[0].runId}/attempt=1/meta.json`,
    `stage-detail/channel=advisory/pr=665/sha=bbbbbbbb/run=${REAL_CAPTURES[1].runId}/attempt=1/meta.json`,
  ]);
  assert.equal(expiryReport(realArtifactList(), collected, { now: NOW }).uncollected.length, 7);
});

// --- prepareArtifact -----------------------------------------------------------------

/** One healthy #673-shaped artifact. */
function healthyIo(over = {}) {
  const meta = { ...META, ...over };
  const entries = ["meta.json", ...meta.lenses.map((l) => `${l}/stage-detail.json`)];
  const payload = { "meta.json": JSON.stringify(meta) };
  for (const l of meta.lenses) payload[`${l}/stage-detail.json`] = JSON.stringify({ lens: l, samples: [[]] });
  const byId = { "77": { artifact: artifact({ id: 77, workflow_run: { id: meta.runId } }), entries, payload } };
  return { meta, byId, io: fakeIo(byId) };
}

const A77 = { id: "77", name: "review-panel-stage-detail-pr-669", runId: META.runId };

test("prepareArtifact: a healthy capture yields one file per lens, then meta.json LAST", () => {
  // The ordering is load-bearing, not incidental. The writes are separate
  // operations and a crash can land between any two, so `meta.json` written last
  // makes its presence in the store mean "this capture is complete as
  // collected". Written first, an interrupted run leaves an attributed capture
  // with some or none of its lens files and nothing distinguishes that from a
  // review that genuinely produced fewer. It is the same rule the producer holds
  // on the way out, where #673 writes no meta.json unless a lens captured.
  const { io } = healthyIo();
  const r = prepareArtifact(A77, io);
  assert.equal(r.ok, true);
  assert.equal(r.files.length, 6);
  assert.equal(r.lensCount, 5);
  assert.equal(r.files.at(-1).key, "stage-detail/channel=advisory/pr=669/sha=c18b6abb/run=30889625585/attempt=1/meta.json");
  assert.ok(r.files.slice(0, -1).every((f) => f.lens !== null), "every file before it is a lens");
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.droppedFiles, []);
});

test("prepareArtifact: meta.json is stored VERBATIM, byte for byte", () => {
  // Re-serialising `parseMeta`'s output would silently drop any field a future
  // producer added, and this file is the corpus's whole record of provenance.
  const raw = JSON.stringify({ ...META, provenance: "manual-backfill", futureField: 42 });
  const byId = { "77": { artifact: artifact({ id: 77 }), entries: ["meta.json", "correctness/stage-detail.json"], payload: { "meta.json": raw, "correctness/stage-detail.json": "{}" } } };
  const r = prepareArtifact({ id: "77", name: "x", runId: META.runId }, fakeIo(byId));
  assert.equal(r.ok, true);
  assert.equal(String(r.files.at(-1).bytes), raw);
  assert.match(String(r.files.at(-1).bytes), /manual-backfill/);
});

test("prepareArtifact: no meta.json → skipped, and NOTHING is inferred", () => {
  const byId = { "77": { artifact: artifact({ id: 77 }), entries: ["correctness/stage-detail.json"], payload: { "correctness/stage-detail.json": "{}" } } };
  const r = prepareArtifact({ id: "77", name: "x", runId: null }, fakeIo(byId));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-meta");
});

test("prepareArtifact: a malformed meta.json is skipped, naming the field", () => {
  const byId = { "77": { artifact: artifact({ id: 77 }), entries: ["meta.json", "correctness/stage-detail.json"], payload: { "meta.json": JSON.stringify({ ...META, pr: "../../evil" }), "correctness/stage-detail.json": "{}" } } };
  const r = prepareArtifact({ id: "77", name: "x", runId: META.runId }, fakeIo(byId));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-meta");
  assert.match(r.detail, /pr must be a positive integer/);
});

test("prepareArtifact: meta.json claiming a DIFFERENT run than the artifact is refused", () => {
  // The list says which run produced the artifact; `meta.json` says which run
  // wrote the capture. A mismatch means the key would be built from the wrong
  // one of the two, and one of them is a lie.
  const { io } = healthyIo();
  const r = prepareArtifact({ ...A77, runId: 99999999 }, io);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bad-meta");
  assert.match(r.detail, /does not match the artifact's run 99999999/);
});

test("prepareArtifact: a hostile entry name condemns the WHOLE artifact", () => {
  // Not just that entry. A zip carrying `../../etc/passwd` is not a capture with
  // a typo; nothing else in it is trustworthy either.
  const byId = { "77": { artifact: artifact({ id: 77 }), entries: ["meta.json", "../../etc/passwd", "correctness/stage-detail.json"], payload: { "meta.json": JSON.stringify(META), "correctness/stage-detail.json": "{}" } } };
  const io = fakeIo(byId);
  const r = prepareArtifact({ id: "77", name: "x", runId: META.runId }, io);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unsafe-entries");
  assert.match(r.detail, /path-traversal:\.\.\/\.\.\/etc\/passwd/);
  assert.deepEqual(io.reads, [], "and not one byte was read out of it");
});

test("prepareArtifact: ONE unreadable lens file never discards its healthy siblings", () => {
  // Invariant D, per file. `writeStageDetail` swallows its own errors by design,
  // so a truncated file is genuinely possible and it must cost one lens, not
  // five.
  const { io, byId } = healthyIo();
  delete byId["77"].payload["security/stage-detail.json"];
  byId["77"].payload["correctness/stage-detail.json"] = "{ truncated but not clo";
  const logs = [];
  const r = prepareArtifact(A77, io, { log: (m) => logs.push(m) });
  assert.equal(r.ok, true);
  assert.equal(r.files.length, 4, "meta.json plus the three healthy lenses");
  assert.deepEqual(r.droppedFiles.map((d) => `${d.name}:${d.reason}`).sort(), [
    "correctness/stage-detail.json:unparseable",
    "security/stage-detail.json:unreadable",
  ]);
  assert.deepEqual(r.missing.sort(), ["correctness", "security"]);
  assert.ok(logs.some((l) => /DROPPED correctness\/stage-detail\.json \(unparseable/.test(l)));
});

test("prepareArtifact: fewer lens files than meta.json lists is RECORDED, not fatal", () => {
  // Partial data with a known gap is still data. The gap reaches the summary.
  const { io, byId } = healthyIo();
  byId["77"].entries = ["meta.json", "correctness/stage-detail.json"];
  const r = prepareArtifact(A77, io);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, ["blast-radius", "design-fit", "security", "test-adequacy"]);
});

test("prepareArtifact: attribution with NO lens file at all is refused", () => {
  // #673's producer cannot emit this — it writes no meta.json when no lens
  // captured — so seeing it means something else assembled the artifact.
  const byId = { "77": { artifact: artifact({ id: 77 }), entries: ["meta.json"], payload: { "meta.json": JSON.stringify(META) } } };
  const r = prepareArtifact({ id: "77", name: "x", runId: META.runId }, fakeIo(byId));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-lens-files");
  assert.equal(isLoudSkip("no-lens-files"), true);
});

test("prepareArtifact: the per-file cap drops the excess and NAMES every file it dropped", () => {
  const lenses = Array.from({ length: MAX_FILES_PER_ARTIFACT + 3 }, (_, i) => `lens-${i}`);
  const { io } = healthyIo({ lenses });
  const logs = [];
  const r = prepareArtifact(A77, io, { log: (m) => logs.push(m) });
  assert.equal(r.ok, true);
  assert.equal(r.files.length, MAX_FILES_PER_ARTIFACT + 1, "the cap, plus meta.json");
  assert.equal(r.droppedFiles.filter((d) => d.reason === "over-file-cap").length, 3);
  assert.equal(logs.filter((l) => /over-file-cap/.test(l)).length, 3);
});

test("prepareArtifact: an oversized lens file is dropped with its exact size", () => {
  // `STAGE_DETAIL_DIFF_CONTENT` turns captures from KBs into MBs. The cap keeps
  // the collector honest and says what it left behind.
  const { io, byId } = healthyIo();
  byId["77"].payload["security/stage-detail.json"] = JSON.stringify({ pad: "x".repeat(5000) });
  const logs = [];
  const r = prepareArtifact(A77, io, { maxBytes: 1000, log: (m) => logs.push(m) });
  assert.equal(r.files.length, 5);
  assert.ok(logs.some((l) => /DROPPED security\/stage-detail\.json \(too-large: 5\d{3} bytes > 1000\)/.test(l)));
});

test("prepareArtifact: a download failure costs that artifact and nothing else", () => {
  const io = fakeIo({});
  const r = prepareArtifact({ id: "404", name: "x", runId: 1 }, io);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "download-failed");
  assert.equal(isLoudSkip("download-failed"), true);
});

// --- collect(), end to end against a real store ---------------------------------------

test("collect: a dry run writes NOTHING, then --write writes, then a re-run is a no-op", () => {
  // The idempotence story in one test: the key names one execution, so the
  // second pass is "already present" rather than a second copy. That is what
  // makes retrying, racing and re-scanning the same harmless operation.
  const root = mkdtempSync(path.join(tmpdir(), "collect-e2e-"));
  try {
    const store = createCaptureStore(root);
    const { io } = healthyIo();

    const dry = collect({ io, store, since: null, now: NOW, dryRun: true, log: () => {} });
    assert.match(dry.summary.line, /would collect 1 capture\(s\), 6 file\(s\)/);
    assert.equal(dry.summary.exitCode, 0);
    assert.deepEqual(store.listCaptures(), [], "a dry run must not touch the store");

    const wet = collect({ io, store, since: null, now: NOW, dryRun: false, log: () => {} });
    assert.match(wet.summary.line, /collected 1 capture\(s\), 6 file\(s\)/);
    const keys = store.listCaptures();
    const prefix = "stage-detail/channel=advisory/pr=669/sha=c18b6abb/run=30889625585/attempt=1/";
    assert.equal(keys.length, 6);
    assert.ok(keys.every((k) => k.startsWith(prefix)));
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(root, ...`${prefix}meta.json`.split("/")), "utf8")).schema,
      CAPTURE_META_SCHEMA,
    );

    const again = collect({ io, store, since: null, now: NOW, dryRun: false, log: () => {} });
    assert.match(again.summary.line, /collected 0 capture\(s\), 0 file\(s\), 0 KB · 6 already present/);
    assert.equal(again.summary.exitCode, 0);
    assert.equal(store.listCaptures().length, 6, "and not one duplicate");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("collect: one poisoned artifact does not stop the healthy one beside it", () => {
  // Invariant D, per artifact. A batch that fails whole on the first bad capture
  // is a batch that collects nothing on the day one producer regresses.
  const root = mkdtempSync(path.join(tmpdir(), "collect-isolation-"));
  try {
    const { byId } = healthyIo();
    // A CURRENT-generation name, deliberately. The poison being tested is "a
    // capture the collector must refuse", and the refusal that has to stay loud
    // is a live producer shipping no `meta.json`. The default `artifact()` name is
    // the bare pre-#673 stem, which is now a quiet skip — using it here would
    // have made this test assert isolation while silently no longer asserting
    // that the run goes red.
    byId["66"] = { artifact: artifact({ id: 66, name: "review-panel-stage-detail-pr-671", workflow_run: { id: 30886864158 } }), entries: ["correctness/stage-detail.json"], payload: { "correctness/stage-detail.json": "{}" } };
    const io = fakeIo(byId);
    const store = createCaptureStore(root);
    const { summary, skipped } = collect({ io, store, since: null, now: NOW, dryRun: false, log: () => {} });
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].reason, "no-meta");
    assert.equal(store.listCaptures().length, 6, "the healthy capture landed in full");
    assert.equal(summary.exitCode, 1, "and the run still goes red for the one it refused");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("collect: ONE failed WRITE does not discard the artifacts queued behind it", () => {
  // Per-artifact isolation on the write side, not only the read side. A full
  // disk, a read-only checkout or a key the store refuses are all reasons to lose
  // one file — none of them is a reason to abandon the captures that come after
  // it. The artifacts have a deadline and the disk does not, so the batch keeps
  // going and the run goes red.
  const { byId } = healthyIo();
  const second = { ...META, pr: 648, channel: "gating", workflow: "agent-review-panel.yml", event: "workflow_run", runId: 30891782298, lenses: ["correctness"] };
  byId["88"] = {
    artifact: artifact({ id: 88, workflow_run: { id: second.runId } }),
    entries: ["meta.json", "correctness/stage-detail.json"],
    payload: { "meta.json": JSON.stringify(second), "correctness/stage-detail.json": "{}" },
  };
  const written = [];
  const store = {
    hasCapture: (k) => written.includes(k),
    putCapture: (k, _bytes) => {
      if (k.includes("pr=669")) throw new Error("ENOSPC: no space left on device");
      written.push(k);
      return "written";
    },
    listCaptures: () => [...written].sort(),
  };
  const logs = [];
  const { summary, droppedFiles } = collect({ io: fakeIo(byId), store, since: null, now: NOW, dryRun: false, log: (m) => logs.push(m) });

  assert.equal(written.length, 2, "PR 648's capture landed in full after PR 669's writes all failed");
  assert.ok(written.every((k) => k.includes("pr=648")));
  assert.equal(droppedFiles.filter((d) => d.reason === "write-failed").length, 6);
  assert.equal(summary.exitCode, 1, "and the failure is red, not swallowed");
  assert.ok(logs.some((l) => /could NOT write .*pr=669.* ENOSPC/.test(l)));
});

// --- the contract with the producer, and with the workflow ---------------------------

test("what the producer WRITES survives what this consumer validates", async () => {
  // The contract, end to end and with no fixture in the middle: #673's real
  // `buildCaptureMeta` output goes straight into `parseMeta`, and the key is
  // built from the result.
  //
  // The three constants are imported from `capture-meta.mjs` rather than
  // restated, so they cannot drift and need no test. The VALIDATORS are separate
  // implementations on purpose — a consumer that reused the producer's validator
  // could not detect a producer that validates wrongly, and this one also has to
  // accept a hand-written backfill `meta.json` that never went through
  // `buildCaptureMeta`. Two implementations of one contract need a test that
  // crosses between them, and this is it.
  const producer = await import("./vendor/pipeline/capture-meta.mjs");
  for (const [channel, workflow, event] of [
    ["advisory", "agent-review-on-demand.yml", "issue_comment"],
    ["gating", "agent-review-panel.yml", "workflow_run"],
  ]) {
    const built = producer.buildCaptureMeta({
      pr: 669, headSha: META.headSha, baseSha: META.baseSha, channel, workflow,
      runId: 30889625585, runAttempt: 1, event, panelSha: META.panelSha,
      lenses: META.lenses, capturedAt: "2026-08-04T07:53:22Z",
    });
    const parsed = parseMeta(JSON.stringify(built));
    assert.equal(parsed.pr, 669);
    assert.equal(parsed.channel, channel);
    assert.equal(keyFor(parsed, "correctness"), `stage-detail/channel=${channel}/pr=669/sha=c18b6abb/run=30889625585/attempt=1/correctness.json`);
  }
  // The producer's own no-diff-base case, which is a `null` and not a refusal.
  const noBase = producer.buildCaptureMeta({
    pr: 1, headSha: META.headSha, baseSha: "", channel: "gating",
    workflow: "agent-review-panel.yml", runId: 1, runAttempt: 1,
    event: "workflow_run", panelSha: META.panelSha, lenses: ["correctness"],
    capturedAt: "2026-08-04T07:53:22Z",
  });
  assert.equal(parseMeta(JSON.stringify(noBase)).baseSha, null);
});

test("the artifact name prefix matches what both producers upload", () => {
  // Read out of the real workflows, comments stripped — these files carry more
  // prose than YAML and both name the artifact inside a comment block, so a
  // whole-file grep would answer out of the explanation. Same trap #630, #640
  // and #651 each hit.
  //
  // The name is NOT a bare literal — #673 made it
  // `review-panel-stage-detail-pr-${{ steps.pr.outputs.number }}`, and a `${{ }}`
  // expression contains SPACES. The first version of this parser stopped at the
  // first space and found zero producers, which is how the interpolation was
  // noticed at all: the collector matches this artifact by PREFIX precisely
  // because the suffix is a runtime value, and a test that only recognised
  // literal names would have gone quiet on the change it exists to watch. So the
  // rest of the line is captured whole and only the prefix is asserted.
  const dir = path.join(HERE, "..", "..", ".github", "workflows");
  const names = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
    for (const line of readFileSync(path.join(dir, file), "utf8").split("\n")) {
      if (/^\s*#/.test(line)) continue;
      const m = /^\s*name:\s*(review-panel-stage-detail.*?)\s*$/.exec(line);
      if (m) names.push(m[1]);
    }
  }
  assert.equal(names.length, 2, `expected both producers to upload a stage-detail artifact, found ${names.length}`);
  for (const n of names) {
    assert.ok(n.startsWith(CAPTURE_ARTIFACT_PREFIX), `${n} does not start with the prefix the collector matches on`);
    // Whatever follows the prefix must be the `-pr-<n>` form the collector treats
    // as known — a literal suffix, or an expression that expands to one. Anything
    // else is still collected (the collector fails toward collecting) but it
    // should be a deliberate decision rather than a silent drift.
    assert.match(n, /^review-panel-stage-detail(?:-pr-(?:\$\{\{[^}]*\}\}|[1-9][0-9]*))?$/, `${n} is neither the bare name nor the -pr-<n> form`);
  }
});

test("the collector workflow has NO write scope on THIS repository", () => {
  // The load-bearing property of the whole design, and the reason the collector
  // is allowed to run in CI at all. It writes to a DIFFERENT repository, using a
  // fine-grained token scoped to that one repository — so this workflow's own
  // `GITHUB_TOKEN` stays exactly as powerless as it was before the file existed,
  // and the boundary #641 refused to cross for this subsystem is intact.
  //
  // Comments are stripped first. This file explains the permission model in
  // prose and names `contents: write` several times while saying it does NOT
  // have it; a whole-file grep would answer out of the explanation. Same trap
  // #630, #640 and #651 each hit.
  const file = path.join(HERE, "..", "..", ".github", "workflows", "capture-collect.yml");
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*#/.test(l));
  const at = lines.findIndex((l) => /^permissions:\s*$/.test(l));
  assert.ok(at >= 0, "the workflow must declare a top-level permissions block");
  const block = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (!/^\s+\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  assert.deepEqual(
    block.map((l) => l.trim().replace(/\s*#.*$/, "")).sort(),
    ["actions: read", "contents: read"],
  );
  // Belt and braces: no write scope anywhere in the YAML, including a job-level
  // block that would override the one above, and no `id-token: write` (there is
  // no cloud credential to mint yet — that arrives with S3 or not at all).
  const yamlOnly = lines.join("\n");
  assert.equal(/:\s*write\b/.test(yamlOnly), false, `a write scope appears in ${path.basename(file)}`);

  // The write it DOES perform must be aimed somewhere else, and must be the
  // scoped secret rather than the ambient token. A checkout of another repo with
  // `token: ${{ github.token }}` would not even work, but a future edit that
  // dropped `repository:` would quietly turn this into a job that commits to
  // wafflebase — which is the one outcome the permission block cannot prevent,
  // because `actions/checkout` of THIS repo plus a push is not a permissions
  // question until the push fails.
  assert.match(yamlOnly, /repository:\s*['"]?dlgpdmsly2\/wafflebase-agent-eval/, "the store checkout must name the other repository");
  assert.match(yamlOnly, /token:\s*\$\{\{\s*secrets\.EVAL_STORE_TOKEN\s*\}\}/, "the store checkout must use the scoped secret");
  // Located with the SAME matcher the assertion above uses, not by splitting on a
  // literal. `repository: "dlgpdmsly2/…"` with quotes, or extra spacing, would
  // make a literal split miss and turn this into an assertion about the whole
  // file — it would fail rather than pass vacuously, but it would fail for the
  // wrong reason and send someone hunting the wrong line.
  const checkoutAt = yamlOnly.search(/repository:\s*['"]?dlgpdmsly2\/wafflebase-agent-eval/);
  assert.ok(checkoutAt > 0, "could not locate the store checkout");
  assert.equal(
    /secrets\.EVAL_STORE_TOKEN/.test(yamlOnly.slice(0, checkoutAt)),
    false,
    "the scoped token must not be used before the store checkout — nothing else may borrow it",
  );

  // And the collector is invoked with an explicit --root, because there is no
  // default and a forgotten one is a usage error rather than a write into this
  // repository.
  assert.match(yamlOnly, /--root \.capture-store\/captures/);
  assert.match(yamlOnly, /collect-captures\.mjs \\\n\s*--write/, "the collect step must pass --write");
  assert.match(yamlOnly, /collect-captures\.mjs expiry/, "the run must still print the uncollected count");
});

test("the steps after Collect run even when Collect FAILS", () => {
  // Not style. The collector exits NON-ZERO whenever a capture was skipped for a
  // reason that should not happen — the monitor working as designed, and the
  // normal outcome on any run that meets one unattributable capture. A failed
  // step skips every later step by default, so without these conditions a run
  // that collected five captures and refused a sixth would write all five into
  // the working tree and commit NONE of them: loud partial success discarded by
  // its own alarm.
  //
  // `!cancelled()` and not `always()`: run on success and failure, never on
  // cancellation. There is no reason to push from a run somebody stopped.
  const file = path.join(HERE, "..", "..", ".github", "workflows", "capture-collect.yml");
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*#/.test(l));

  // Walk the steps in order so the assertion is about POSITION, not just presence:
  // every named step after the collect step needs the condition.
  const named = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*-?\s*name:\s*(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    // The step's `if:` sits in the same block, before the next `- name:`.
    let cond = null;
    for (let j = i + 1; j < lines.length && !/^\s*-\s+(name|uses):/.test(lines[j]); j++) {
      const c = /^\s*if:\s*(.+?)\s*$/.exec(lines[j]);
      if (c) { cond = c[1]; break; }
    }
    named.push({ name: m[1], cond });
  }
  const collectAt = named.findIndex((s) => s.name === "Collect");
  assert.ok(collectAt >= 0, `could not find the Collect step among ${JSON.stringify(named.map((s) => s.name))}`);
  const after = named.slice(collectAt + 1);
  assert.ok(after.length >= 2, "expected at least the commit and report steps after Collect");
  for (const s of after) {
    assert.equal(s.cond, "${{ !cancelled() }}", `step "${s.name}" runs after Collect and must carry if: !cancelled()`);
  }
});

test("a missing meta.json is QUIET for a pre-#673 name and LOUD for anything else", () => {
  // The whole rule, in one table. `no-meta` must keep meaning "a producer
  // regressed", which it stopped meaning while the ten pre-#673 captures were in
  // the window — every run went red and the red said nothing.
  //
  // The discriminator is the artifact NAME and not a cutoff date, because #673
  // changed both things in one commit: it started writing `meta.json` AND renamed
  // the artifact to `-pr-<n>`. Same upload step, same file, same merge — so the
  // name reads which producer ran rather than approximating when it ran, and it
  // cannot be confused by a run that was in flight across the merge.
  assert.equal(isLegacyArtifactName("review-panel-stage-detail"), true);
  assert.equal(isLegacyArtifactName(CAPTURE_ARTIFACT_PREFIX), true, "the bare prefix IS the legacy name");
  // Everything else owes a meta.json. The `-pr-` forms are current producers; the
  // last three are drift, and drift must be loud rather than excused — a name
  // nobody recognises is not evidence that a capture is old.
  for (const current of [
    "review-panel-stage-detail-pr-674",
    "review-panel-stage-detail-pr-1",
    "review-panel-stage-detail-pr-",      // an empty `${{ }}` expansion
    "review-panel-stage-detail-v2",
    "review-panel-stage-detail-",
  ]) {
    assert.equal(isLegacyArtifactName(current), false, `${current} must still owe a meta.json`);
  }
  // And non-strings cannot sneak through as "legacy" via coercion.
  for (const bad of [null, undefined, 0, {}, ["review-panel-stage-detail"]]) {
    assert.equal(isLegacyArtifactName(bad), false, `${JSON.stringify(bad)} is not the legacy name`);
  }

  // The classification the exit code reads.
  assert.equal(isLoudSkip("no-meta"), true, "a current producer with no meta.json is a regression");
  assert.equal(isLoudSkip("no-meta-legacy"), false, "history existing is not a regression");
});

test("the two skips are told apart by the artifact NAME, end to end", () => {
  // Not just the predicate: the reason string `prepareArtifact` actually returns,
  // for two artifacts whose zips are byte-identical and differ only in name. If
  // these ever collapse back into one reason, either the alarm returns to firing
  // on history or a real regression goes quiet.
  const entries = ["correctness/stage-detail.json"];
  const payload = { "correctness/stage-detail.json": "{}" };
  const byId = {
    "1": { artifact: artifact({ id: 1, name: CAPTURE_ARTIFACT_PREFIX }), entries, payload },
    "2": { artifact: artifact({ id: 2, name: "review-panel-stage-detail-pr-674" }), entries, payload },
  };
  const io = fakeIo(byId);
  const legacy = prepareArtifact({ id: "1", name: CAPTURE_ARTIFACT_PREFIX, runId: 1 }, io);
  const current = prepareArtifact({ id: "2", name: "review-panel-stage-detail-pr-674", runId: 1 }, io);

  assert.equal(legacy.ok, false);
  assert.equal(current.ok, false, "neither is collected — the collector still refuses to guess");
  assert.equal(legacy.reason, "no-meta-legacy");
  assert.equal(current.reason, "no-meta");
  // One run containing both is RED, and names both counts. The quiet skip must
  // not mask the loud one sitting beside it.
  const s = summarize({ collected: 0, skipped: [legacy, current], scanned: 2 });
  assert.equal(s.exitCode, 1);
  assert.match(s.line, /2 skipped \(1 no-meta, 1 no-meta-legacy\)/);
});

test("the collect step's window is an INPUT on a manual run and 7 everywhere else", () => {
  // Recovery, and the reason it is worth a workflow input at all: a capture older
  // than the routine seven-day window is invisible to every automatic run while
  // still existing in Actions for up to 90 days. Without this the recovery path is
  // "edit the file, get it reviewed, merge it" — ceremony that lands exactly when
  // someone is trying to rescue data before it expires.
  const yamlOnly = readFileSync(path.join(HERE, "..", "..", ".github", "workflows", "capture-collect.yml"), "utf8")
    .split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  assert.match(yamlOnly, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+days:/, "the manual trigger must take a days input");
  assert.match(yamlOnly, /DAYS: \$\{\{ inputs\.days \|\| '7' \}\}/, "and default to 7 on triggers that supply no input");
  // Through the environment, quoted, and NEVER interpolated into the script body.
  // A dispatch input needs write access to set, so this is not the untrusted-input
  // case — but `${{ }}` inside a `run:` block is how that bug is written, and the
  // rest of this file already passes every event-derived value by env.
  assert.match(yamlOnly, /--days "\$DAYS"/, "the collector must read the window from the environment");

  // Read exactly once, into the env, and nowhere else.
  assert.deepEqual(
    yamlOnly.match(/\$\{\{[^}]*inputs\.[^}]*\}\}/g),
    ["${{ inputs.days || '7' }}"],
    "the dispatch input may be read once, into the environment",
  );

  // And NO `${{ }}` of any kind inside a shell body — not just this input. That is
  // the general form of the bug: an expression is expanded by the runner before the
  // shell ever sees it, so a value containing a quote or a `;` becomes script
  // rather than data. Scanned block by block, because a whole-file regex for
  // `run:` matches inside `workflow_run:` — which is how the first version of this
  // assertion passed for the wrong reason.
  const lines = yamlOnly.split("\n");
  let indent = null;
  for (const line of lines) {
    const opens = /^(\s*)run:\s*\|/.exec(line);
    if (opens) { indent = opens[1].length; continue; }
    if (indent === null) continue;
    if (line.trim() === "") continue;
    if (/^\s*/.exec(line)[0].length <= indent) { indent = null; continue; }
    assert.equal(/\$\{\{/.test(line), false, `a run: body interpolates an expression: ${line.trim()}`);
  }
});

test("the collector NEVER checks out the branch it is collecting captures for", () => {
  // The property the whole permission model rests on, and it was previously only
  // implied. This job holds `secrets.EVAL_STORE_TOKEN`, a credential that can
  // write to another repository — so if it ever executed code from the branch
  // under review, any PR author could exfiltrate or misuse that token. The
  // permissions block cannot help: the token is not a permission, it is a secret
  // already in the environment.
  //
  // Two things keep that from happening and both are asserted here rather than
  // reasoned about. First, `workflow_run` runs the DEFAULT BRANCH's copy of this
  // file and sets `GITHUB_SHA` to the default branch tip — measured on run
  // 30988338870, which reported `head_branch: main` and a `head_sha` identical to
  // `main`, while collecting captures produced by PR #674. Second, no step here
  // overrides that: an explicit `ref:` is what it would take to check out
  // untrusted content, and there is none.
  const yamlOnly = readFileSync(path.join(HERE, "..", "..", ".github", "workflows", "capture-collect.yml"), "utf8")
    .split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

  assert.equal(/^\s+ref:/m.test(yamlOnly), false, "a checkout ref: here would run code from the branch under review");
  // The triggering run's head is available in the event payload and must not be
  // used to select code. (`meta.json` carries the reviewed SHA as DATA; that is a
  // different thing and lives inside the artifact, not in a checkout.)
  for (const forbidden of ["head_sha", "head_branch", "head_ref", "pull_requests"]) {
    assert.equal(yamlOnly.includes(forbidden), false, `${forbidden} must not influence what this job checks out`);
  }
});

test("the pushed-file count is the number of files pushed", () => {
  // The first live run reported "pushed 12 file(s)" having pushed 11. The old
  // command was `git show --stat --oneline HEAD | tail -n +2 | wc -l`, which drops
  // the subject line and then counts the trailing " N files changed" summary as a
  // file. Off by exactly one, always, and invisible without counting by hand.
  //
  // Asserted by EXTRACTING the line from the workflow and running it, rather than
  // by re-typing the command here. A copy would let the workflow drift back to a
  // broken idiom with this test still green — and the reason the original bug
  // shipped is that a shell one-liner in YAML had no test of any kind.
  const yaml = readFileSync(path.join(HERE, "..", "..", ".github", "workflows", "capture-collect.yml"), "utf8");
  const m = /^\s*(files=\$\(.*\))\s*$/m.exec(yaml);
  assert.ok(m, "the commit step must count the files it is about to push");
  const command = m[1];

  const repo = mkdtempSync(path.join(tmpdir(), "collect-count-"));
  // `fixtureGitEnv`, not the ambient environment. Git hooks run with `GIT_DIR` and
  // `GIT_INDEX_FILE` exported, so `cwd` alone does NOT decide which repository these
  // commands touch: run from a pre-commit hook, the `git add` below staged a.json,
  // b.json and c.json into the REAL repository's index, and the following `git commit`
  // shipped all three. The count then read 0 because `git diff --cached` was inspecting
  // the wrong tree, so the symptom looked like a flaky assertion rather than an index
  // being rewritten underneath. `git-env.mjs` exists for exactly this and says so.
  const env = fixtureGitEnv(repo);
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: repo, env });
    for (const name of ["a.json", "b.json", "c.json"]) writeFileSync(path.join(repo, name), "{}");
    execFileSync("git", ["add", "a.json", "b.json", "c.json"], { cwd: repo, env });
    const out = execFileSync("bash", ["-c", `${command}; printf %s "$files"`], { cwd: repo, encoding: "utf8", env });
    assert.equal(out, "3", `the workflow's own count said ${JSON.stringify(out)} for 3 staged files`);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("a SKIPPED producer does not start a collection, but a failed one does", () => {
  // `workflow_run` fires on `completed` whatever the conclusion. A skipped producer
  // uploaded nothing, and three of the five runs on 2026-08-05 08:16–08:51 came
  // from a skipped on-demand panel — zero collected, ~41 API pages each.
  //
  // `failure` must NOT be gated: a panel that crashed after four of six lenses
  // captured four, and those are data. That is the assertion that matters here;
  // gating too much loses captures silently, which is the whole failure mode.
  const yamlOnly = readFileSync(path.join(HERE, "..", "..", ".github", "workflows", "capture-collect.yml"), "utf8")
    .split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  const cond = /^\s+if:\s*(.+?)\s*$/m.exec(yamlOnly);
  assert.ok(cond, "the collect job must be gated on the producer's conclusion");
  assert.equal(
    cond[1],
    "${{ github.event_name != 'workflow_run' || github.event.workflow_run.conclusion != 'skipped' }}",
  );
  // `schedule` and `workflow_dispatch` have no `workflow_run` payload, so the
  // event_name half is what keeps them running at all.
  assert.match(cond[1], /github\.event_name != 'workflow_run' \|\|/);
  for (const keep of ["failure", "cancelled", "success"]) {
    assert.equal(cond[1].includes(keep), false, `a ${keep} producer may still have uploaded captures`);
  }
});
