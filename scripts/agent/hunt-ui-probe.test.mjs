import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertSafeActionPlan,
  classifyUiError,
  oraclesFired,
  runUiPlan,
  assertFaultId,
  scrubUiVolatile,
  uiObservedKey,
  uiPlanKey,
  UI_ACTION_TYPES,
  UI_READER_PREFIXES,
} from "./hunt-ui-probe.mjs";

const okPlan = { actions: [{ type: "goto", surface: "doc" }] };

/** An observation as the driver emits one. */
function obs(over = {}) {
  return { index: 0, action: { type: "read", reader: "doc.fontSizes" }, ok: true, error: null, value: null, oracles: [], ...over };
}

// --- plan validation: the closed vocabulary ---------------------------------

test("assertSafeActionPlan accepts a well-formed plan", () => {
  assert.equal(assertSafeActionPlan(okPlan), true);
});

test("assertSafeActionPlan refuses an unknown action type", () => {
  assert.throws(
    () => assertSafeActionPlan({ actions: [{ type: "evaluate", script: "window.x=1" }] }),
    /unknown type "evaluate"/,
  );
});

test("assertSafeActionPlan refuses an empty or missing action list", () => {
  assert.throws(() => assertSafeActionPlan({ actions: [] }), /non-empty array/);
  assert.throws(() => assertSafeActionPlan({}), /non-empty array/);
  assert.throws(() => assertSafeActionPlan(null), /must be an object/);
});

// The reader prefix check is what stops a caller reaching outside the registry —
// there is no `eval.` namespace, so a typo AND an escape attempt both land here.
test("assertSafeActionPlan refuses a reader outside the known namespaces", () => {
  assert.throws(() => assertSafeActionPlan({ actions: [{ type: "read", reader: "eval.window" }] }), /must start with one of/);
  assert.throws(() => assertSafeActionPlan({ actions: [{ type: "read", reader: "" }] }), /needs a reader name/);
  assert.throws(() => assertSafeActionPlan({ actions: [{ type: "read" }] }), /needs a reader name/);
});

test("assertSafeActionPlan accepts every declared reader namespace", () => {
  for (const prefix of UI_READER_PREFIXES) {
    assert.equal(assertSafeActionPlan({ actions: [{ type: "read", reader: `${prefix}whatever` }] }), true);
  }
});

// A target with both forms is ambiguous, and one with neither is unresolvable.
// Either would be silently interpreted by the driver rather than refused.
test("assertSafeActionPlan refuses an ambiguous or empty click target", () => {
  assert.throws(
    () => assertSafeActionPlan({ actions: [{ type: "click", target: { role: "button", reader: "sheet.cellCenter" } }] }),
    /exactly one of/,
  );
  assert.throws(() => assertSafeActionPlan({ actions: [{ type: "click", target: {} }] }), /exactly one of/);
  assert.throws(() => assertSafeActionPlan({ actions: [{ type: "click" }] }), /needs a target object/);
});

test("assertSafeActionPlan refuses a click target whose reader escapes the namespaces", () => {
  assert.throws(
    () => assertSafeActionPlan({ actions: [{ type: "click", target: { reader: "eval.point" } }] }),
    /must start with one of/,
  );
});

// `button` and `clickCount` reach Playwright verbatim. An unvalidated button fails
// inside the driver instead of at validation, and a huge clickCount does not fail at
// all — it hangs.
test("assertSafeActionPlan refuses an unsupported mouse button", () => {
  const withButton = (button) => ({ actions: [{ type: "click", target: { role: "button", name: "x" }, button }] });
  assert.equal(assertSafeActionPlan(withButton("right")), true);
  assert.throws(() => assertSafeActionPlan(withButton("scroll")), /button must be one of/);
  assert.throws(() => assertSafeActionPlan(withButton(1)), /button must be one of/);
});

