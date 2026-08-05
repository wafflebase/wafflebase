import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCaptureStore } from "./capture-store.mjs";

/** A store rooted in a throwaway directory, and the directory, so a test can look inside. */
function tempStore() {
  const root = mkdtempSync(path.join(tmpdir(), "capture-store-test-"));
  return { root, store: createCaptureStore(root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const KEY = "stage-detail/channel=gating/pr=648/sha=1a2b3c4d/run=30891782298/attempt=1/correctness.json";

test("putCapture: writes the bytes it was given, at the key it was given", () => {
  const { root, store, cleanup } = tempStore();
  try {
    assert.equal(store.hasCapture(KEY), false);
    assert.equal(store.putCapture(KEY, '{"samples":[[]]}'), "written");
    assert.equal(store.hasCapture(KEY), true);
    assert.equal(readFileSync(path.join(root, ...KEY.split("/")), "utf8"), '{"samples":[[]]}');
  } finally { cleanup(); }
});

test("putCapture is WRITE-ONCE: a second put is 'present' and does not change the bytes", () => {
  // Invariant B/C. The key contains the producing run and attempt, so it names
  // one execution and its bytes never legitimately change. That is what makes
  // re-running the collector, two collectors racing and a wide `--since`
  // re-scan the same harmless operation — and it is the property the whole
  // retry story rests on, so it is pinned here rather than assumed.
  const { root, store, cleanup } = tempStore();
  try {
    assert.equal(store.putCapture(KEY, "first"), "written");
    assert.equal(store.putCapture(KEY, "SECOND — must not land"), "present");
    assert.equal(readFileSync(path.join(root, ...KEY.split("/")), "utf8"), "first");
  } finally { cleanup(); }
});

test("putCapture: a partial write never leaves a truncated file AT the key", () => {
  // The temp-file-and-rename rule. A crash mid-write straight onto the key would
  // leave a short file that `hasCapture` reports as collected forever, because
  // write-once will never overwrite it — this subsystem's signature failure
  // (something looks collected and is not) rebuilt inside the module meant to
  // prevent it. Simulated by planting the debris a crashed write would leave.
  const { root, store, cleanup } = tempStore();
  try {
    const abs = path.join(root, ...KEY.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    // The name THIS process's own `putCapture` would leave behind, not an
    // invented one. Planting `.part-99999` tested the filter against a literal
    // the test itself chose, so renaming the marker in `capture-store.mjs` would
    // have left the debris visible as a capture with every test still green. Using
    // `process.pid` couples the assertion to the producer's real format.
    writeFileSync(`${abs}.part-${process.pid}`, "half a fi");
    assert.equal(store.hasCapture(KEY), false, "a .part- leftover is not a capture");
    assert.deepEqual(store.listCaptures(), [], "and listCaptures must not report it as one");
    // And the write still succeeds over its own debris. Planting the REAL temp
    // name found a bug the invented `.part-99999` could not: the `wx` open hit
    // EEXIST, so a stale temp file from an earlier run whose pid the OS recycled
    // made the key unwritable for a whole run. `putCapture` clears its own
    // `.part-<pid>` first — safe because only one live process holds that pid.
    assert.equal(store.putCapture(KEY, "the whole file"), "written");
    assert.equal(readFileSync(abs, "utf8"), "the whole file");
    assert.deepEqual(store.listCaptures(), [KEY], "and no debris survives the write");
  } finally { cleanup(); }
});

test("a leftover from ANOTHER process is excluded too", () => {
  // The realistic shape: the crashed writer was a different run, so its pid is
  // not ours. Same exclusion, and it pins that the filter matches the marker
  // rather than this process's own number.
  const { root, store, cleanup } = tempStore();
  try {
    const abs = path.join(root, ...KEY.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(`${abs}.part-4242`, "half a fi");
    assert.deepEqual(store.listCaptures(), []);
  } finally { cleanup(); }
});

test("listCaptures degrades on an unreadable SUBDIRECTORY and refuses on an unreadable ROOT", () => {
  // The two halves of one fail direction, and they point opposite ways on
  // purpose. A nested directory that cannot be read costs its own keys: fewer
  // keys known means "collect it again", which write-once makes free, and it
  // must not take down the expiry report over one bad directory. An unreadable
  // ROOT is a real fault — answering "[]" there would report an empty store, the
  // collector would re-collect everything into a directory it also cannot write,
  // and the reason would never be named.
  const { root, store, cleanup } = tempStore();
  try {
    store.putCapture(KEY, "{}");
    const locked = path.join(root, "stage-detail", "channel=advisory");
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    try {
      assert.deepEqual(store.listCaptures(), [KEY], "the healthy key survives one unreadable sibling");
    } finally {
      chmodSync(locked, 0o755);
    }

    chmodSync(root, 0o000);
    try {
      assert.throws(() => store.listCaptures(), /EACCES|EPERM/, "an unreadable root must not read as an empty store");
    } finally {
      chmodSync(root, 0o755);
    }
  } finally { cleanup(); }
});

test("listCaptures: sorted keys, and [] for a store that does not exist yet", () => {
  const { store, cleanup } = tempStore();
  try {
    assert.deepEqual(store.listCaptures(), []);
    store.putCapture("stage-detail/channel=advisory/pr=669/sha=c18b6abb/run=30889625585/attempt=1/security.json", "{}");
    store.putCapture("stage-detail/channel=advisory/pr=669/sha=c18b6abb/run=30889625585/attempt=1/meta.json", "{}");
    assert.deepEqual(store.listCaptures(), [
      "stage-detail/channel=advisory/pr=669/sha=c18b6abb/run=30889625585/attempt=1/meta.json",
      "stage-detail/channel=advisory/pr=669/sha=c18b6abb/run=30889625585/attempt=1/security.json",
    ]);
  } finally { cleanup(); }
});

test("listCaptures: a missing root is [] and not a throw", () => {
  // First run, before anything has ever been collected. A read path degrades.
  const store = createCaptureStore(path.join(tmpdir(), "capture-store-does-not-exist-" + process.pid));
  assert.deepEqual(store.listCaptures(), []);
});

test("every method REFUSES a key that would escape the store", () => {
  // `meta.json` travels out of a runner that processed untrusted branch content,
  // so a key can carry whatever a hostile capture put in a field. `keyFor`
  // validates first; this is the second line, on the module that actually
  // touches the filesystem.
  const { root, store, cleanup } = tempStore();
  try {
    for (const bad of [
      "../escaped.json",
      "stage-detail/../../escaped.json",
      "/etc/passwd",
      "stage-detail/./x.json",
      "stage-detail\\channel=gating\\x.json",
      "stage-detail/pr=1;rm -rf/x.json",
      "stage-detail/pr=1/x.json\0.png",
      "",
      null,
    ]) {
      assert.throws(() => store.hasCapture(bad), /capture store:/, `hasCapture accepted ${JSON.stringify(bad)}`);
      assert.throws(() => store.putCapture(bad, "x"), /capture store:/, `putCapture accepted ${JSON.stringify(bad)}`);
    }
    assert.deepEqual(store.listCaptures(), [], "no refusal may have written anything");
    // And nothing was created next to the store either.
    assert.equal(store.hasCapture("escaped.json"), false);
    assert.deepEqual(createCaptureStore(root).listCaptures(), []);
  } finally { cleanup(); }
});

test("a `..` segment is refused AS TRAVERSAL, not as a bad character", () => {
  // The segment grammar would reject `..` anyway — it must start with
  // `[A-Za-z0-9]` — so this check is redundant for SAFETY and load-bearing for
  // the MESSAGE. That distinction is the whole reason the check is written out
  // separately, and without this assertion a mutation that deletes it survives:
  // the key is still refused, but the log now says "is not
  // [A-Za-z0-9][A-Za-z0-9._=-]*" about a path that was trying to escape the
  // store. A reader given the second message goes looking for a character-set
  // bug. `meta.json` comes out of a runner that processed untrusted branch
  // content, so this is the one refusal whose text has to name what happened.
  const { store, cleanup } = tempStore();
  try {
    assert.throws(() => store.putCapture("stage-detail/../escaped.json", "x"), /escapes the store/);
    assert.throws(() => store.hasCapture("stage-detail/../escaped.json"), /escapes the store/);
    assert.throws(() => store.putCapture("stage-detail/./x.json", "x"), /escapes the store/);
  } finally { cleanup(); }
});

test("putCapture refuses contents that are not bytes", () => {
  // `io.read` returns a Buffer and a test may hand over a string; anything else
  // (an object, `undefined` from a mis-destructured result) would be written as
  // "[object Object]" and stored as a capture forever.
  const { store, cleanup } = tempStore();
  try {
    assert.throws(() => store.putCapture(KEY, { samples: [] }), /must be a string or Buffer/);
    assert.throws(() => store.putCapture(KEY, undefined), /must be a string or Buffer/);
    assert.equal(store.hasCapture(KEY), false);
  } finally { cleanup(); }
});

test("the store has exactly three methods", () => {
  // Not style policing. PR 3 (the loader) extends this surface; a fourth method
  // added here on speculation is one the S3 implementation must also satisfy,
  // untested, for a caller that does not exist.
  const { store, cleanup } = tempStore();
  try {
    assert.deepEqual(Object.keys(store).sort(), ["hasCapture", "listCaptures", "putCapture"]);
  } finally { cleanup(); }
});

test("there is NO default root — a store must be told where it is", () => {
  // The store used to default to `scripts/agent/eval/captures`, a path inside
  // this repository. It now lives in the separate eval repo, and the reason a
  // stale default would be worse than useless is that **git history is
  // permanent**: one `--write` with a forgotten `--root` commits capture data
  // into whichever repo the code sits in, for good, and no later `git rm`
  // shrinks anyone's clone. The location is a deliberate decision, so omitting
  // it is a refusal rather than a guess.
  for (const bad of [undefined, null, "", "   ", 42, {}]) {
    assert.throws(
      () => createCaptureStore(bad),
      /a root directory is required/,
      `createCaptureStore accepted ${JSON.stringify(bad)} as a root`,
    );
  }
});
