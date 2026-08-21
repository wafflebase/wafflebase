// What is tested here is the IDENTITY, not the hash. `sha256` of a known string is
// node's problem; what is this project's problem is that the digest is equal exactly
// when the reviewer is the same — so these tests are about the file SET being complete,
// about two panels not colliding, and about a pooled score refusing rather than
// averaging two reviewers.
//
// 🔴 THE FIRST TEST IS THE ONE THAT EARNS ITS KEEP. Every other property here is checked
// by construction somewhere; "a new panel module silently left the identity" is checked
// nowhere else, cannot be noticed by reading a diff of `review-panel.mjs`, and would
// make every digest afterwards quietly wrong in the flattering direction — two panels
// that differ would keep pooling into one score, which is the defect this whole module
// is a fix for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOT_PANEL_FILES,
  PANEL_DIGEST_ABSENT,
  PANEL_DIGEST_MIXED,
  PANEL_DIGEST_VERSION,
  PANEL_ENTRY,
  PANEL_FILES,
  isPanelDigest,
  localImportsOf,
  panelDigest,
  panelDigestOf,
  panelManifest,
  readPanelFiles,
  resolvePanelDigest,
  tallyPanelDigests,
} from "./panel-identity.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = path.join(HERE, "..");

/** `[{name, content}]`, the shape `panelDigest` takes, from a plain object. */
const files = (obj) => Object.entries(obj).map(([name, content]) => ({ name, content }));

test("🔴 nothing escapes the declared panel: every local import is classified, or this fails", () => {
  // THE WALK. It starts at `review-panel.mjs` and descends only into modules the set
  // CLAIMS as the panel — a module declared not-the-panel does not have its own imports
  // walked, because they are not the panel either and the register would otherwise grow
  // to twenty entries about GitHub I/O.
  //
  // A transitive closure is the wrong IDENTITY (measured: 13 modules at the pilot's
  // panel, 17 at `main`, four of them not the reviewer) and exactly the right
  // ASSERTION: the set is declared by hand, and this proves the declaration is complete.
  const classified = new Set([...PANEL_FILES, ...Object.keys(NOT_PANEL_FILES)]);
  const seen = new Set();
  const queue = [PANEL_ENTRY];
  const escaped = [];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const spec of localImportsOf(readFileSync(path.join(AGENT_DIR, rel), "utf8"))) {
      // Resolved against the IMPORTING file and then made relative to `scripts/agent`,
      // so an import reaching out of the directory (`../eval/x.mjs`) is a path this set
      // does not contain rather than a basename that looks like one it does.
      const target = path.relative(AGENT_DIR, path.resolve(AGENT_DIR, path.dirname(rel), spec));
      if (!classified.has(target)) escaped.push(`${rel} imports ${spec} → ${target}`);
      else if (PANEL_FILES.includes(target)) queue.push(target);
    }
  }
  assert.deepEqual(
    escaped,
    [],
    `${escaped.length} local import(s) reachable from ${PANEL_ENTRY} are in neither PANEL_FILES nor NOT_PANEL_FILES. ` +
      "Add each to one of them — to PANEL_FILES if it can change what the panel finds or which lane a finding lands " +
      `in, to NOT_PANEL_FILES with a reason if it cannot:\n  ${escaped.join("\n  ")}`,
  );
  // The walk has to have actually gone somewhere. Without this a regex that matched
  // nothing — a rename of the import syntax, a mangled pattern — would report a clean
  // set over one file and the assertion above would pass vacuously.
  assert.ok(seen.size >= PANEL_FILES.length, `the walk reached ${seen.size} of ${PANEL_FILES.length} declared panel files`);

  // Every exclusion carries a REASON, the same rule `COSMETIC_CONFIG_FIELDS` is held to
  // one level down: a module cannot be dropped out of the reviewer's identity without
  // somebody writing down why.
  for (const [file, why] of Object.entries(NOT_PANEL_FILES)) {
    assert.equal(typeof why, "string", `${file} has no reason`);
    assert.ok(why.trim().length > 20, `${file}'s reason is too short to be one: ${JSON.stringify(why)}`);
  }
  // And the register holds no DEAD entries. An exclusion for a module nothing imports
  // any more is a reason nobody will re-read, and it hides the fact that the file left.
  for (const file of Object.keys(NOT_PANEL_FILES)) {
    assert.ok(seen.size > 0 && existsSync(path.join(AGENT_DIR, file)), `NOT_PANEL_FILES names ${file}, which is not there`);
  }
  // The two sets are disjoint. A file in both would make the walk's answer depend on
  // which membership test ran first.
  for (const f of PANEL_FILES) assert.equal(f in NOT_PANEL_FILES, false, `${f} is declared both panel and not-panel`);
});