test("assertSafeActionPlan bounds clickCount", () => {
  const withCount = (clickCount) => ({ actions: [{ type: "click", target: { role: "button", name: "x" }, clickCount }] });
  assert.equal(assertSafeActionPlan(withCount(2)), true);
  assert.throws(() => assertSafeActionPlan(withCount(1_000_000)), /clickCount must be an integer in 1\.\.3/);
  assert.throws(() => assertSafeActionPlan(withCount(0)), /clickCount must be an integer in 1\.\.3/);
  assert.throws(() => assertSafeActionPlan(withCount(1.5)), /clickCount must be an integer in 1\.\.3/);
});

test("assertSafeActionPlan refuses a goto to an unknown surface", () => {
  // Names the valid surfaces from the shared list rather than a pair spelled out here, so
  // adding one does not silently leave this assertion describing the old vocabulary.
  assert.throws(
    () => assertSafeActionPlan({ actions: [{ type: "goto", surface: "slides" }] }),
    /surface must be one of sheet, doc/,
  );
});

test("assertSafeActionPlan refuses malformed type/key/scroll payloads", () => {
  assert.throws(() => assertSafeActionPlan({ actions: [{ type: "type", text: 42 }] }), /string `text`/);
  assert.throws(() => assertSafeActionPlan({ actions: [{ type: "key", key: "" }] }), /non-empty `key`/);
  assert.throws(() => assertSafeActionPlan({ actions: [{ type: "scroll", dy: "far" }] }), /finite numbers/);
});

test("UI_ACTION_TYPES has no execution escape hatch", () => {
  for (const banned of ["evaluate", "eval", "script", "exec", "goto-url"]) {
    assert.equal(UI_ACTION_TYPES.includes(banned), false, `${banned} must not be an action type`);
  }
});

// --- outcome shape ----------------------------------------------------------

test("uiObservedKey ignores volatile block ids", () => {
  // Both strings are REAL output, captured from two attempts of the same plan:
  // generateBlockId() is `block-${Date.now()}-${counter}`. Without scrubbing, every
  // candidate that reads a selection would replay as non-deterministic and be dropped.
  const a = obs({ action: { type: "read", reader: "doc.selection" }, value: '{"anchor":{"blockId":"block-1785735868118-3","offset":0}}' });
  const b = obs({ action: { type: "read", reader: "doc.selection" }, value: '{"anchor":{"blockId":"block-1785735870911-3","offset":0}}' });
  assert.equal(uiObservedKey(a), uiObservedKey(b));
});

test("uiObservedKey keeps the block ORDINAL, which is real signal", () => {
  const a = obs({ value: '{"blockId":"block-1785735868118-3"}' });
  const b = obs({ value: '{"blockId":"block-1785735868118-5"}' });
  assert.notEqual(uiObservedKey(a), uiObservedKey(b));
});

// The single most important assertion in this file. For a CLI probe the outcome is
// the exit code; for a UI read the VALUE is the outcome. If the value did not
// participate in the key, [11,18,32] and [11,11,11] would be the same observation
// and the hunter would be structurally unable to see a formatting defect at all.
test("uiObservedKey distinguishes different read values", () => {
  const before = obs({ value: "[11,18,32]" });
  const after = obs({ value: "[11,11,11]" });
  assert.notEqual(uiObservedKey(before), uiObservedKey(after));
});

test("uiObservedKey hashes an oversized value instead of inlining it", () => {
  const key = uiObservedKey(obs({ value: "x".repeat(5000) }));
  assert.match(key, /value:sha256:[0-9a-f]{16}$/);
  assert.ok(key.length < 300, `key should stay bounded, got ${key.length} chars`);
});

test("uiObservedKey distinguishes which oracle fired, not how often", () => {
  const once = obs({ oracles: [{ kind: "dom-invariant", rule: "duplicate-id", detail: "a" }] });
  const twice = obs({ oracles: [
    { kind: "dom-invariant", rule: "duplicate-id", detail: "a" },
    { kind: "dom-invariant", rule: "duplicate-id", detail: "b" },
  ] });
  const other = obs({ oracles: [{ kind: "dom-invariant", rule: "placeholder-text", detail: "undefined" }] });
  assert.equal(uiObservedKey(once), uiObservedKey(twice), "same rule twice is the same outcome");
  assert.notEqual(uiObservedKey(once), uiObservedKey(other), "a different rule is a different outcome");
});

