// The explorer can now RUN things, so this file is the boundary that decides what
// "can run" means. Every test here exists because removing the guard it covers
// would let a model reach something it must not, or report something that never
// happened. Each one was checked to FAIL with its guard removed — a safety test
// that passes either way is worse than none, because it certifies nothing while
// looking like it does.
//
// No CLI, no network, and NO SDK: these exercise `createProbeTool`, the handler
// factory, which has no third-party imports. That is deliberate — the `agent:tests`
// lane runs with `scripts/agent/node_modules` absent, so a test that reached through
// the real MCP server object would fail in CI with ERR_MODULE_NOT_FOUND. The server
// wrapper is covered by one self-skipping smoke test at the bottom.
// The exception is the two tests about file handling, which pass `real: true` —
// `runProbe` returns before materializing fixtures when a runner is present, so
// injecting one there would skip the very guard under test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createProbeBudget,
  createProbeTool,
  openSessionScratch,
  resolveProbeRefs,
  PROBE_TOOL_NAME,
} from "./hunt-tool.mjs";

// `real: true` uses the genuine runProbe path instead of an injected runner.
// runProbe returns EARLY when a runner is present, before materializing fixtures,
// so any test about file handling has to take the real path. `bin` need not exist:
// runProbe records a spawn failure rather than throwing.
function makeServer({ charter = { mutating: false }, cfg = {}, budget, journal = [], safetyOf = null, runner, real = false } = {}) {
  const scratch = openSessionScratch();
  const call = createProbeTool({
    charter,
    bin: "/nonexistent/bin.js",
    cfg,
    scratch: scratch.dir,
    budget: budget ?? createProbeBudget({ maxProbes: 10 }),
    journal,
    safetyOf,
    runner: real
      ? null
      : (runner ??
        ((argv) => ({ argv, exitCode: 0, signal: null, stdout: "ok", stderr: "", timedOut: false, spawnError: null }))),
  });
  return { call, journal, scratch };
}

const textOf = (r) => r.content.map((c) => c.text).join("\n");

// --- the tool is not a shell -------------------------------------------------

test("the granted tool name is the exact one ask.mjs permits", () => {
  // If these drift, the session grants a tool that does not exist (model can read
  // but never probe) or runs a server whose tool is never approved. Both fail
  // silently at runtime, so pin the string.
  assert.equal(PROBE_TOOL_NAME, "mcp__wafflebase__run");
});

test("argv reaches the runner as DATA — metacharacters are never interpreted", async () => {
  const seen = [];
  const { call } = makeServer({
    runner: (argv) => {
      seen.push(argv);
      return { argv, exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, spawnError: null };
    },
  });
  const nasty = ["docs", "list", "; rm -rf /", "$(id)", "`whoami`", "a\nb", "'quoted'", "*"];
  await call({ argv: nasty });
  assert.deepEqual(seen[0], nasty, "every element must survive verbatim, unsplit and unexpanded");
});

// --- refusals are readable, not thrown ---------------------------------------

test("a hard-denied command is refused as READABLE text, and never runs", async () => {
  // A thrown error aborts the tool call and teaches the model nothing; it would
  // retry or stall. A refusal it can read lets it adapt, which is the difference
  // between a bounded agent and a stuck one.
  let ran = 0;
  const journal = [];
  const { call } = makeServer({
    journal,
    runner: (argv) => {
      ran++;
      return { argv, exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, spawnError: null };
    },
  });

  for (const argv of [
    ["api-keys", "revoke", "k1"],
    ["login"],
    ["logout"],
    ["ctx", "switch", "other"],
  ]) {
    const r = await call({ argv });
    assert.equal(r.isError, true, `${argv.join(" ")} must be refused`);
    assert.match(textOf(r), /Refused/, "the refusal must be legible to the model");
  }
  assert.equal(ran, 0, "a refused command must never reach the runner");
  assert.equal(journal.length, 0, "a refused command must not be journalled as evidence");
});

