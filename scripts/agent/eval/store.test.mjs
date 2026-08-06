import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPTURES_SUBDIR,
  CORPUS_ITEM_FILES,
  EvalStore,
  ITEM_FILES,
  ITEM_STATUSES,
  RUN_FILES,
  TRANSCRIPT_STATES,
  contentSha256,
  itemFileBytes,
  validateCorpusItem,
  validateRunEnvelope,
} from "./store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A store rooted in a throwaway directory, and the directory, so a test can look inside. */
function tempStore() {
  const root = mkdtempSync(path.join(tmpdir(), "eval-store-test-"));
  return { root, store: new EvalStore(root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Real shas from wafflebase/wafflebase#664, so the 40-hex rule is exercised
// against the shape `gh` actually returns rather than a hand-made literal.
const BASE = "35206e5859788062cfddfd0fc12b0a5754655a8d";
const HEAD = "61101a1bdbdffb9acb88772cae4c9347c69f413b";
const DIFF = [
  "diff --git a/scripts/agent/x.mjs b/scripts/agent/x.mjs",
  "--- a/scripts/agent/x.mjs",
  "+++ b/scripts/agent/x.mjs",
  "@@ -1,2 +1,2 @@",
  "-const a = 1;",
  "+const a = 2;",
  "",
].join("\n");

/** A valid item, with `meta` fields overridable per test. */
function item({ diff = DIFF, issueSpec = "", ...metaOver } = {}) {
  const meta = {
    id: "pr-664",
    source_pr: 664,
    review_commit: HEAD,
    review_base: BASE,
    review_point: "pr-open",
    diff_method: "fork-point",
    changed_files: ["scripts/agent/x.mjs"],
    additions: 1,
    deletions: 1,
    scope: "S",
    has_issue_spec: issueSpec.trim() !== "",
    sha256_diff: contentSha256(diff),
    ...metaOver,
  };
  return { meta, diff, changedFiles: meta.changed_files, issueSpec };
}

test("there is NO default root — a store must be told where it is", () => {
  // Same rule and the same reason as `capture-store.mjs`: git history is
  // permanent, so a default pointing anywhere inside THIS repository would let one
  // forgotten flag commit corpus data into `wafflebase` for good.
  for (const bad of [undefined, null, "", "   ", 42, {}]) {
    assert.throws(
      () => new EvalStore(bad),
      /a root directory is required/,
      `EvalStore accepted ${JSON.stringify(bad)} as a root`,
    );
  }
});

test("an item written by the store reads back identically", () => {
  const { store, cleanup } = tempStore();
  try {
    const written = item({ issueSpec: "# Fix the thing\n\nIt is broken." });
    assert.equal(store.hasCorpusItem("pr-664"), false);
    assert.equal(store.putCorpusItem("pr-664", written), "written");
    assert.equal(store.hasCorpusItem("pr-664"), true);
    const read = store.getCorpusItemInput("pr-664");
    assert.deepEqual(read.meta, written.meta);
    assert.equal(read.diff, written.diff, "diff.patch must survive byte for byte");
    assert.deepEqual(read.changedFiles, written.changedFiles);
    assert.equal(read.issueSpec, written.issueSpec);
    assert.equal(store.getCorpusItemInput("pr-999"), null);
  } finally {
    cleanup();
  }
});

test("the four files, and only those four, land on disk", () => {
  const { root, store, cleanup } = tempStore();
  try {
    store.putCorpusItem("pr-664", item({ issueSpec: "# spec" }));
    const dir = path.join(root, "corpus", "items", "pr-664");
    assert.deepEqual(readdirSync(dir).sort(), ["changed-files.txt", "diff.patch", "issue-spec.md", "meta.json"]);
    assert.equal(readFileSync(path.join(dir, "changed-files.txt"), "utf8"), "scripts/agent/x.mjs\n");
  } finally {
    cleanup();
  }
});

test("putCorpusItem is WRITE-ONCE: a second write throws and changes nothing", () => {
  // The store refuses rather than answering "present" (as `putCapture` does),
  // because a second extraction of one PR CAN legitimately produce different bytes
  // and that case must not pass quietly. `extract-corpus.mjs` compares instead.
  const { store, cleanup } = tempStore();
  try {
    store.putCorpusItem("pr-664", item());
    const second = item({ diff: DIFF + "+ sneaked in\n" });
    assert.throws(() => store.putCorpusItem("pr-664", second), /write-once/);
    assert.equal(store.getCorpusItemInput("pr-664").diff, DIFF, "the stored diff must be untouched");
  } finally {
    cleanup();
  }
});

test("meta.json is written LAST, so 'the item exists' means 'the item is complete'", () => {
  // The ordering itself, asserted on the writer's own file list. It is otherwise
  // unobservable — it only has an effect when a write is interrupted — so without
  // this assertion the decision can be reversed with every test still green.
  const files = itemFileBytes(validateCorpusItem("pr-664", item({ issueSpec: "# spec" })));
  assert.deepEqual(files.map(([name]) => name), ["diff.patch", "changed-files.txt", "issue-spec.md", "meta.json"]);

  const { root, store, cleanup } = tempStore();
  try {
    // The state an interrupted write leaves, replayed from that same list: every
    // file but the last one. It must read as ABSENT (recoverable), never as an
    // item — a runner handed a diff-less item measures something else entirely.
    const dir = path.join(root, "corpus", "items", "pr-664");
    mkdirSync(dir, { recursive: true });
    for (const [name, bytes] of files.slice(0, -1)) writeFileSync(path.join(dir, name), bytes);
    assert.equal(store.hasCorpusItem("pr-664"), false);
    assert.equal(store.getCorpusItemInput("pr-664"), null);
    assert.deepEqual(store.listCorpusItems(), [], "an incomplete item is not listed");
    // And it can still be written — item-level write-once must not make a
    // half-written item permanently unwritable.
    assert.equal(store.putCorpusItem("pr-664", item({ issueSpec: "# spec" })), "written");
    assert.equal(store.hasCorpusItem("pr-664"), true);
  } finally {
    cleanup();
  }
});

test("present-but-broken THROWS while absent returns null", () => {
  // The two failures are split on purpose. An absent item is "not extracted yet".
  // An item that exists and cannot be read must not silently shrink the corpus —
  // a runner that skips it reports an `n` it did not measure.
  const { root, store, cleanup } = tempStore();
  try {
    store.putCorpusItem("pr-664", item());
    const dir = path.join(root, "corpus", "items", "pr-664");
    rmSync(path.join(dir, CORPUS_ITEM_FILES.diff));
    assert.throws(() => store.getCorpusItemInput("pr-664"), /incomplete item, not an absent one/);
    writeFileSync(path.join(dir, CORPUS_ITEM_FILES.meta), "{not json");
    assert.throws(() => store.getCorpusItemInput("pr-664"), /unreadable meta\.json/);
  } finally {
    cleanup();
  }
});

test("meta.review_base is REQUIRED, and the refusal says why PR 6 needs it", () => {
  // Not a formality. `review_base` is what a replay passes as `--base-sha`, which
  // is what switches the shipped novelty gate on. Without it every replay measures
  // the gate with novelty OFF and `lane: "backlog"` can never occur — a replayed
  // gate that is not the shipped gate, with nothing in the output saying so.
  const { store, cleanup } = tempStore();
  try {
    const { meta, diff, issueSpec } = item();
    delete meta.review_base;
    assert.throws(() => store.putCorpusItem("pr-664", { meta, diff, issueSpec }), /review_base/);
    assert.throws(() => store.putCorpusItem("pr-664", { meta, diff, issueSpec }), /PR 6/);
    assert.throws(() => store.putCorpusItem("pr-664", { meta, diff, issueSpec }), /--base-sha/);
    assert.equal(store.hasCorpusItem("pr-664"), false, "a refused item must leave nothing behind");
  } finally {
    cleanup();
  }
});

test("review_base and review_commit must be 40 lowercase hex, not merely present", () => {
  const { store, cleanup } = tempStore();
  try {
    for (const bad of ["", "abc", HEAD.toUpperCase(), HEAD.slice(0, 39), HEAD + "0", "refs/heads/main", 61101]) {
      assert.throws(
        () => store.putCorpusItem("pr-664", item({ review_commit: bad })),
        /review_commit must be 40 lowercase hex/,
        `review_commit accepted ${JSON.stringify(bad)}`,
      );
      assert.throws(
        () => store.putCorpusItem("pr-664", item({ review_base: bad })),
        /review_base must be 40 lowercase hex/,
        `review_base accepted ${JSON.stringify(bad)}`,
      );
    }
  } finally {
    cleanup();
  }
});

test("sha256_diff is RECOMPUTED from the diff, not just shape-checked", () => {
  // The failure this store is most exposed to: a hash that does not describe the
  // bytes beside it looks fine, survives every read, and PR 16's staleness check
  // compares against it — so wrong labels read as fresh.
  const { store, cleanup } = tempStore();
  try {
    const wrongButWellFormed = contentSha256("some other diff entirely");
    assert.throws(
      () => store.putCorpusItem("pr-664", item({ sha256_diff: wrongButWellFormed })),
      /does not match the diff it travels with/,
    );
    for (const bad of ["", "sha256:abc", "deadbeef".repeat(8), `sha1:${"a".repeat(40)}`, contentSha256(DIFF).toUpperCase()]) {
      assert.throws(
        () => store.putCorpusItem("pr-664", item({ sha256_diff: bad })),
        /sha256_diff must be sha256:<64 hex>/,
        `sha256_diff accepted ${JSON.stringify(bad)}`,
      );
    }
  } finally {
    cleanup();
  }
});

test("the write path refuses every other way an item can be self-contradictory", () => {
  const { store, cleanup } = tempStore();
  try {
    const cases = [
      [{ id: "pr-999" }, /does not match the item id/, "meta.id filed under another id"],
      [{ changed_files: [] }, /changed_files must be a non-empty array/, "no changed files"],
      [{ changed_files: ["a.ts", ""] }, /changed_files contains/, "a blank path"],
      // `changed-files.txt` is line-based and its reader trims, so a padded path
      // could never round-trip — the two copies would then disagree.
      [{ changed_files: ["a.ts", " b.ts"] }, /changed_files contains/, "a padded path"],
      [{ review_point: "" }, /meta\.review_point must be a non-empty string/, "no review point"],
      [{ diff_method: "" }, /meta\.diff_method must be a non-empty string/, "no diff method"],
      [{ has_issue_spec: true }, /has_issue_spec/, "claims a spec it does not carry"],
    ];
    for (const [over, re, what] of cases) {
      assert.throws(() => store.putCorpusItem("pr-664", item(over)), re, `accepted an item with ${what}`);
    }
    // An empty diff is an extraction failure, not a small item.
    assert.throws(() => store.putCorpusItem("pr-664", item({ diff: "   \n" })), /empty diff/);
    // `changed-files.txt` and `meta.changed_files` are read by different consumers
    // and may not disagree: a lens scoped off one while a scorer segments off the
    // other is a bias with no symptom.
    const it = item();
    assert.throws(
      () => store.putCorpusItem("pr-664", { ...it, changedFiles: ["something-else.ts"] }),
      /disagrees with meta\.changed_files/,
    );
    assert.throws(() => store.putCorpusItem("pr-664", { ...it, meta: null }), /must be a JSON object/);
    assert.equal(store.hasCorpusItem("pr-664"), false, "no refusal may have written anything");
  } finally {
    cleanup();
  }
});

test("unknown meta fields WIDEN: they survive a store that has never heard of them", () => {
  // Decision 7 as it applies to a validator. The finding adapters broke this twice
  // by rebuilding a record from a field list; `meta.json` is stored as given, so a
  // field PR 7 or PR 16 adds is not silently dropped by the store that predates it.
  const { store, cleanup } = tempStore();
  try {
    store.putCorpusItem("pr-664", item({ lane: "backlog", defect_classes: ["off-by-one"] }));
    const read = store.getCorpusItemInput("pr-664");
    assert.equal(read.meta.lane, "backlog");
    assert.deepEqual(read.meta.defect_classes, ["off-by-one"]);
  } finally {
    cleanup();
  }
});

test("an absent issue spec is null, not an empty string", () => {
  // "This PR closed no issue" and "the issue body was blank" are different facts
  // about the input, and only the first means a `needsIssueSpec` lens should not run.
  const { root, store, cleanup } = tempStore();
  try {
    store.putCorpusItem("pr-664", item({ issueSpec: "" }));
    assert.equal(existsSync(path.join(root, "corpus", "items", "pr-664", CORPUS_ITEM_FILES.issueSpec)), false);
    assert.equal(store.getCorpusItemInput("pr-664").issueSpec, null);
  } finally {
    cleanup();
  }
});

test("a `.part-` leftover is never mistaken for an item, and does not block the write", () => {
  // The temp-file-and-rename rule, and the same reasoning as `capture-store.mjs`:
  // a crash part-way through a direct write leaves a TRUNCATED diff.patch, and a
  // truncated diff replays cleanly against the wrong input. Simulated by planting
  // the debris this process's own write would leave.
  const { root, store, cleanup } = tempStore();
  try {
    const dir = path.join(root, "corpus", "items", "pr-664");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${CORPUS_ITEM_FILES.diff}.part-${process.pid}`), "half a di");
    assert.equal(store.hasCorpusItem("pr-664"), false);
    assert.deepEqual(store.listCorpusItems(), []);
    store.putCorpusItem("pr-664", item());
    assert.deepEqual(readdirSync(dir).sort(), ["changed-files.txt", "diff.patch", "meta.json"], "no debris survives");
    assert.equal(store.getCorpusItemInput("pr-664").diff, DIFF);
  } finally {
    cleanup();
  }
});

test("an item id or corpus version that would escape the store is refused", () => {
  // Both become path segments. Item ids are built from a PR number today but
  // arrive from `meta.json` on any read, and a `--corpus-version` comes off a
  // command line.
  const { store, cleanup } = tempStore();
  try {
    for (const bad of ["../escaped", "corpus/../../x", "/etc/passwd", ".", "..", "a/b", "a\\b", "", null, "-leading-dash"]) {
      assert.throws(() => store.hasCorpusItem(bad), /eval store: item id must match/, `hasCorpusItem accepted ${JSON.stringify(bad)}`);
      assert.throws(() => store.getCorpus(bad), /eval store: corpus version must match/, `getCorpus accepted ${JSON.stringify(bad)}`);
      assert.throws(() => store.putCorpusManifest(bad, { items: [] }), /eval store: corpus version must match/, `putCorpusManifest accepted ${JSON.stringify(bad)}`);
    }
  } finally {
    cleanup();
  }
});

test("manifests round-trip, are overwritable, and are null when absent", () => {
  // Unlike an item, a manifest holds no observation — it is an index recomputable
  // from the items it names, so refreshing it is normal.
  const { store, cleanup } = tempStore();
  try {
    assert.equal(store.getCorpus("2026-08-05a"), null);
    assert.equal(store.getCorpusManifest("2026-08-05a"), null);
    store.putCorpusManifest("2026-08-05a", { corpus_version: "2026-08-05a", item_count: 1, items: [{ id: "pr-664" }] });
    assert.deepEqual(store.getCorpus("2026-08-05a"), [{ id: "pr-664" }]);
    store.putCorpusManifest("2026-08-05a", { corpus_version: "2026-08-05a", item_count: 2, items: [{ id: "pr-664" }, { id: "pr-673" }] });
    assert.equal(store.getCorpusManifest("2026-08-05a").item_count, 2);
  } finally {
    cleanup();
  }
});

test("listCorpusItems is sorted, and read paths degrade on a root that does not exist yet", () => {
  const { store, cleanup } = tempStore();
  try {
    store.putCorpusItem("pr-673", item({ id: "pr-673" }));
    store.putCorpusItem("pr-664", item());
    assert.deepEqual(store.listCorpusItems(), ["pr-664", "pr-673"]);
  } finally {
    cleanup();
  }
  // First run, before anything has ever been frozen: a read is "nothing yet", not a throw.
  const fresh = new EvalStore(path.join(tmpdir(), `eval-store-does-not-exist-${process.pid}`));
  assert.equal(fresh.hasCorpusItem("pr-664"), false);
  assert.equal(fresh.getCorpusItemInput("pr-664"), null);
  assert.equal(fresh.getCorpus("v1"), null);
  assert.deepEqual(fresh.listCorpusItems(), []);
});

test("captures are DELEGATED to the merged capture store, not reimplemented", () => {
  const { root, store, cleanup } = tempStore();
  try {
    // Exactly the surface `capture-store.mjs` owns, unchanged — this store adds no
    // fourth method to it. A capture READ lands with its first consumer (PR 5's
    // panel adapter), not here on speculation.
    assert.deepEqual(Object.keys(store.captures).sort(), ["hasCapture", "listCaptures", "putCapture"]);
    const key = "stage-detail/channel=gating/pr=664/sha=61101a1b/run=30891782298/attempt=1/correctness.json";
    assert.equal(store.captures.putCapture(key, '{"samples":[[]]}'), "written");
    // Under the root's `captures/`, which is where the collector already writes.
    assert.equal(readFileSync(path.join(root, CAPTURES_SUBDIR, ...key.split("/")), "utf8"), '{"samples":[[]]}');
    assert.deepEqual(store.captures.listCaptures(), [key]);
  } finally {
    cleanup();
  }
});

test("the captures subdirectory agrees with the collector workflow's --root", () => {
  // Two producers, one directory. `capture-collect.yml` passes
  // `--root .capture-store/captures` and this store delegates to
  // `<root>/captures`. Written as two independent literals they drift, and the
  // drift is silent in the worst direction: the collector keeps filling one
  // directory while every reader looks in another, and both report success.
  const wf = path.join(HERE, "..", "..", "..", ".github", "workflows", "capture-collect.yml");
  assert.ok(existsSync(wf), "capture-collect.yml moved — this pin needs re-pointing, not deleting");
  const roots = [...readFileSync(wf, "utf8").matchAll(/--root\s+(\S+)/g)].map((m) => m[1]);
  assert.ok(roots.length > 0, "no --root found in capture-collect.yml");
  for (const r of roots) {
    assert.equal(r.split("/").pop(), CAPTURES_SUBDIR, `the collector writes to ${r}, this store reads ${CAPTURES_SUBDIR}/`);
  }
});

test("there is no transcript method on the surface, and that IS the decision", () => {
  // Spec §8 keeps model transcripts out of git (10–30 MB of debugging aid no
  // metric reads), so a transcript is routinely absent. A `getTranscript` that
  // answered `null` on every call in production would eventually be read as "the
  // model said nothing" — a confusion this codebase has already shipped once
  // (audit §4-E). Absence is expressed by there being no question to ask, and the
  // run slice keeps the other half of the promise: an envelope carries a NAMED
  // state rather than a pointer that can be falsy.
  const { store, cleanup } = tempStore();
  try {
    for (const name of ["getTranscript", "putTranscript"]) {
      assert.equal(typeof store[name], "undefined", `${name} exists — see the header note on transcript absence`);
    }
  } finally {
    cleanup();
  }
});

test("nothing the store writes is a compressed transcript", () => {
  // The fork's `putItem` gzipped every replay's full model transcript into the
  // results repo. Asserted on what lands on DISK rather than on the source text: a
  // grep would also match this comment, and a test that reads a comment is not
  // watching the property.
  const { root, store, cleanup } = tempStore();
  try {
    store.putCorpusItem("pr-664", item());
    store.putItem(RUN_ID, "pr-664", { envelope: envelope(), payload: { adapter: "reviewer", transcript: "would have been gzipped" } });
    const all = readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
    assert.ok(all.length > 0);
    for (const f of all) assert.ok(!f.endsWith(".gz"), `${f} is a compressed blob in a git-backed store`);
  } finally {
    cleanup();
  }
});

test("contentSha256 is the sha256:<hex> form the rest of the benchmark compares against", () => {
  assert.match(contentSha256("x"), /^sha256:[0-9a-f]{64}$/);
  assert.equal(contentSha256(""), `sha256:${"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}`);
  assert.equal(contentSha256("x"), contentSha256("x"));
  assert.notEqual(contentSha256("x"), contentSha256("y"));
});

test("validateCorpusItem is exported so a hand-written item is checked by the same rules", () => {
  // PR 16 may hand-write an item; the audit's own warning is that a module can
  // load, pass its tests and still be wrong. One validator, two callers.
  const good = item();
  const normalised = validateCorpusItem("pr-664", good);
  assert.deepEqual(normalised.changedFiles, good.changedFiles);
  assert.equal(normalised.issueSpec, "");
  assert.throws(() => validateCorpusItem("pr-664", { ...good, diff: "" }), /empty diff/);
});

// --- the run slice -----------------------------------------------------------
// PR 3 ported the corpus slice only, deliberately. These are the run-side methods
// the replay runner needs, and the reason they are worth their own block is that
// their mutability rules are the OPPOSITE of a corpus item's: an item is a
// deterministic extraction whose re-write is a determinism check, while a run item
// is an observation of a non-deterministic judge whose re-write would delete a data
// point.

const RUN_ID = "2026-08-06T12-00-00-000Z__baseline";
const PANEL_SHA = "61101a1bdbdffb9acb88772cae4c9347c69f413b";

/** A valid envelope, with fields overridable per test. */
function envelope(over = {}) {
  return {
    run_id: RUN_ID,
    item_id: "pr-664",
    config_hash: `sha256:${"a".repeat(64)}`,
    panel_sha: PANEL_SHA,
    panel_sha_source: "git",
    corpus_version: "v-test",
    status: "ok",
    reason: null,
    error: null,
    cost_usd: 0.42,
    duration_ms: 30000,
    duration_source: "review-timing.json",
    gate: { state: "off-no-base-sha", line: "novelty gate: OFF (no --base-sha)" },
    transcript: { state: "absent" },
    timestamp: "2026-08-06T12:01:00.000Z",
    ...over,
  };
}

const runJson = (over = {}) => ({ run_id: RUN_ID, config_hash: `sha256:${"a".repeat(64)}`, corpus_version: "v-test", panel_sha: PANEL_SHA, status: "partial", ...over });

test("a run item written by the store reads back identically", () => {
  const { store, cleanup } = tempStore();
  try {
    assert.equal(store.hasItem(RUN_ID, "pr-664"), false);
    assert.equal(store.getItem(RUN_ID, "pr-664"), null);
    assert.equal(store.putItem(RUN_ID, "pr-664", { envelope: envelope(), payload: { adapter: "reviewer", findings: [] } }), "written");
    assert.equal(store.hasItem(RUN_ID, "pr-664"), true);
    const got = store.getItem(RUN_ID, "pr-664");
    assert.deepEqual(got.envelope, envelope());
    assert.deepEqual(got.payload, { adapter: "reviewer", findings: [] });
    assert.deepEqual(store.listItems(RUN_ID), ["pr-664"]);
  } finally {
    cleanup();
  }
});

test("a run id is validated, never sanitised", () => {
  // The fork ran every id through a `[:/\\] → -` replace, which silently maps two
  // DISTINCT run ids onto one directory — for a subsystem whose whole job is telling
  // two runs apart, the worse failure. The ids the runner generates pass this
  // grammar unchanged, so nothing needed mangling in the first place.
  const { store, cleanup } = tempStore();
  try {
    assert.equal(store.putRun(RUN_ID, { runJson: runJson() }), "written");
    for (const bad of ["../escape", "a/b", "a\\b", "", ".", "..", "-leading"]) {
      assert.throws(() => store.putRun(bad, { runJson: runJson({ run_id: bad }) }), /run id must match/);
      assert.throws(() => store.hasItem(bad, "pr-664"), /run id must match/);
    }
  } finally {
    cleanup();
  }
});

test("a run item is write-once, and the refusal says to use a new run id", () => {
  const { store, cleanup } = tempStore();
  try {
    store.putItem(RUN_ID, "pr-664", { envelope: envelope(), payload: {} });
    // Unlike a corpus item — where a second extraction is COMPARED — a second replay
    // is a different observation of a non-deterministic judge and belongs under a
    // different run id. Overwriting would delete a data point and leave run.json's
    // totals describing items that are no longer there.
    assert.throws(
      () => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ cost_usd: 9 }), payload: {} }),
      /already exists .*runs are write-once.*new --run-id/s,
    );
    assert.equal(store.getItem(RUN_ID, "pr-664").envelope.cost_usd, 0.42);
  } finally {
    cleanup();
  }
});

test("hasItem keys on envelope.json, which is written LAST", () => {
  const { root, store, cleanup } = tempStore();
  try {
    store.putItem(RUN_ID, "pr-664", { envelope: envelope(), payload: { x: 1 } });
    const dir = path.join(root, "runs", RUN_ID, "items", "pr-664");
    assert.deepEqual(readdirSync(dir).sort(), ["envelope.json", "payload.json"]);
    // A crash between the two files must leave the item ABSENT — so it is retried —
    // rather than present-and-half-written, which resume would skip forever.
    rmSync(path.join(dir, "envelope.json"));
    assert.equal(store.hasItem(RUN_ID, "pr-664"), false);
    assert.deepEqual(store.listItems(RUN_ID), []);
    // And the reverse state, which nothing this module writes can produce, THROWS
    // rather than silently shrinking the run: every proportion downstream would
    // otherwise carry an `n` that is wrong.
    store.putItem(RUN_ID, "pr-664", { envelope: envelope(), payload: { x: 1 } });
    rmSync(path.join(dir, "payload.json"));
    assert.throws(() => store.getItem(RUN_ID, "pr-664"), /an incomplete item, not an absent one/);
  } finally {
    cleanup();
  }
});

test("the write ORDER survives an interrupted write, which is the only time it shows", () => {
  // The order has no effect on a completed item, so asserting that both files exist
  // cannot see it — and a decision nothing can see is one that gets silently
  // reversed. Replayed here by making the SECOND write fail: a directory sits where
  // `payload.json` should go, so `writeFileSync` throws part-way through `putItem`.
  const { root, store, cleanup } = tempStore();
  try {
    const dir = path.join(root, "runs", RUN_ID, "items", "pr-664");
    mkdirSync(path.join(dir, ITEM_FILES.payload), { recursive: true });
    assert.throws(() => store.putItem(RUN_ID, "pr-664", { envelope: envelope(), payload: { x: 1 } }));
    // Payload first, envelope last → the interrupted item reads ABSENT, which is
    // recoverable: the runner retries it. The other order would leave `hasItem`
    // TRUE with no payload beside it, and a resumed run would skip it forever.
    assert.equal(
      store.hasItem(RUN_ID, "pr-664"),
      false,
      "envelope.json was written before payload.json — an interrupted item would read as complete and never be retried",
    );
  } finally {
    cleanup();
  }
});

test("an envelope with no panel_sha is refused — half of 'same reviewer' would be missing", () => {
  const { store, cleanup } = tempStore();
  try {
    // #680 decided the pooling key is the PAIR (config_hash, panel_sha):
    // config_hash cannot see the panel's code, so a new verifier stage or a changed
    // gate leaves it identical. Without panel_sha a replay envelope and a live
    // capture cannot be pooled on the same key at all.
    for (const bad of [undefined, null, "", "abc", "A".repeat(40), `${PANEL_SHA} `, "z".repeat(40), 40]) {
      assert.throws(
        () => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ panel_sha: bad }), payload: {} }),
        /panel_sha must be 40 lowercase hex/,
        `panel_sha ${JSON.stringify(bad)} was accepted`,
      );
    }
    assert.equal(store.hasItem(RUN_ID, "pr-664"), false, "a refused envelope must leave nothing behind");
  } finally {
    cleanup();
  }
});