test("uiObservedKey separates a clean action from one that fired an oracle", () => {
  assert.notEqual(uiObservedKey(obs()), uiObservedKey(obs({ oracles: [{ kind: "pageerror" }] })));
});

test("classifyUiError collapses timeouts that differ only in duration", () => {
  assert.equal(classifyUiError("Timeout 10000ms exceeded."), "timeout");
  assert.equal(classifyUiError("Timeout 30000ms exceeded."), "timeout");
  assert.equal(
    uiObservedKey(obs({ ok: false, error: "Timeout 10000ms exceeded." })),
    uiObservedKey(obs({ ok: false, error: "Timeout 30000ms exceeded." })),
  );
});

test("classifyUiError keeps distinct failure classes distinct", () => {
  const classes = [
    classifyUiError('[hunt-bridge] unknown reader "doc.nope". Valid readers: a, b'),
    classifyUiError("[hunt-bridge] doc reader used while surface is \"sheet\" — goto the doc surface first"),
    classifyUiError("unresolvable target {}"),
    classifyUiError("Timeout 5000ms exceeded."),
  ];
  assert.deepEqual(classes, ["unknown-reader", "wrong-surface", "unresolvable-target", "timeout"]);
});

test("classifyUiError scrubs volatile paths out of an unclassified message", () => {
  const key = classifyUiError("boom at /var/folders/xy/T/wb-hunt-ui-abc123/plan.json:4");
  assert.ok(!key.includes("wb-hunt-ui-abc123"), `temp path leaked into the error class: ${key}`);
});

test("scrubUiVolatile still applies the shared scrubber", () => {
  // Layered on scrubVolatile rather than replacing it, so the CLI and UI hunters
  // cannot drift on what "volatile" means.
  assert.equal(scrubUiVolatile("id 550e8400-e29b-41d4-a716-446655440000"), "id <UUID>");
});

// --- plan-level key ---------------------------------------------------------

test("uiPlanKey notices a divergence that is not the last observation", () => {
  // replay() keys only the LAST observation. For a UI plan the failing action is
  // usually mid-sequence with reads after it, so a last-only key would call two
  // materially different runs identical.
  const good = [obs({ index: 0, value: "[11,18,32]" }), obs({ index: 1, value: "done" })];
  const bad = [obs({ index: 0, value: "[11,11,11]" }), obs({ index: 1, value: "done" })];
  assert.notEqual(uiPlanKey(good), uiPlanKey(bad));
  assert.equal(uiObservedKey(good.at(-1)), uiObservedKey(bad.at(-1)), "last observation alone cannot tell them apart");
});

test("uiPlanKey is stable for identical attempts and counts length", () => {
  const run = [obs({ index: 0 }), obs({ index: 1 })];
  assert.equal(uiPlanKey(run), uiPlanKey([obs({ index: 0 }), obs({ index: 1 })]));
  assert.match(uiPlanKey(run), /^n:2\|/);
  assert.notEqual(uiPlanKey(run), uiPlanKey([obs({ index: 0 })]));
});

test("oraclesFired flattens every oracle with the action that caused it", () => {
  const fired = oraclesFired([
    obs({ index: 0 }),
    obs({ index: 1, oracles: [{ kind: "pageerror", detail: "boom" }] }),
    obs({ index: 2, oracles: [{ kind: "console-error", detail: "bad" }] }),
  ]);
  assert.deepEqual(fired.map((f) => [f.index, f.kind]), [[1, "pageerror"], [2, "console-error"]]);
});

// --- running ----------------------------------------------------------------

test("runUiPlan validates BEFORE spawning anything", () => {
  let called = false;
  assert.throws(
    () => runUiPlan({ actions: [{ type: "evaluate" }] }, { repoRoot: "/nope", runner: () => { called = true; } }),
    /unknown type/,
  );
  assert.equal(called, false, "an invalid plan must not reach the runner");
});