test("a hard denial survives a flag value shifting the command words", async () => {
  // The position-anchored version of this check let `--format json api-keys revoke`
  // through, because a flag VALUE shifted the words. Contiguous-anywhere matching
  // is what fixed it; this pins it at the tool boundary too.
  const { call } = makeServer();
  const r = await call({ argv: ["--format", "json", "api-keys", "revoke", "k1"] });
  assert.equal(r.isError, true);
});

test("the schema's own safety annotations are consulted, not just the hard list", async () => {
  // `safetyOf` had been accepted by assertSafeArgv and passed by nobody, so the 39
  // read-only/write/destructive annotations gated nothing. Now that the model
  // executes directly they are a live second line of defence.
  // Receives the WORDS ARRAY, exactly as assertSafeArgv passes it — and that array
  // still holds operands, so `docs delete d1` arrives as ["docs","delete","d1"].
  // Mirror buildSafetyOf's longest-prefix resolution; a stub matching only the
  // exact join would silently pass everything and prove nothing.
  const table = new Map([["docs.delete", "destructive"], ["docs.list", "read-only"]]);
  const safetyOf = (words) => {
    for (let n = words.length; n >= 1; n--) {
      const k = words.slice(0, n).join(".");
      if (table.has(k)) return table.get(k);
    }
    return null;
  };
  const { call } = makeServer({ charter: { mutating: false }, safetyOf });
  assert.equal((await call({ argv: ["docs", "delete", "d1"] })).isError, true, "destructive under a non-mutating charter");
  assert.equal((await call({ argv: ["docs", "list"] })).isError, false, "read-only must still be allowed");
});

// --- the budget actually bounds the loop --------------------------------------

test("maxProbes is enforced, and an exhausted session runs nothing more", async () => {
  // charters.json declared maxProbes from the start and NOTHING enforced it. That
  // was survivable while the model could not act; with a tool loop it is the only
  // thing between a normal run and an unbounded one.
  let ran = 0;
  const budget = createProbeBudget({ maxProbes: 3 });
  const { call } = makeServer({
    budget,
    runner: (argv) => {
      ran++;
      return { argv, exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, spawnError: null };
    },
  });
  for (let i = 0; i < 3; i++) assert.equal((await call({ argv: ["schema"] })).isError, false);
  const over = await call({ argv: ["schema"] });
  assert.equal(over.isError, true);
  assert.match(textOf(over), /exhausted/i);
  assert.equal(ran, 3, "the over-budget call must not reach the runner");
  // And a refused call must not push the budget further, or an exhausted session
  // could not even report the refusal consistently.
  assert.equal(budget.used, 3);
  assert.deepEqual(budget.refusals.map((r) => r.kind), ["maxProbes"]);
});

test("totalTimeoutMs is enforced independently of probe count", async () => {
  // An injected clock, so a wall-clock bound is testable without waiting for it.
  let now = 1_000;
  const budget = createProbeBudget({ maxProbes: 100, totalTimeoutMs: 5_000, now: () => now });
  const { call } = makeServer({ budget });
  assert.equal((await call({ argv: ["schema"] })).isError, false);
  now += 6_000;
  const r = await call({ argv: ["schema"] });
  assert.equal(r.isError, true);
  assert.match(textOf(r), /time exhausted/i);
  assert.deepEqual(budget.refusals.map((x) => x.kind), ["totalTimeoutMs"]);
});

// --- the clean room and the egress boundary -----------------------------------

test("the ambient environment never reaches the CLI", async () => {
  // `buildProbeEnv` REPLACES rather than extends. If it ever spread process.env,
  // the clean room would be a claim rather than a property, and a probe could act
  // on the developer's real documents.
  const saved = process.env.WAFFLEBASE_API_KEY;
  process.env.WAFFLEBASE_API_KEY = "leaked-ambient-key";
  try {
    let captured = null;
    const { call } = makeServer({
      runner: (argv, opts) => {
        captured = opts.env;
        return { argv, exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, spawnError: null };
      },
    });
    await call({ argv: ["status"] });
    assert.equal(captured.WAFFLEBASE_API_KEY, undefined, "the ambient key must not survive");
    assert.ok(captured.HOME && captured.HOME !== process.env.HOME, "HOME must point into the scratch");
  } finally {
    if (saved === undefined) delete process.env.WAFFLEBASE_API_KEY;
    else process.env.WAFFLEBASE_API_KEY = saved;
  }
});