test("an envelope with no gate state is refused — a scorer would pool gated and ungated runs", () => {
  const { store, cleanup } = tempStore();
  try {
    for (const bad of [undefined, null, {}, { state: "" }, { state: "  " }, { line: "x" }]) {
      assert.throws(
        () => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ gate: bad }), payload: {} }),
        /gate\.state must be a non-empty string/,
        `gate ${JSON.stringify(bad)} was accepted`,
      );
    }
  } finally {
    cleanup();
  }
});

test("a transcript reference must be a NAMED state, never a falsy value", () => {
  const { store, cleanup } = tempStore();
  // Each accepted state needs its OWN root, because `putItem` is write-once and all
  // three write the same item id — collected here so the `finally` can remove them
  // rather than leaving one temp directory per state behind on every run.
  const extraRoots = [];
  try {
    // "we did not keep it" and "there was nothing to keep" are different facts, and
    // a falsy value cannot express which. PR 3 decided this for corpus items; the
    // write path is where it stops being a convention.
    for (const bad of [undefined, null, "", "absent", { state: null }, { state: "" }, { state: "missing" }, { path: "/x" }]) {
      assert.throws(
        () => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ transcript: bad }), payload: {} }),
        /transcript\.state must be one of/,
        `transcript ${JSON.stringify(bad)} was accepted`,
      );
    }
    for (const state of TRANSCRIPT_STATES) {
      const root = mkdtempSync(path.join(tmpdir(), "eval-store-test-"));
      extraRoots.push(root);
      const s = new EvalStore(root);
      assert.equal(s.putItem(RUN_ID, "pr-664", { envelope: envelope({ transcript: { state, path: "/tmp/t.json" } }), payload: {} }), "written");
    }
  } finally {
    for (const root of extraRoots) rmSync(root, { recursive: true, force: true });
    cleanup();
  }
});