test("runUiPlan passes the plan and attempt count to an injected runner", () => {
  const seen = [];
  const result = runUiPlan(okPlan, {
    repoRoot: "/repo",
    attempts: 3,
    runner: (plan, opts) => {
      seen.push({ plan, opts });
      return [[obs()], [obs()], [obs()]];
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].opts.attempts, 3);
  assert.deepEqual(seen[0].plan, okPlan);
  assert.equal(result.length, 3);
});

test("runUiPlan refuses a non-positive attempt count", () => {
  assert.throws(() => runUiPlan(okPlan, { repoRoot: "/r", attempts: 0, runner: () => [] }), /positive integer/);
});

test("runUiPlan forwards a seeded fault to the runner", () => {
  // The positive control's plumbing. It shipped once with the serve-mode half
  // silently dropped, so both halves are now asserted where they can be.
  const seen = [];
  runUiPlan(okPlan, {
    repoRoot: "/repo",
    fault: "drop-second-char",
    runner: (_plan, opts) => {
      seen.push(opts);
      return [[obs()]];
    },
  });
  assert.equal(seen[0].fault, "drop-second-char");
  // Absent by default, so a normal hunt cannot accidentally run seeded.
  runUiPlan(okPlan, { repoRoot: "/repo", runner: (_p, opts) => { seen.push(opts); return [[obs()]]; } });
  assert.equal(seen[1].fault, null);
});

test("runUiPlan refuses a fault id that is not lowercase kebab-case, before spawning", () => {
  for (const bad of ["Drop-Second-Char", "drop second char", "../etc/passwd", "9lives", "a=b", ""]) {
    let called = false;
    assert.throws(
      () => runUiPlan(okPlan, { repoRoot: "/r", fault: bad, runner: () => { called = true; return []; } }),
      /lowercase kebab-case/,
      `fault ${JSON.stringify(bad)} must be refused`,
    );
    assert.equal(called, false, `fault ${JSON.stringify(bad)} must be refused BEFORE the runner is reached`);
  }
});

test("assertFaultId: only `null` means no fault — `undefined` is an ERROR", () => {
  // THE case the shipped bug turned on, and the one a string-only test cannot reach.
  //
  // A trailing `--fault` makes the runner's `argv[++i]` undefined. Validating with a
  // regex alone tested `String(undefined)` — the literal text "undefined", which is
  // lowercase letters and therefore MATCHES. So `--fault` with no value passed, and
  // the run went ahead with no fault injected and no complaint: a positive control
  // that silently switched itself off while still looking like it proved something.
  //
  // Tested here rather than only through `runUiPlan`/`openUiSession`, because both
  // default the parameter to `null` — so `undefined` can never reach them, and a
  // test routed through either would assert nothing about this branch. That is not
  // hypothetical: an earlier version of this suite passed with the `typeof` guard
  // deleted, because every case it tried was already a string.
  assert.throws(() => assertFaultId(undefined), /lowercase kebab-case/);
  for (const bad of [123, {}, [], true, false, ["drop-second-char"], { id: "drop-second-char" }]) {
    assert.throws(() => assertFaultId(bad), /lowercase kebab-case/, `${JSON.stringify(bad)} must be refused`);
  }
  // `null` is the ONLY accepted non-string, and a valid id passes through unchanged.
  assert.equal(assertFaultId(null), null);
  assert.equal(assertFaultId("drop-second-char"), "drop-second-char");
  assert.equal(assertFaultId("a"), "a");
  // The label reaches the message, so a `--fault` typo names the flag the user typed.
  assert.throws(() => assertFaultId(undefined, { label: "--fault" }), /--fault needs a lowercase/);
});

// A runner that died must NOT look like "the app did nothing". An empty observation
// array is a shape a caller could read as a finding; an exception cannot be.
test("runUiPlan throws when the driver cannot produce a result", () => {
  assert.throws(
    () => runUiPlan(okPlan, { repoRoot: "/definitely/not/a/repo", timeoutMs: 5000 }),
    /runner produced no readable result|runner failed/,
  );
});

// The other failure path: the driver ran, wrote a well-formed result, and reported
// `ok: false`. Distinct from the unreadable-output case above and separately
// reachable, so it gets its own stub rather than being assumed equivalent.
test("runUiPlan throws when the driver reports its own failure", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wb-hunt-ui-stub-"));
  try {
    const scriptDir = path.join(root, "packages", "frontend", "scripts");
    mkdirSync(scriptDir, { recursive: true });
    // A stand-in for the real runner: parses --out and reports a driver-level
    // failure, exactly as the runner does when Vite or Chromium cannot start.
    writeFileSync(
      path.join(scriptDir, "hunt-ui-runner.mjs"),
      [
        'import { writeFileSync } from "node:fs";',
        'const argv = process.argv.slice(2);',
        'const out = argv[argv.indexOf("--out") + 1];',
        'writeFileSync(out, JSON.stringify({ ok: false, error: "stub driver failure", attempts: [] }));',
        "process.exit(1);",
      ].join("\n"),
    );
    assert.throws(() => runUiPlan(okPlan, { repoRoot: root, timeoutMs: 20_000 }), /runner failed: stub driver failure/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- prediction validation (added in PR 2, untested until a review said so) ---

test("assertSafeActionPlan validates a prediction attached to any action", () => {
  const withExpect = (expect) => ({ actions: [{ type: "key", key: "z", expect }] });
  assert.equal(
    assertSafeActionPlan(
      withExpect({ read: "doc.text", op: "equals", value: "@read:0", ground: "A", because: "x" }),
    ),
    true,
  );
  assert.throws(() => assertSafeActionPlan(withExpect({ read: "doc.text", op: "vibes", value: 1, ground: "A", because: "x" })), /prediction is malformed/);
  assert.throws(() => assertSafeActionPlan(withExpect({ op: "equals", value: 1, ground: "A", because: "x" })), /prediction is malformed/);
  assert.throws(() => assertSafeActionPlan(withExpect({ read: "doc.text", op: "equals", value: 1, ground: "Z", because: "x" })), /prediction is malformed/);
  // An action with no prediction stays valid — `expect` is optional.
  assert.equal(assertSafeActionPlan({ actions: [{ type: "key", key: "z" }] }), true);
});

// `expect.read` must not be a way around the namespace gate that every other reader
// goes through.
test("assertSafeActionPlan refuses a prediction reader outside the namespaces", () => {
  const escape = { actions: [{ type: "key", key: "z", expect: { read: "eval.window", op: "equals", value: 1, ground: "B", because: "x", source: "docs/a.md:1" } }] };
  assert.throws(() => assertSafeActionPlan(escape), /prediction reader "eval.window" must start with one of/);
});

// --- the prediction outcome must reach the replay key ------------------------

// `actual` is the value a verdict RESTS on. Leaving it out of the key made replay —
// the determinism gate that exists to kill phantom repros — blind to the one number a
// violation was computed from, so a flaky prediction sailed through 3/3 attempts.
test("REGRESSION: uiObservedKey distinguishes different prediction outcomes", () => {
  const withActual = (actual) => obs({ action: { type: "key", key: "Control+z" }, actual });
  assert.notEqual(uiObservedKey(withActual("10")), uiObservedKey(withActual("999")));
  assert.equal(uiObservedKey(withActual("10")), uiObservedKey(withActual("10")));
  // A read that failed is a different outcome from one that returned null.
  const failed = obs({ action: { type: "key", key: "z" }, actual: null, actualError: "hunt bridge is not installed" });
  const nulled = obs({ action: { type: "key", key: "z" }, actual: null, actualError: null });
  assert.notEqual(uiObservedKey(failed), uiObservedKey(nulled));
});

test("uiObservedKey is unchanged for actions carrying no prediction", () => {
  // Absence of the field, not a null value — so an action without a prediction keys
  // exactly as it did before predictions existed.
  const plain = uiObservedKey(obs({ action: { type: "click" } }));
  assert.equal(plain.includes("actual:"), false);
});

test("uiObservedKey scrubs volatile values inside a prediction outcome too", () => {
  const a = obs({ action: { type: "key", key: "z" }, actual: '{"blockId":"block-1785735868118-3"}' });
  const b = obs({ action: { type: "key", key: "z" }, actual: '{"blockId":"block-1785735870911-3"}' });
  assert.equal(uiObservedKey(a), uiObservedKey(b));
});