test("secrets echoed by the CLI are redacted before the model ever sees them", async () => {
  // A NEW egress boundary. Previously probe output was only redacted on the way
  // into a report; now it flows into a model's context first, and that model's
  // output reaches a public issue. Both stream shapes are covered.
  const { call } = makeServer({
    cfg: { apiKey: "wfb_LIVEKEYVALUE" },
    runner: (argv) => ({
      argv,
      exitCode: 1,
      signal: null,
      stdout: "configured key: wfb_LIVEKEYVALUE",
      stderr: "GET /x\nAuthorization: Bearer eyJhbGci.payload.sig",
      timedOut: false,
      spawnError: null,
    }),
  });
  const t = textOf(await call({ argv: ["status"] }));
  assert.equal(t.includes("wfb_LIVEKEYVALUE"), false, "the run's own key leaked to the model");
  assert.equal(t.includes("eyJhbGci.payload.sig"), false, "a bearer token leaked to the model");
});

test("a fixture path escaping the scratch is refused", async () => {
  // No injected runner: `runProbe` materializes fixtures only on the real path, so
  // injecting one here would skip the very guard under test. `bin` never has to
  // exist because the escape throws before any spawn.
  const { call, scratch } = makeServer({ real: true });
  try {
    const r = await call({
      argv: ["docs", "import", "x"],
      files: [{ path: "../../escaped.txt", contentBase64: "aGk=" }],
    });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /escapes the scratch/);
    assert.equal(existsSync(path.join(scratch.dir, "..", "..", "escaped.txt")), false);
  } finally {
    scratch.dispose();
  }
});

test("state persists across calls within a session, so multi-step behaviour is reachable", async () => {
  // Deliberately per-session scratch: writing a fixture then importing it is the
  // whole point. Isolation comes from the replaced environment, not from throwing
  // the directory away between calls.
  // Again no injected runner, so fixtures are actually written. The spawn itself
  // fails (bin does not exist) and `runProbe` records that rather than throwing,
  // which is all this test needs.
  const { call, scratch } = makeServer({ real: true });
  try {
    await call({ argv: ["docs", "import", "a.txt"], files: [{ path: "a.txt", contentBase64: "aGVsbG8=" }] });
    assert.equal(readFileSync(path.join(scratch.dir, "a.txt"), "utf8"), "hello");
    await call({ argv: ["docs", "list"] });
    assert.equal(readFileSync(path.join(scratch.dir, "a.txt"), "utf8"), "hello", "state must survive the next call");
  } finally {
    scratch.dispose();
  }
});

test("openSessionScratch disposes its directory", () => {
  const s = openSessionScratch();
  assert.ok(existsSync(s.dir));
  s.dispose();
  assert.equal(existsSync(s.dir), false);
});

// --- the journal is the evidence ---------------------------------------------

test("every run is journalled with what actually ran", async () => {
  const journal = [];
  const { call } = makeServer({ journal });
  await call({ argv: ["docs", "--help"], note: "map the surface" });
  await call({ argv: ["schema"], stdin: "x" });
  assert.equal(journal.length, 2);
  assert.deepEqual(journal[0].argv, ["docs", "--help"]);
  assert.equal(journal[0].note, "map the surface");
  assert.equal(journal[1].stdin, "x");
  assert.equal(journal[0].observed.exitCode, 0, "the observation rides with the command");
});