test("status and reason cannot disagree about whether the item failed", () => {
  const { store, cleanup } = tempStore();
  try {
    for (const bad of [undefined, null, "", "OK", "skipped", "partial", 1]) {
      assert.throws(() => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ status: bad }), payload: {} }), /status must be one of/);
    }
    // `ok` means exactly one thing: this item is a real verdict and may be pooled as
    // one. An `ok` carrying a reason is two disagreeing claims about the same item.
    assert.throws(
      () => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ status: "ok", reason: "panel-exit" }), payload: {} }),
      /both be a real verdict and have failed/,
    );
    assert.throws(
      () => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ status: "error", reason: null }), payload: {} }),
      /a failure nobody can name/,
    );
    assert.throws(
      () => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ status: "error", reason: "panel-exit", error: null }), payload: {} }),
      /carries no message/,
    );
    assert.equal(
      store.putItem(RUN_ID, "pr-664", { envelope: envelope({ status: "error", reason: "panel-exit", error: { message: "the panel exited 1", kind: "panel-exit" } }), payload: {} }),
      "written",
    );
  } finally {
    cleanup();
  }
});

test("a null duration is storable, and a duration with no source is not", () => {
  const { store, cleanup } = tempStore();
  try {
    // `null` means the panel wrote no review-timing.json. Substituting
    // sumExecutions's flat sum instead would record a number 3–5× high, because the
    // panel runs its lenses, samples and verifier calls concurrently.
    assert.equal(store.putItem(RUN_ID, "a", { envelope: envelope({ item_id: "a", duration_ms: null, duration_source: "absent" }), payload: {} }), "written");
    for (const bad of [-1, "30000", NaN, Infinity, undefined]) {
      assert.throws(() => store.putItem(RUN_ID, "b", { envelope: envelope({ item_id: "b", duration_ms: bad }), payload: {} }), /duration_ms must be null or a non-negative number/);
    }
    assert.throws(() => store.putItem(RUN_ID, "c", { envelope: envelope({ item_id: "c", duration_source: "" }), payload: {} }), /duration_source must say where/);
  } finally {
    cleanup();
  }
});

