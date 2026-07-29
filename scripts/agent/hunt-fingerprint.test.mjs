import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scrubVolatile,
  observedKey,
  fingerprint,
  defectKey,
  siteFingerprint,
  parseSeenLedger,
  serializeSeenLedger,
  isNovel,
} from "./hunt-fingerprint.mjs";

// The property under test throughout: two runs that found the SAME defect must
// fingerprint identically, and two runs that found DIFFERENT defects must not.
// Get the first wrong and the ledger never converges (every night re-reports
// everything); get the second wrong and real defects are silently swallowed.

const fp = (over = {}) =>
  fingerprint({ charterId: "contract", argv: ["docs", "list"], oracle: "contract", observed: { exitCode: 1 }, ...over });

test("scrubVolatile: run-to-run noise collapses to the same fingerprint", () => {
  const pairs = [
    [["docs", "get", "3f2a1b4c-1111-2222-3333-444455556666"], ["docs", "get", "aaaabbbb-9999-8888-7777-666655554444"]],
    [["--out", "/tmp/wb-hunt-abc123/x.csv"], ["--out", "/tmp/wb-hunt-zzz999/x.csv"]],
    [["--server", "http://localhost:3000"], ["--server", "http://localhost:54321"]],
    [["docs", "create", "hunt-r1-1"], ["docs", "create", "hunt-r9-7"]],
    [["--at", "2026-07-29T14:00:00Z"], ["--at", "2026-01-02T03:04:05Z"]],
  ];
  for (const [a, b] of pairs) {
    assert.deepEqual(scrubVolatile(a), scrubVolatile(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    assert.equal(fp({ argv: a }), fp({ argv: b }), "same defect must fingerprint identically");
  }
});

test("scrubVolatile: a REAL argument difference still changes the fingerprint", () => {
  // The counterweight. Over-scrubbing would merge distinct defects into one and
  // hide all but the first.
  assert.notEqual(fp({ argv: ["docs", "list"] }), fp({ argv: ["docs", "get"] }));
  assert.notEqual(fp({ argv: ["--format", "json"] }), fp({ argv: ["--format", "csv"] }));
  assert.notEqual(fp({ argv: ["--pages", "1-3"] }), fp({ argv: ["--pages", "4-6"] }));
  // Argv boundaries matter: one joined token is not the same as two.
  assert.notEqual(fp({ argv: ["docs list"] }), fp({ argv: ["docs", "list"] }));
});

test("observedKey: the SHAPE of an outcome, not its message text", () => {
  const a = observedKey({ exitCode: 1, stderr: '{"error":{"code":"NOT_FOUND","message":"doc abc-123 missing"}}' });
  const b = observedKey({ exitCode: 1, stderr: '{"error":{"code":"NOT_FOUND","message":"doc zzz-999 missing"}}' });
  assert.equal(a, b, "different ids in the message must not change the key");
  assert.match(a, /err:NOT_FOUND/, "the machine-readable error code IS part of the shape");

  // Distinctions that must survive.
  assert.notEqual(observedKey({ exitCode: 1 }), observedKey({ exitCode: 2 }), "exit code");
  assert.notEqual(
    observedKey({ exitCode: 1, stderr: '{"error":{"code":"A"}}' }),
    observedKey({ exitCode: 1, stderr: '{"error":{"code":"B"}}' }),
    "error code",
  );
  assert.notEqual(
    observedKey({ exitCode: 0, stdout: "ok" }),
    observedKey({ exitCode: 0, stderr: "ok" }),
    "which stream carried the payload",
  );
});

test("observedKey: a stack trace is a distinct KIND from a clean envelope", () => {
  // This is the whole `crash` oracle: "leaked a stack trace" must be a different
  // observation from "returned a clean JSON error", even at the same exit code.
  const stack = observedKey({
    exitCode: 1,
    stderr: "TypeError: fetch failed\n    at node:internal/deps/undici/undici:13502:13",
  });
  const envelope = observedKey({ exitCode: 1, stderr: '{"error":{"code":"ERROR","message":"fetch failed"}}' });
  assert.match(stack, /kind:stack/);
  assert.match(envelope, /kind:json/);
  assert.notEqual(stack, envelope);

  // Claimed to be JSON but is not — a real, separate outcome (a truncated or
  // double-printed envelope), so it must not be filed under `json`.
  assert.match(observedKey({ exitCode: 1, stderr: '{"error":{"code":' }), /kind:text/);
  assert.match(observedKey({ exitCode: 0 }), /kind:empty/);
  assert.match(observedKey({ timedOut: true }), /exit:timeout/);
});

test("fingerprint: deterministic and free of ambient state", () => {
  // No Date.now()/Math.random() anywhere in the module, so repeated calls agree.
  assert.equal(fp(), fp());
  assert.equal(fp(), fp());
  assert.equal(fingerprint({}).length, 32);
  // Every field participates.
  assert.notEqual(fp({ charterId: "crash" }), fp({ charterId: "contract" }));
  assert.notEqual(fp({ oracle: "crash" }), fp({ oracle: "contract" }));
  assert.notEqual(fp({ observed: { exitCode: 1 } }), fp({ observed: { exitCode: 2 } }));
});

test("siteFingerprint: stable, and advisory only", () => {
  assert.equal(siteFingerprint("contract", "a.ts:1"), siteFingerprint("contract", "a.ts:1"));
  assert.notEqual(siteFingerprint("contract", "a.ts:1"), siteFingerprint("crash", "a.ts:1"));
});

// --- the ledger -------------------------------------------------------------

test("parseSeenLedger: reports corruption instead of silently looking empty", () => {
  // The one place fail-quiet is WRONG. An unreadable ledger that returned [] would
  // read as "nothing seen", making every previously-rejected candidate novel again
  // — re-reporting the exact noise the ledger exists to suppress. The caller aborts
  // on parseErrors > 0, which is only possible because this is reported.
  assert.deepEqual(parseSeenLedger(""), { seen: [], parseErrors: 0 }, "absent is not corrupt");
  assert.deepEqual(parseSeenLedger(undefined), { seen: [], parseErrors: 0 });
  assert.equal(parseSeenLedger("{ this is not json").parseErrors, 1);
  assert.equal(parseSeenLedger('{"not":"an array"}').parseErrors, 1);
  const mixed = parseSeenLedger(JSON.stringify([{ fp: "a" }, null, { nofp: 1 }, { fp: "" }]));
  assert.deepEqual(mixed.seen, [{ fp: "a" }]);
  assert.equal(mixed.parseErrors, 3, "each unusable entry is counted, not quietly skipped");
});

test("serializeSeenLedger round-trips through parseSeenLedger", () => {
  const entries = [{ fp: "a", charterId: "contract", verdict: "dropped", runId: "r1", sha: "abc" }];
  assert.deepEqual(parseSeenLedger(serializeSeenLedger(entries)), { seen: entries, parseErrors: 0 });
  assert.deepEqual(parseSeenLedger(serializeSeenLedger(null)), { seen: [], parseErrors: 0 });
});

test("isNovel: unseen is novel, seen is not", () => {
  const seen = [{ fp: "known", sha: "old" }];
  assert.equal(isNovel("fresh", seen), true);
  assert.equal(isNovel("known", seen), false);
  assert.equal(isNovel("known", []), true);
  assert.equal(isNovel("known", null), true);
});

test("isNovel: a sighting EXPIRES once the code it concerns has changed", () => {
  // Without this, the ledger is a permanent blocklist and the hunter goes blind to
  // its own regressions: a defect fixed and later reintroduced would never be
  // reported again.
  const seen = [{ fp: "known", sha: "old" }];
  assert.equal(isNovel("known", seen, { changedSince: () => true }), true, "scope moved → look again");
  assert.equal(isNovel("known", seen, { changedSince: () => false }), false, "scope unchanged → still known");

  // Multiple sightings: novel only if the scope moved since EVERY one. A sighting
  // newer than the last relevant change means we already looked at the current form.
  const twice = [{ fp: "k", sha: "old" }, { fp: "k", sha: "recent" }];
  assert.equal(isNovel("k", twice, { changedSince: (sha) => sha === "old" }), false);
  assert.equal(isNovel("k", twice, { changedSince: () => true }), true);

  // A sighting with no sha cannot be expiry-checked, so it stays known — the
  // conservative direction (cost is a missed rediscovery, not a duplicate report).
  assert.equal(isNovel("k", [{ fp: "k" }], { changedSince: () => true }), false);
});

test("defectKey: same defect via DIFFERENT probes still matches — the 0-agreement fix", () => {
  // The first live run agreed on nothing out of 9 candidates because agreement
  // was tested on byte-identical probe argv. Two samples that find the same bug
  // routinely reach it by different probes, so the defect's identity has to be
  // WHERE it is, not how it was provoked.
  const a = defectKey({ charterId: "contract", oracle: "contract",
    citations: ["packages/cli/src/output/formatter.ts:39", "docs/design/cli.md:691"],
    docCitation: "docs/design/cli.md:691" });
  const b = defectKey({ charterId: "contract", oracle: "contract",
    citations: ["packages/cli/src/output/formatter.ts:39", "packages/cli/README.md:114"],
    docCitation: "docs/design/cli.md:691" });
  assert.equal(a, b, "same code location + same doc promise = same defect");
});

test("defectKey: different locations stay distinct, including within one file", () => {
  const base = { charterId: "contract", oracle: "contract", docCitation: "docs/design/cli.md:691" };
  const l39 = defectKey({ ...base, citations: ["packages/cli/src/output/formatter.ts:39"] });
  const l44 = defectKey({ ...base, citations: ["packages/cli/src/output/formatter.ts:44"] });
  assert.notEqual(l39, l44, "line number participates — one file holds several defects");
  assert.notEqual(l39, defectKey({ ...base, oracle: "crash", citations: ["packages/cli/src/output/formatter.ts:39"] }));
  assert.notEqual(l39, defectKey({ ...base, charterId: "crash", citations: ["packages/cli/src/output/formatter.ts:39"] }));
});

test("defectKey: unlocatable citations yield NO key rather than a shared one", () => {
  // Returning a constant would silently group every unlocatable candidate under
  // one key, so two unrelated vague candidates would look like agreement.
  assert.equal(defectKey({ charterId: "c", oracle: "contract", citations: ["looks fine"] }), "");
  assert.equal(defectKey({ charterId: "c", oracle: "contract", citations: [] }), "");
  assert.equal(defectKey({ charterId: "c", oracle: "contract" }), "");
  assert.equal(defectKey({}), "");
  // A doc citation alone is enough to identify a doc-side defect.
  assert.notEqual(defectKey({ charterId: "c", oracle: "contract", citations: [], docCitation: "docs/design/cli.md:691" }), "");
});