test("the digest is over CONTENT and not paths, so a moved panel is the same panel", () => {
  const a = { "review-panel.mjs": "the panel", "severity.mjs": "the lanes" };
  // #830 deleted `scripts/agent` and #850 returned it byte-identical. A path-keyed
  // identity calls that two reviewers and refuses to pool runs that cannot differ; this
  // is the assertion that keeps it one.
  const moved = [
    { name: "scripts/agent/review-panel.mjs", content: "the panel" },
    { name: "some/other/place/severity.mjs", content: "the lanes" },
  ];
  assert.equal(panelDigest(files(a)), panelDigest(moved));
  // Declaration ORDER is not identity either, or tidying `PANEL_FILES` would look like a
  // new reviewer.
  assert.equal(panelDigest(files(a)), panelDigest(files(a).reverse()));
  // One byte in one file IS identity. This is the direction that matters: #881 added a
  // third gate to `routeFinding`, which changes which findings gate.
  assert.notEqual(panelDigest(files(a)), panelDigest(files({ ...a, "review-panel.mjs": "the panel." })));
  // A file leaving or arriving moves it too — a digest that only saw contents could not
  // tell a panel of two files from a panel of one.
  assert.notEqual(panelDigest(files(a)), panelDigest(files({ "review-panel.mjs": "the panel" })));
  assert.match(panelDigest(files(a)), /^sha256:[0-9a-f]{64}$/);
  assert.equal(isPanelDigest(panelDigest(files(a))), true);
  // The manifest is the answer to WHICH FILE MOVED, so it names them and their hashes.
  assert.match(panelManifest(files(a)), /^review-panel\.mjs [0-9a-f]{64}\nseverity\.mjs [0-9a-f]{64}\n$/);
});