test("an envelope filed under one id may not claim another, and unknown fields survive", () => {
  const { store, cleanup } = tempStore();
  try {
    assert.throws(() => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ item_id: "pr-999" }), payload: {} }), /does not match the item id/);
    assert.throws(() => store.putItem(RUN_ID, "pr-664", { envelope: envelope({ run_id: "other" }), payload: {} }), /does not match the run id/);
    // WIDENS, NEVER NARROWS: a field PR 13 or PR 19 adds must survive a store that
    // has never heard of it. This is decision 7, and the finding adapters broke it twice.
    store.putItem(RUN_ID, "pr-664", { envelope: envelope({ segment_hint: { defect_class: "concurrency" } }), payload: {} });
    assert.deepEqual(store.getItem(RUN_ID, "pr-664").envelope.segment_hint, { defect_class: "concurrency" });
  } finally {
    cleanup();
  }
});

test("run.json is refreshable and the config snapshot is identity", () => {
  const { store, cleanup } = tempStore();
  const snap = { config_hash: `sha256:${"a".repeat(64)}`, captured_at: "2026-08-06T12:00:00.000Z", lenses: [{ id: "correctness" }] };
  try {
    assert.equal(store.getRun(RUN_ID), null);
    store.putRun(RUN_ID, { runJson: runJson(), configSnapshot: snap });
    store.putRun(RUN_ID, { runJson: runJson({ status: "complete", items_ok: 1 }), configSnapshot: { ...snap, captured_at: "2026-08-06T13:00:00.000Z" } });
    const got = store.getRun(RUN_ID);
    // The summary is rewritten freely; it is recomputed from the immutable items.
    assert.equal(got.runJson.status, "complete");
    // The snapshot is not, and a differing `captured_at` is NOT a differing config —
    // comparing bytes would refuse every ordinary resume, the same trap
    // extract-corpus.mjs avoided by keeping a clock out of the corpus manifest.
    assert.equal(got.configSnapshot.captured_at, "2026-08-06T12:00:00.000Z");
    // A genuinely different configuration is refused: run.json names ONE config_hash
    // for the whole run, so half the items would be unattributable.
    assert.throws(
      () => store.putRun(RUN_ID, { runJson: runJson(), configSnapshot: { ...snap, config_hash: `sha256:${"b".repeat(64)}` } }),
      /already holds a DIFFERENT config snapshot/,
    );
    assert.throws(() => store.putRun(RUN_ID, { runJson: { status: "partial" } }), /run_id is undefined/);
  } finally {
    cleanup();
  }
});

