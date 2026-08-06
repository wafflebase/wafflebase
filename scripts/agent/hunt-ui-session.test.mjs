import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import test from "node:test";

import { openUiSession, UI_RUNNER_REL } from "./hunt-ui-session.mjs";

/**
 * A scripted stand-in for the runner process.
 *
 * The session is the one part of the UI hunter that cannot be exercised through the
 * real thing in `agent:tests` — playwright does not resolve here, and booting Vite
 * would cost ~6s per case. So the transport is injectable and every behaviour that
 * matters (correlation, timeouts, crashes, stray output, close) is driven from here.
 */
function fakeRunner({ autoReady = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.written = [];
  child.killed = null;
  // An EventEmitter, because a real `child.stdin` is a stream and the session attaches an
  // error listener to it. A plain object here would have hidden that.
  child.stdin = new EventEmitter();
  child.stdin.write = (chunk) => {
    child.written.push(JSON.parse(String(chunk).trim()));
    return true;
  };
  child.stdin.end = () => {};
  child.kill = (signal) => {
    child.killed = signal ?? "SIGTERM";
    // A REAL already-exited child emits nothing when signalled — the signal goes
    // nowhere. Modelling that is what exposed close() hanging forever after a crash.
    if (child.exited) return true;
    child.exited = true;
    child.emit("exit", null, child.killed);
    return true;
  };
  child.die = (code = 1) => {
    child.exited = true;
    child.emit("exit", code, null);
  };
  child.say = (obj) => child.stdout.emit("data", `${JSON.stringify(obj)}\n`);
  child.raw = (text) => child.stdout.emit("data", text);
  if (autoReady) setImmediate(() => child.say({ ready: true, baseUrl: "http://127.0.0.1:9999" }));
  return child;
}

const spawnFake = (child) => () => child;

test("openUiSession requires a repoRoot", async () => {
  await assert.rejects(() => openUiSession({}), /repoRoot is required/);
});

test("openUiSession spawns the runner in --serve mode and waits for ready", async () => {
  const child = fakeRunner();
  let argv = null;
  const session = await openUiSession({
    repoRoot: "/repo",
    closeGraceMs: 20,
    spawnImpl: (_exec, args) => {
      argv = args;
      return child;
    },
  });
  assert.ok(argv.some((a) => a.endsWith(UI_RUNNER_REL)));
  assert.ok(argv.includes("--serve"));
  assert.equal(argv.includes("--plan"), false, "serve mode must not also pass a plan");
  assert.equal(session.baseUrl, "http://127.0.0.1:9999");
  await session.close();
});

test("act returns the observation and correlates by id", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });

  // Two in flight, answered OUT OF ORDER. Correlation is by id, never by arrival.
  const first = session.act({ type: "read", reader: "doc.text" });
  const second = session.act({ type: "read", reader: "sheet.cellValue", args: ["A1"] });
  assert.equal(session.pendingCount, 2);
  const [idA, idB] = child.written.map((w) => w.id);
  child.say({ id: idB, observation: { ok: true, value: "second" } });
  child.say({ id: idA, observation: { ok: true, value: "first" } });
  assert.equal((await first).value, "first");
  assert.equal((await second).value, "second");
  assert.equal(session.pendingCount, 0);
  await session.close();
});

// A failed action is a fact about the app, not a transport fault. Throwing would make
// "the click found nothing" indistinguishable from "the browser died".
test("act RETURNS a failed observation rather than throwing", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });
  const p = session.act({ type: "click", target: { role: "button", name: "nope" } });
  child.say({ id: child.written[0].id, observation: { ok: false, error: "locator resolved to 0 elements" } });
  const obs = await p;
  assert.equal(obs.ok, false);
  assert.match(obs.error, /0 elements/);
  await session.close();
});

test("act throws on a protocol-level error or a reply with no observation", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });

  const bad = session.act({ type: "read", reader: "doc.text" });
  child.say({ id: child.written[0].id, error: "request needs an `action` object" });
  await assert.rejects(() => bad, /request needs an `action` object/);

  const empty = session.act({ type: "read", reader: "doc.text" });
  child.say({ id: child.written[1].id });
  await assert.rejects(() => empty, /carried no observation/);
  await session.close();
});

// Anything else sharing stdout — a dependency warning, a Vite notice that escaped
// `logLevel: silent` — must not be mistaken for a response or kill the session.
test("non-protocol stdout lines are ignored, not fatal", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });
  const p = session.act({ type: "read", reader: "doc.text" });
  child.raw("some dependency warning\n");
  child.raw("not json at all\n");
  child.say({ unrelated: true });
  child.say({ id: child.written[0].id, observation: { ok: true, value: "survived" } });
  assert.equal((await p).value, "survived");
  await session.close();
});