test("🔴 a STATED panel digest may fill in for records that recorded none, never override them", () => {
  const A = `sha256:${"a".repeat(64)}`, B = `sha256:${"b".repeat(64)}`, STATED = `sha256:${"c".repeat(64)}`;
  const rec = (id, panelDigest) => ({ id, panelDigest });

  // THE ONE CASE IT IS FOR: runs that recorded nothing, where computing the panel out of git
  // afterwards is the only way to attribute their scores at all. Recorded as `reconstructed`,
  // because it was asserted rather than observed.
  const filled = resolvePanelDigest({ records: [rec("k1"), rec("k2")], stated: STATED });
  assert.equal(filled.digest, STATED);
  assert.equal(filled.source, "reconstructed");
  assert.equal(filled.mixed, false);

  // 🔴 REJECTION 1 — the records already agree on a DIFFERENT panel. A flag that won here
  // would be an assertion overriding a measurement, and nothing downstream could tell.
  assert.throws(() => resolvePanelDigest({ records: [rec("k1", A), rec("k2", A)], stated: STATED }), (e) => {
    assert.match(e.message, /may only fill in for records that recorded none/);
    assert.match(e.message, new RegExp(`${A} × 2`));
    return true;
  });
  // ...and equally when it agrees: still refused, because "the flag happened to match" is not
  // a rule anyone can rely on, and the records are the better source either way.
  assert.throws(() => resolvePanelDigest({ records: [rec("k1", A)], stated: A }), /may only fill in/);

  // 🔴 REJECTION 2 — a MIXED pool. This is the one that matters: the live run pools five
  // panels, and a stated digest that bypassed the records would file it under one of them
  // with no diagnostic anywhere. That is the exact defect the cross-run key exists to remove,
  // reintroduced at the command line.
  const mixedPool = [rec("k1", A), rec("k2", A), rec("k3", B)];
  assert.throws(() => resolvePanelDigest({ records: mixedPool, stated: STATED }), (e) => {
    assert.match(e.message, /may only fill in for records that recorded none/);
    assert.match(e.message, /score each panel separately or pass the mixed-panel opt-out/);
    return true;
  });
  // The opt-out does not rescue it either: `mixed` is what a RESOLUTION lands in, and a
  // stated digest is a claim about one reviewer, so the two cannot both be true.
  assert.throws(() => resolvePanelDigest({ records: mixedPool, stated: STATED, allowMixed: true }), /may only fill in/);
  // Without the flag the pool behaves exactly as before — the automatic path is untouched.
  assert.equal(resolvePanelDigest({ records: mixedPool, allowMixed: true }).digest, PANEL_DIGEST_MIXED);
  assert.equal(resolvePanelDigest({ records: [rec("k1"), rec("k2")] }).digest, PANEL_DIGEST_ABSENT);

  // A named state is not something to assert: it is where a resolution lands.
  for (const bad of [PANEL_DIGEST_ABSENT, PANEL_DIGEST_MIXED, "sha256:nothex", 7]) {
    assert.throws(() => resolvePanelDigest({ records: [rec("k1")], stated: bad }), /stated panel digest must be sha256/, `${JSON.stringify(bad)} was accepted`);
  }
  // Empty/absent `stated` means "not stated" and leaves the automatic path alone.
  for (const none of [null, undefined, ""]) {
    assert.equal(resolvePanelDigest({ records: [rec("k1", A)], stated: none }).digest, A);
  }
});

test("a declared file that is NOT THERE is hashed as absent, which is not the same as omitted", () => {
  // 🔴 MEASURED, and it is why this state exists: `review-surface.mjs` — the post-freeze
  // demotion #881 added — does not exist at the pilot's panel commit `46da673dd`. The
  // pilot's panel is a different SHAPE from `main`'s, not merely different bytes, and a
  // backfill that could not say so could not name the pilot's panel at all.
  const present = { "review-panel.mjs": "the panel", "review-surface.mjs": "the freeze gate" };
  const marked = [{ name: "review-panel.mjs", content: "the panel" }, { name: "review-surface.mjs", absent: true }];
  assert.match(panelManifest(marked), /^review-panel\.mjs [0-9a-f]{64}\nreview-surface\.mjs absent\n$/);
  // `absent` is 6 characters and a content hash is 64, so a panel missing a file and a
  // panel containing ANY version of it can never be one digest.
  assert.notEqual(panelDigest(marked), panelDigest(files(present)));
  // 🔴 AND NOT THE SAME AS DROPPING THE FILE FROM THE SET. "this panel had no
  // review-surface.mjs" and "this digest was computed before review-surface.mjs was
  // declared" are different facts, and conflating them would silently pool a pre-#881
  // panel with a post-#881 one whose file the declaration had not caught up to.
  assert.notEqual(panelDigest(marked), panelDigest(files({ "review-panel.mjs": "the panel" })));
  // The opt-in is what produces it. Without `allowAbsent`, an unreadable file still
  // refuses — the run path must never turn a broken checkout into a confident identity.
  const missing = () => { throw new Error("ENOENT"); };
  assert.throws(() => readPanelFiles({ read: missing }), /could not be read/);
  const read = readPanelFiles({ read: missing, files: ["severity.mjs"], allowAbsent: true });
  assert.deepEqual(read.map((f) => [f.name, f.absent]), [["severity.mjs", true]]);
  // The reason travels, so the CLI can say WHICH files the panel did not have.
  assert.match(read[0].why, /ENOENT/);
});