test("resolveProbeRefs rebuilds the pipeline's probe shape from cited indices", () => {
  const journal = [
    { argv: ["a"], observed: {} },
    { argv: ["b"], note: "n", observed: {} },
    { argv: ["c"], observed: {} },
  ];
  const got = resolveProbeRefs({ probeRefs: [0, 2], failingRef: 2 }, journal);
  assert.deepEqual(got.probes, [{ argv: ["a"] }, { argv: ["c"] }]);
  assert.equal(got.failingIndex, 1, "failingIndex is the position WITHIN the cited list");
  // Order is preserved as cited, and a repeated run is kept rather than collapsed:
  // running the same command twice is legitimate evidence (idempotency, or a second
  // call behaving differently), and deduplicating would erase it.
  const dup = resolveProbeRefs({ probeRefs: [1, 1], failingRef: 1 }, journal);
  assert.deepEqual(dup.probes, [{ argv: ["b"], note: "n" }, { argv: ["b"], note: "n" }]);
});

test("resolveProbeRefs DROPS a candidate citing runs that never happened", () => {
  // The honesty property. A model describing a reproduction it never performed is
  // exactly what citing the journal exists to make impossible, and the fail-quiet
  // response is to drop it — not to repair the reference or honour it partially.
  const journal = [{ argv: ["a"], observed: {} }, { argv: ["b"], observed: {} }];
  for (const bad of [
    { probeRefs: [0, 5], failingRef: 0 }, // out of range
    { probeRefs: [-1], failingRef: -1 }, // negative
    { probeRefs: [], failingRef: 0 }, // no evidence at all
    { probeRefs: [0], failingRef: 1 }, // failing probe not among those cited
    { probeRefs: [0.5], failingRef: 0 }, // non-integer
    { probeRefs: "0,1", failingRef: 0 }, // not an array
    { probeRefs: [0] }, // no failingRef
    {}, // nothing
  ]) {
    assert.equal(resolveProbeRefs(bad, journal), null, `must drop: ${JSON.stringify(bad)}`);
  }
  assert.equal(resolveProbeRefs({ probeRefs: [0], failingRef: 0 }, []), null, "empty journal cites nothing");
});


// --- the SDK wrapper -----------------------------------------------------------

test("createProbeServer registers the `run` tool (skipped without the SDK)", async (t) => {
  // The one thing `createProbeTool` cannot cover: that the tool is actually wired
  // into an MCP server under the exact name ask.mjs pre-approves. It needs the SDK,
  // which the agent:tests lane deliberately runs without — so it SKIPS there rather
  // than failing, and still runs locally where the dependency exists.
  let mod;
  try {
    mod = await import("@anthropic-ai/claude-agent-sdk");
  } catch {
    t.skip("Agent SDK not installed (expected in the agent:tests lane)");
    return;
  }
  assert.ok(mod, "sdk import should have produced a namespace");

  const { createProbeServer } = await import("./hunt-tool.mjs");
  const scratch = openSessionScratch();
  try {
    const server = await createProbeServer({
      charter: { mutating: false },
      bin: "/nonexistent/bin.js",
      scratch: scratch.dir,
      budget: createProbeBudget({ maxProbes: 1 }),
      journal: [],
      runner: (argv) => ({ argv, exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, spawnError: null }),
    });
    assert.equal(server.name, "wafflebase");
    const registered = Object.keys(server.instance._registeredTools ?? {});
    assert.deepEqual(registered, ["run"]);
    // The registered name must compose to exactly what ask.mjs permits, or the
    // session grants a tool that does not exist.
    assert.equal(`mcp__${server.name}__${registered[0]}`, PROBE_TOOL_NAME);
  } finally {
    scratch.dispose();
  }
});

// --- review follow-ups ---------------------------------------------------------

