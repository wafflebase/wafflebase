import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  redactSecrets,
  renderReproSh,
  buildProbeEnv,
  assertSafeArgv,
  HARD_DENIED_COMMANDS,
  runProbe,
  runSequence,
  replay,
  sameObservation,
  withScratch,
} from "./hunt-probe.mjs";
import { observedKey } from "./hunt-fingerprint.mjs";

// No CLI and no network here: `process.execPath -e <script>` stands in for the
// built binary, which exercises the real spawn path (argv passing, exit codes,
// stream capture, timeouts) without needing `pnpm cli build`.
const NODE_AS_BIN = "-e";

const scratch = () => mkdtempSync(path.join(os.tmpdir(), "wb-hunt-test-"));

// --- secret redaction (highest-severity risk) -------------------------------

test("redactSecrets: removes every credential shape, including nested in output", () => {
  // Probe output ends up in a report in a PUBLIC repo, and a `--verbose` run
  // echoes request headers. This is the leak path.
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123signature";
  const cases = [
    ["wfb_live_AbCdEf123456", /<REDACTED_API_KEY>/],
    ["Authorization: Bearer sk-secret-value-here", /<REDACTED>/],
    [jwt, /<REDACTED_JWT>/],
    ['{"api_key": "abcdef1234567890"}', /<REDACTED>/],
    ["x-api-key: 0123456789abcdef", /<REDACTED>/],
  ];
  for (const [input, expected] of cases) {
    const out = redactSecrets(input);
    assert.match(out, expected, input);
    assert.doesNotMatch(out, /wfb_live_AbCdEf123456|sk-secret-value-here|abc123signature|abcdef1234567890|0123456789abcdef/, input);
  }
  // Nested deep in a probe's stderr, which is how it actually arrives.
  const nested = redactSecrets(`request failed\n  header: Authorization: Bearer ${jwt}\n  key wfb_zzz999aaa\n`);
  assert.doesNotMatch(nested, /eyJhbGci|wfb_zzz999aaa/);
});

test("redactSecrets: the run's own live values are removed even without a known shape", () => {
  // A token that matches no generic pattern still must not survive.
  const out = redactSecrets("server said OPAQUE-TOKEN-XYZ", { extra: ["OPAQUE-TOKEN-XYZ"] });
  assert.match(out, /<REDACTED>/);
  assert.doesNotMatch(out, /OPAQUE-TOKEN-XYZ/);
  // Too short to be a credential — redacting it would mangle ordinary output.
  assert.match(redactSecrets("exit 1", { extra: ["1"] }), /exit 1/);
});

// --- shell rendering is display-only and inert ------------------------------