test("a corrupt config snapshot is named, not thrown as a bare SyntaxError", () => {
  // Both parses of this file are guarded, and both refusals name the run and the
  // file. It is the one comparison that decides whether two reviewers get filed
  // under one run id, so "the snapshot is corrupt" and "the offer disagrees" must
  // not arrive as the same unlabelled stack trace.
  const { root, store, cleanup } = tempStore();
  const snap = { config_hash: `sha256:${"a".repeat(64)}`, lenses: [] };
  try {
    store.putRun(RUN_ID, { runJson: runJson(), configSnapshot: snap });
    writeFileSync(path.join(root, "runs", RUN_ID, RUN_FILES.configSnapshot), "{not json");
    for (const call of [
      () => store.getRun(RUN_ID),
      () => store.putRun(RUN_ID, { runJson: runJson(), configSnapshot: snap }),
    ]) {
      assert.throws(call, /unreadable config\.snapshot\.json/);
      assert.throws(call, new RegExp(RUN_ID));
    }
    // An ABSENT snapshot still degrades to null — that is an interrupted write, not
    // a corrupt one, and the two must not answer the same way.
    rmSync(path.join(root, "runs", RUN_ID, RUN_FILES.configSnapshot));
    assert.equal(store.getRun(RUN_ID).configSnapshot, null);
  } finally {
    cleanup();
  }
});