// A response split across two chunks must not be parsed as two partial lines.
test("a reply split across chunks is reassembled", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });
  const p = session.act({ type: "read", reader: "doc.text" });
  const full = `${JSON.stringify({ id: child.written[0].id, observation: { ok: true, value: "whole" } })}\n`;
  child.raw(full.slice(0, 12));
  child.raw(full.slice(12));
  assert.equal((await p).value, "whole");
  await session.close();
});

// A hung session would otherwise burn the whole per-session time budget on one action.
test("act rejects when the runner never answers", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });
  await assert.rejects(
    () => session.act({ type: "read", reader: "doc.text" }, { timeoutMs: 20 }),
    /no response for request/,
  );
  assert.equal(session.pendingCount, 0, "a timed-out request must not leak");
  await session.close();
});

test("openUiSession rejects if the runner never becomes ready, and kills it", async () => {
  const child = fakeRunner({ autoReady: false });
  await assert.rejects(
    () => openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), readyTimeoutMs: 20, closeGraceMs: 20 }),
    /was not ready within 20ms/,
  );
  // The caller never receives a session, so it never gets a close() to call. Nothing
  // else can reap this process. Measured before the fix: child.killed was null, leaving
  // a Vite server and a Chromium alive for the life of the machine.
  assert.equal(child.killed, "SIGKILL", "a runner nobody can close must be killed here");
});

test("a runner that cannot start is also killed, not left behind", async () => {
  const child = fakeRunner({ autoReady: false });
  setImmediate(() => child.emit("error", new Error("ENOENT")));
  await assert.rejects(() => openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 }));
  assert.equal(child.killed, "SIGKILL");
});

// A corrupted reading is worse than a lost one: fed to `equals` it disagrees with its
// baseline and manufactures a `violated` verdict out of a transport artefact.
test("a multi-byte character split across chunks is decoded intact", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });
  const p = session.act({ type: "read", reader: "doc.text" });
  const full = Buffer.from(
    `${JSON.stringify({ id: child.written[0].id, observation: { ok: true, value: "안녕하세요" } })}\n`,
    "utf8",
  );
  // Cut INSIDE the first Hangul syllable, which is three bytes in UTF-8.
  const cut = full.indexOf(Buffer.from("안", "utf8")) + 1;
  child.stdout.emit("data", full.subarray(0, cut));
  child.stdout.emit("data", full.subarray(cut));
  assert.equal((await p).value, "안녕하세요");
  await session.close();
});

test("a runner that dies rejects every in-flight request, with its stderr", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });
  const p = session.act({ type: "read", reader: "doc.text" });
  child.stderr.emit("data", "Chromium crashed spectacularly\n");
  child.die(1);
  await assert.rejects(() => p, /runner exited \(code 1/);
  await assert.rejects(() => p, /Chromium crashed spectacularly/);

  // AND close() MUST STILL RETURN. `child.once("exit")` will never fire a second time,
  // so awaiting it stranded the caller forever — measured: close() after a crash never
  // resolved. node --test has no default per-test timeout, so a regression here hangs
  // the whole lane rather than failing one case.
  await session.close();
});

test("close sends op:close, is idempotent, and refuses later actions", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });
  // Answer the close handshake so the graceful path is the one under test.
  child.stdin.write = (chunk) => {
    const msg = JSON.parse(String(chunk).trim());
    child.written.push(msg);
    if (msg.op === "close") setImmediate(() => child.say({ id: msg.id, closed: true }));
    return true;
  };
  await session.close();
  assert.ok(child.written.some((w) => w.op === "close"));
  await session.close(); // idempotent
  await assert.rejects(() => session.act({ type: "read", reader: "doc.text" }), /session is closed/);
});

// A dead pipe cannot answer anything in flight, so it must reject rather than hang. I
// could not get Node to raise this as an unhandled error, so this covers insurance rather
// than a reproduced defect — but untested insurance is not insurance.
test("an stdin error rejects in-flight requests instead of hanging", async () => {
  const child = fakeRunner();
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });
  const p = session.act({ type: "read", reader: "doc.text" });
  child.stdin.emit("error", new Error("EPIPE"));
  await assert.rejects(() => p, /stdin closed: EPIPE/);
  await session.close();
});

// Otherwise every abandoned session leaks a Chromium and a Vite server.
test("close kills the runner when it will not exit on its own", async () => {
  const child = fakeRunner();
  child.kill = (signal) => {
    child.killed = signal;
    child.emit("exit", null, signal);
  };
  const session = await openUiSession({ repoRoot: "/repo", spawnImpl: spawnFake(child), closeGraceMs: 20 });
  await session.close();
  assert.equal(child.killed, "SIGKILL");
});