test("a digest that cannot be trusted is refused rather than computed", () => {
  // 🔴 DUPLICATE BASENAMES. The digest is keyed by basename, so two files sharing one
  // would collapse into a single manifest line and the second file's contents would stop
  // identifying the panel — a digest that is quietly wrong, which is the one failure this
  // module may not have. It cannot happen with today's flat set; this is what keeps that
  // true the day a subdirectory appears.
  assert.throws(
    () => panelDigest([{ name: "a/severity.mjs", content: "x" }, { name: "b/severity.mjs", content: "y" }]),
    /two panel files share the basename/,
  );
  // An EMPTY read is what a missing file looks like. Hashing it would record a confident
  // identity for a panel that was not there — which is precisely the state the repository
  // was in for the two commits between #830 and #850.
  assert.throws(() => panelDigest(files({ "review-panel.mjs": "" })), /has no contents/);
  assert.throws(() => panelDigest([{ name: "review-panel.mjs" }]), /has no contents/);
  assert.throws(() => panelDigest([]), /at least one file/);
  // A name that could smuggle a manifest line, and so build a collision by hand.
  for (const bad of ["a b.mjs", "a\nb.mjs", "", "-leading"]) {
    assert.throws(() => panelDigest([{ name: bad, content: "x" }]), /panel file name must match/, `${JSON.stringify(bad)} was accepted`);
  }
  // `readPanelFiles` refuses at the same door, so a caller cannot reach `panelDigest`
  // with a partial panel by degrading its own reads.
  assert.throws(() => readPanelFiles({ read: () => { throw new Error("ENOENT"); } }), /could not be read/);
  assert.throws(() => readPanelFiles({ read: () => "  " }), /read back empty/);
  assert.throws(() => readPanelFiles({}), /needs a read\(relativePath\) function/);
});

test("this checkout's panel hashes to a stable digest, over files that are all there", () => {
  // Not a golden value — that would redden on every legitimate panel change, which is
  // the whole point of the digest moving. What is asserted is that the declared set is
  // READABLE off a real checkout (a missing file refuses, so this covers it), that the
  // digest is stable across two calls, and that the vintage travels with it.
  const digest = panelDigestOf(AGENT_DIR);
  assert.equal(isPanelDigest(digest), true);
  assert.equal(digest, panelDigestOf(AGENT_DIR));
  assert.match(PANEL_DIGEST_VERSION, /^wafflebase\/panel-digest@\d+$/);
  // Every declared file exists and is non-trivial. A typo in `PANEL_FILES` would
  // otherwise only surface on the next real run.
  for (const rel of PANEL_FILES) {
    assert.ok(readFileSync(path.join(AGENT_DIR, rel), "utf8").length > 100, `${rel} is missing or nearly empty`);
  }
  // The entry point is part of what it is the identity OF.
  assert.ok(PANEL_FILES.includes(PANEL_ENTRY));
});

test("localImportsOf finds all three import forms, and no third-party ones", () => {
  const source = [
    'import { classify } from "./severity.mjs";',
    'import path from "node:path";',
    'import { z } from "zod";',
    'import "./side-effect.mjs";',
    'import {\n  A,\n  B,\n} from "./rebuttal.mjs";',
    'export { classifyResult } from "./ask.mjs";',
    'const m = await import("./lazy.mjs");',
    'import x from "../outside.mjs";',
  ].join("\n");
  assert.deepEqual(localImportsOf(source), [
    "../outside.mjs",
    "./ask.mjs",
    "./lazy.mjs",
    "./rebuttal.mjs",
    "./severity.mjs",
    "./side-effect.mjs",
  ]);
  // `export … from` is not decoration: `review-panel.mjs` really does re-export through
  // one, and a from-only pattern over `import` alone would have missed it.
  assert.ok(localImportsOf(readFileSync(path.join(AGENT_DIR, PANEL_ENTRY), "utf8")).includes("./ask.mjs"));
  assert.deepEqual(localImportsOf(""), []);
  assert.deepEqual(localImportsOf(null), []);
});