test("listRuns narrows to the replicates a reliability scorer aggregates over", () => {
  const { root, store, cleanup } = tempStore();
  try {
    const hashA = `sha256:${"a".repeat(64)}`, hashB = `sha256:${"b".repeat(64)}`;
    store.putRun("run-1", { runJson: runJson({ run_id: "run-1", config_hash: hashA }) });
    store.putRun("run-2", { runJson: runJson({ run_id: "run-2", config_hash: hashA }) });
    store.putRun("run-3", { runJson: runJson({ run_id: "run-3", config_hash: hashB }) });
    store.putRun("run-4", { runJson: runJson({ run_id: "run-4", config_hash: hashA, corpus_version: "v-other" }) });
    assert.deepEqual(store.listRuns(), ["run-1", "run-2", "run-3", "run-4"]);
    assert.deepEqual(store.listRuns({ configHash: hashA }), ["run-1", "run-2", "run-4"]);
    assert.deepEqual(store.listRuns({ configHash: hashA, corpusVersion: "v-test" }), ["run-1", "run-2"]);
    // `config_hash` alone does not identify the reviewer, so a caller aggregating
    // "the same reviewer" must be able to say `panelSha` too.
    assert.deepEqual(store.listRuns({ panelSha: PANEL_SHA }).length, 4);
    assert.deepEqual(store.listRuns({ panelSha: "f".repeat(40) }), []);
    // A read path degrades, and the two ways a `runs/` entry can be unusable take
    // DIFFERENT branches, so they get their own assertions — a `configHash` filter
    // alone would exclude both for the wrong reason and hide either one.
    //
    // (a) a directory with no readable run.json → the parse fails and it is skipped.
    mkdirSync(path.join(root, "runs", "debris"), { recursive: true });
    assert.deepEqual(store.listRuns(), ["run-1", "run-2", "run-3", "run-4"], "a run dir with no run.json was not skipped");
    // (b) a plain FILE where a run directory should be → caught by `isDirectory()`
    // before any read is attempted.
    writeFileSync(path.join(root, "runs", "run-5"), "not a directory");
    assert.deepEqual(store.listRuns(), ["run-1", "run-2", "run-3", "run-4"], "a file in runs/ was not filtered out");
    assert.deepEqual(store.listRuns({ configHash: hashB }), ["run-3"]);
  } finally {
    cleanup();
  }
});

test("an empty root has no runs and no items, which is the ordinary first-run state", () => {
  const { store, cleanup } = tempStore();
  try {
    assert.deepEqual(store.listRuns(), []);
    assert.deepEqual(store.listItems(RUN_ID), []);
    assert.equal(store.getRun(RUN_ID), null);
    assert.equal(store.getItem(RUN_ID, "pr-664"), null);
  } finally {
    cleanup();
  }
});

test("validateRunEnvelope is exported so a hand-written envelope is checked by the same rules", () => {
  assert.deepEqual(validateRunEnvelope(RUN_ID, "pr-664", envelope()), envelope());
  assert.throws(() => validateRunEnvelope(RUN_ID, "pr-664", null), /must be a JSON object/);
  assert.throws(() => validateRunEnvelope(RUN_ID, "pr-664", [envelope()]), /must be a JSON object/);
  assert.deepEqual(ITEM_STATUSES, ["ok", "error"]);
  // `skipped` is gone because nothing produces it: an item the runner never
  // attempted is simply absent, and absence is already unambiguous here.
  assert.equal(ITEM_STATUSES.includes("skipped"), false);
});