test("renderReproSh: every shell metacharacter survives as a LITERAL", () => {
  // The security-critical property. Nothing executes this output, but a maintainer
  // may copy it, so an argv element must never become a command.
  const nasty = ["docs", "create", "; rm -rf /", "$(id)", "`whoami`", "a'b", "x\ny", "&& curl evil.test", "|sh", ">out"];
  const sh = renderReproSh([{ argv: nasty }]);
  // Each dangerous token appears only inside single quotes.
  for (const token of ["; rm -rf /", "$(id)", "`whoami`", "&& curl evil.test", "|sh", ">out"]) {
    assert.ok(sh.includes(`'${token}'`), `${token} must be single-quoted`);
  }
  // An embedded single quote is closed/escaped/reopened, never left dangling.
  assert.ok(sh.includes(`'a'\\''b'`), "embedded quote must be escaped as '\\''");
  // Quote balance: an odd count would mean an unterminated string.
  const argLine = sh.split("\n").find((l) => l.includes("rm -rf"));
  assert.equal((argLine.match(/'/g) ?? []).length % 2, 0, "single quotes must balance");
});

test("renderReproSh: renders from the recorded argv, and redacts", () => {
  const sh = renderReproSh([{ argv: ["docs", "list"], note: "list first" }, { argv: ["docs", "get", "x"] }]);
  assert.match(sh, /# probe 0/);
  assert.match(sh, /# probe 1/);
  assert.match(sh, /wafflebase docs list/);
  assert.doesNotMatch(renderReproSh([{ argv: ["--api-key", "wfb_secret123456"] }]), /wfb_secret123456/);
  // A multi-line note must not break out of its comment.
  const multi = renderReproSh([{ argv: ["x"], note: "line one\nline two" }]);
  assert.ok(!multi.split("\n").some((l) => l === "line two"), "note newlines must stay inside the comment");
});

// --- the clean room ---------------------------------------------------------

test("buildProbeEnv: REPLACES the ambient environment, never extends it", () => {
  // The load-bearing test. Spreading process.env would let the developer's real
  // session and default workspace leak in, making the clean room a lie — and a
  // mutating probe could then act on real documents.
  const prev = process.env.WAFFLEBASE_API_KEY;
  const prevWs = process.env.WAFFLEBASE_WORKSPACE;
  try {
    process.env.WAFFLEBASE_API_KEY = "wfb_developers_real_key";
    process.env.WAFFLEBASE_WORKSPACE = "the-real-workspace";
    const dir = "/tmp/scratch-xyz";
    const env = buildProbeEnv(dir);
    assert.equal(env.WAFFLEBASE_API_KEY, undefined, "the developer's real key must NOT be inherited");
    assert.equal(env.WAFFLEBASE_WORKSPACE, undefined, "the developer's real workspace must NOT be inherited");
    // Credentials are redirected into the scratch, so the real session file is
    // never read even if one exists.
    assert.equal(env.HOME, dir);
    assert.equal(env.WAFFLEBASE_CONFIG, path.join(dir, "config.yaml"));
    assert.equal(env.WAFFLEBASE_SESSION, path.join(dir, "session.json"));
  } finally {
    if (prev === undefined) delete process.env.WAFFLEBASE_API_KEY;
    else process.env.WAFFLEBASE_API_KEY = prev;
    if (prevWs === undefined) delete process.env.WAFFLEBASE_WORKSPACE;
    else process.env.WAFFLEBASE_WORKSPACE = prevWs;
  }
});

test("buildProbeEnv: pins the determinism knobs", () => {
  // Unpinned locale/TZ/colour makes output differ between runs, and the replay
  // gate would then discard every real finding as non-deterministic.
  const env = buildProbeEnv("/tmp/s");
  assert.equal(env.TZ, "UTC");
  assert.equal(env.LANG, "C");
  assert.equal(env.LC_ALL, "C");
  assert.equal(env.NO_COLOR, "1");
  assert.equal(env.CI, "1");
  // Only supplied values are set — an undefined would stringify to "undefined"
  // and the CLI would treat it as a real (broken) setting.
  assert.equal("WAFFLEBASE_SERVER" in env, false);
  assert.equal(buildProbeEnv("/tmp/s", { server: "http://localhost:3000" }).WAFFLEBASE_SERVER, "http://localhost:3000");
});

// --- argv safety fails CLOSED ----------------------------------------------

test("assertSafeArgv: hard-denies credential and session commands regardless of schema", () => {
  // A floor that does not consult the CLI's schema, because that schema is
  // hand-maintained, has no drift guard, and its wrongness is one of the things
  // this pipeline HUNTS. Trusting it alone would mean trusting a known-unreliable
  // source about whether it is safe to destroy something.
  for (const argv of [
    ["api-keys", "revoke", "abc"],
    ["api-keys", "create", "x"],
    ["api-key", "revoke", "abc"],
    ["logout"],
    ["login"],
    ["ctx", "switch", "other"],
  ]) {
    assert.throws(() => assertSafeArgv(argv, { mutating: false }), /refusing/, argv.join(" "));
  }
  // Flags must not let a denied command slip past the word matching.
  assert.throws(() => assertSafeArgv(["--format", "json", "api-keys", "revoke", "x"], { mutating: false }), /refusing/);
  // A mutating charter may run them.
  assert.equal(assertSafeArgv(["api-keys", "revoke", "x"], { mutating: true }), true);
  assert.ok(HARD_DENIED_COMMANDS.length > 0 && Object.isFrozen(HARD_DENIED_COMMANDS));
});

test("assertSafeArgv: an UNKNOWN command is refused, not assumed read-only", () => {
  // Safety fails CLOSED here — the opposite direction from hunt-gate.mjs, and
  // correctly so: "may we run this?" is not "should we report this?".
  const safetyOf = (words) => (words[0] === "docs" && words[1] === "list" ? "read-only" : null);
  assert.equal(assertSafeArgv(["docs", "list"], { mutating: false, safetyOf }), true);
  assert.throws(() => assertSafeArgv(["docs", "frobnicate"], { mutating: false, safetyOf }), /no declared safety level/);
  const writes = (_w) => "write";
  assert.throws(() => assertSafeArgv(["docs", "create", "x"], { mutating: false, safetyOf: writes }), /declared write/);
});

test("assertSafeArgv: malformed argv is refused", () => {
  for (const bad of [null, [], "docs list", ["docs", 5]]) {
    assert.throws(() => assertSafeArgv(bad, { mutating: true }), /malformed argv/, JSON.stringify(bad));
  }
});

// --- running ----------------------------------------------------------------

test("runProbe: captures exit code and both streams without throwing", () => {
  const dir = scratch();
  try {
    const obs = runProbe(
      { argv: ["process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"] },
      { bin: NODE_AS_BIN, env: buildProbeEnv(dir), cwd: dir },
    );
    // A non-zero exit is the OBSERVATION, not an error — for the crash oracle it
    // is the entire point, so runProbe must never throw on it.
    assert.equal(obs.exitCode, 3);
    assert.equal(obs.stdout, "out");
    assert.equal(obs.stderr, "err");
    assert.equal(obs.timedOut, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runProbe: argv is passed as data — a shell metacharacter is never interpreted", () => {
  const dir = scratch();
  try {
    // With `node -e <script> extra`, the extra args start at process.argv[1]
    // (there is no script filename), so read the LAST element rather than a
    // hardcoded index.
    const obs = runProbe(
      { argv: ["process.stdout.write(process.argv[process.argv.length-1])", "; echo PWNED"] },
      { bin: NODE_AS_BIN, env: buildProbeEnv(dir), cwd: dir },
    );
    // If a shell were involved, `; echo PWNED` would have run as a command and
    // "PWNED" would appear on its own. Instead it arrives verbatim as argv[2].
    assert.equal(obs.stdout, "; echo PWNED");
    assert.equal(obs.exitCode, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runProbe: a hang is recorded as timedOut, not left to block forever", () => {
  const dir = scratch();
  try {
    const obs = runProbe(
      { argv: ["setTimeout(()=>{}, 9e6)"] },
      { bin: NODE_AS_BIN, env: buildProbeEnv(dir), cwd: dir, timeoutMs: 250 },
    );
    assert.equal(obs.timedOut, true);
    assert.match(observedKey(obs), /exit:timeout/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runProbe: a fixture path escaping the scratch is refused", () => {
  const dir = scratch();
  try {
    assert.throws(
      () =>
        runProbe(
          { argv: ["0"], files: [{ path: "../../escaped.txt", contentBase64: "eA==" }] },
          { bin: NODE_AS_BIN, env: buildProbeEnv(dir), cwd: dir },
        ),
      /escapes the scratch/,
    );
    // A path inside the scratch is fine.
    runProbe(
      { argv: ["0"], files: [{ path: "sub/ok.txt", contentBase64: "eA==" }] },
      { bin: NODE_AS_BIN, env: buildProbeEnv(dir), cwd: dir },
    );
    assert.equal(readFileSync(path.join(dir, "sub/ok.txt"), "utf8"), "x");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runSequence: runs every probe in order", () => {
  const seen = [];
  const out = runSequence([{ argv: ["a"] }, { argv: ["b"] }], {
    runner: (argv) => {
      seen.push(argv[0]);
      return { exitCode: 0, argv };
    },
  });
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(out.length, 2);
});

// --- replay -----------------------------------------------------------------

const OBS = { a: { exitCode: 1, stderr: "x" }, b: { exitCode: 2, stderr: "y" } };

const attemptsOf = (keys) => (_probes, i) => [OBS[keys[i]]];

test("replay: N identical attempts matching the claim → reproduced", () => {
  const r = replay([{ argv: ["x"] }], OBS.a, { attempts: 3, observedKey, runAttempt: attemptsOf(["a", "a", "a"]) });
  assert.equal(r.status, "reproduced");
  assert.equal(r.deterministic, true);
  assert.equal(r.divergedAt, null);
  assert.equal(r.attempts.length, 3);
});

test("replay: any divergence between attempts → non-deterministic, never reported", () => {
  // Timestamps, generated ids and map ordering are the top source of phantom
  // repros. Catching them here costs nothing and happens before any model runs.
  const r = replay([{ argv: ["x"] }], OBS.a, { attempts: 3, observedKey, runAttempt: attemptsOf(["a", "a", "b"]) });
  assert.equal(r.status, "non-deterministic");
  assert.equal(r.deterministic, false);
  assert.equal(r.divergedAt, 2);
});

test("replay: consistent but DIFFERENT from the claim → not-reproduced", () => {
  // The hunter predicted one thing and the CLI reliably does another. That is not
  // a reproduction, and the candidate must not be reported on the strength of a
  // wrong prediction.
  const r = replay([{ argv: ["x"] }], OBS.a, { attempts: 3, observedKey, runAttempt: attemptsOf(["b", "b", "b"]) });
  assert.equal(r.status, "not-reproduced");
  assert.equal(r.deterministic, true);
});

test("replay: requires its injected seams", () => {
  assert.throws(() => replay([], OBS.a, { observedKey }), /observedKey and runAttempt are required/);
  assert.throws(() => replay([], OBS.a, { runAttempt: () => [] }), /observedKey and runAttempt are required/);
});

test("sameObservation: shares ONE definition of 'same outcome' with the fingerprint", () => {
  // If these drifted, a candidate could replay "identically" under one rule and be
  // a different defect under the other.
  assert.ok(sameObservation({ exitCode: 1, stderr: "id abc" }, { exitCode: 1, stderr: "id zzz" }, observedKey));
  assert.ok(!sameObservation({ exitCode: 1 }, { exitCode: 2 }, observedKey));
});

test("withScratch: removes the directory even when the body throws", () => {
  let captured;
  assert.throws(() =>
    withScratch((dir) => {
      captured = dir;
      assert.ok(existsSync(dir));
      throw new Error("boom");
    }),
  );
  assert.equal(existsSync(captured), false, "scratch must not leak on the error path");
});