test("a probe is clamped to the session time remaining, not its own timeout", async () => {
  // `totalTimeoutMs` bounded when a probe may START and nothing bounded how long it
  // then ran, so a probe admitted with 100ms of budget left still got its full
  // per-probe timeout — the session could overrun by nearly 20s.
  let now = 0;
  // Session budget must EXCEED the per-probe cap, or the session is always the
  // binding constraint and the test proves nothing about the cap.
  const budget = createProbeBudget({ maxProbes: 10, totalTimeoutMs: 600_000, now: () => now });
  const seen = [];
  const call = createProbeTool({
    charter: { mutating: false, probeBudget: { perProbeTimeoutMs: 20_000 } },
    bin: "/x",
    scratch: "/tmp",
    budget,
    journal: [],
    runner: (argv, opts) => {
      seen.push(opts.timeoutMs);
      return { argv, exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, spawnError: null };
    },
  });

  await call({ argv: ["schema"] });
  assert.equal(seen[0], 20_000, "with the whole session left, the per-probe cap applies");

  now = 599_900; // 100ms of session budget remains
  await call({ argv: ["schema"] });
  assert.equal(seen[1], 100, "near the deadline the probe must be clamped to what is left");
  assert.ok(seen[1] < 20_000);
});

test("the help exemption cannot override a resolved destructive annotation", async () => {
  // `--help` matched anywhere in argv used to force "read-only", so
  // `docs delete d1 --help` was waved through despite the schema declaring
  // docs.delete destructive. The exemption may only RESCUE an unresolvable lookup.
  const table = new Map([["docs.delete", "destructive"], ["docs.list", "read-only"]]);
  const safetyOf = (words) => {
    for (let n = words.length; n >= 1; n--) {
      const k = words.slice(0, n).join(".");
      if (table.has(k)) return table.get(k);
    }
    return null;
  };
  const { call } = makeServer({ charter: { mutating: false }, safetyOf });

  assert.equal((await call({ argv: ["docs", "delete", "d1", "--help"] })).isError, true, "help must not launder a destructive command");
  assert.equal((await call({ argv: ["docs", "delete", "d1", "-h"] })).isError, true, "short form too");
  // …while the cases the exemption exists for still work: `docs` alone and `schema`
  // are absent from the registry, so the lookup is unresolvable and would otherwise
  // fail closed on the explorer's primary discovery tools.
  assert.equal((await call({ argv: ["docs", "--help"] })).isError, false, "`docs --help` must stay allowed");
  assert.equal((await call({ argv: ["schema"] })).isError, false, "`schema` must stay allowed");
  assert.equal((await call({ argv: ["docs", "list"] })).isError, false, "resolved read-only still allowed");
});

test("a shapeless secret straddling the truncation boundary is still redacted", () => {
  // Clipping ran BEFORE redaction, so a token cut in half left a head that no
  // longer matched. The shape patterns (`wfb_…`, JWT, Bearer) catch a fragment
  // anyway, so the exploitable case is a secret whose ONLY protection is the exact
  // `extra` match in redactSecrets — `split(v).join(...)`, which a truncated value
  // cannot satisfy. Hence a deliberately shapeless value here; a `wfb_`-prefixed
  // one would pass whether or not the fix is present, and prove nothing.
  const secret = "Zq7Z".repeat(10); // 40 chars, no recognisable shape
  const { call } = makeServer({
    cfg: { apiKey: secret },
    runner: (argv) => ({
      argv,
      exitCode: 0,
      signal: null,
      // Straddles the 20k clip boundary: 10 chars before it, the rest after.
      stdout: "x".repeat(20_000 - 10) + secret + "tail",
      stderr: "",
      timedOut: false,
      spawnError: null,
    }),
  });
  return call({ argv: ["status"] }).then((r) => {
    const t = textOf(r);
    assert.equal(t.includes(secret), false, "the whole secret leaked");
    // Only the first 10 characters survive the 20k clip, so THAT is the fragment
    // to assert on — checking a longer slice is vacuous, since it could not have
    // been present either way.
    assert.equal(
      t.includes(secret.slice(0, 10)),
      false,
      "a secret FRAGMENT survived: the clip cut it before redaction could match it",
    );
  });
});