test("a pool of records resolves to ONE panel, or says which panels it would have crossed", () => {
  const A = `sha256:${"a".repeat(64)}`;
  const B = `sha256:${"b".repeat(64)}`;
  const rec = (id, panelDigest) => ({ id, panelDigest });

  // One panel: the ordinary case, and the pilot's — three legs agreeing.
  assert.deepEqual(resolvePanelDigest({ records: [rec("k1", A), rec("k2", A), rec("k3", A)] }), {
    digest: A,
    mixed: false,
    tally: [{ digest: A, items: 3, ids: ["k1", "k2", "k3"] }],
    // Everything this function answers was READ off stored records, so it says so. A caller
    // that instead states a digest does not come through here and stamps `reconstructed`.
    source: "envelopes",
  });

  // 🔴 NEVER PICKS THE FIRST, AND NEVER THE MAJORITY. This is the live shape: 16 items,
  // one of which ran a panel carrying a gate the other fifteen do not have. A rule that
  // resolved 15-against-1 would be a rule for hiding it.
  const lopsided = [...Array(15)].map((_, i) => rec(`pr-${i}`, A)).concat(rec("pr-899", B));
  assert.throws(() => resolvePanelDigest({ records: lopsided }), (e) => {
    assert.match(e.message, /state 2 panel digests/);
    // The message NAMES the panels and counts the items on each, because "these disagree"
    // is not actionable and "15 on this one, 1 on that one" is.
    assert.match(e.message, new RegExp(`${A} × 15`));
    assert.match(e.message, new RegExp(`${B} × 1`));
    return true;
  });

  // The opt-out files it, as `mixed`, with the mixture available to be stamped.
  const mixed = resolvePanelDigest({ records: lopsided, allowMixed: true });
  assert.equal(mixed.digest, PANEL_DIGEST_MIXED);
  assert.equal(mixed.mixed, true);
  assert.equal(mixed.source, "envelopes");
  assert.deepEqual(mixed.tally.map((t) => [t.digest, t.items]), [[A, 15], [B, 1]]);

  // ABSENT IS A NAMED STATE, not a blank and not a zero — every envelope written before
  // `panel_digest` existed is in it. Lesson 6: "nobody recorded this" and "this is the
  // same as that" are different facts, and the second is the one that would be assumed.
  assert.equal(resolvePanelDigest({ records: [rec("k1"), rec("k2", "")] }).digest, PANEL_DIGEST_ABSENT);
  // PARTIALLY absent is a MIXTURE, which is the case that would otherwise pool the
  // silent record under the stated one's identity — the bug, with an extra step.
  assert.throws(() => resolvePanelDigest({ records: [rec("k1", A), rec("k2")] }), /state 2 panel digests/);
  assert.equal(resolvePanelDigest({ records: [rec("k1", A), rec("k2")], allowMixed: true }).digest, PANEL_DIGEST_MIXED);

  // A digest that is present and malformed is refused at the same door `config_hash` is,
  // rather than being counted as its own panel.
  for (const bad of ["sha256:nothex", "46da673dd46dd5576626ee6d1b4e2e40728345e0", "sha256-" + "a".repeat(64), 7]) {
    assert.throws(() => tallyPanelDigests([rec("k1", bad)]), /neither/, `${JSON.stringify(bad)} was accepted`);
  }
  // No records at all is a caller who cannot be checked, not a pool of one panel.
  assert.throws(() => resolvePanelDigest({ records: [] }), /must name the records it pools/);
  assert.throws(() => resolvePanelDigest({}), /must name the records it pools/);
});
