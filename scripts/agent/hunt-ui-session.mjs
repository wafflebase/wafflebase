// A LIVE browser session for the UI hunter — boot once, then one action per call.
//
// WHY THIS EXISTS, in numbers. The CLI hunter's tool spawns a fresh process per probe
// because that costs milliseconds. The same shape here would cost the entire run:
//
//   1-action plan   6095 ms
//   3-action plan   6103 ms
//
// Booting Vite and Chromium is ~6.1s; each action after that is ~4ms. At
// `maxActions: 80` a spawn-per-action tool spends ~8 minutes on boot alone, and about
// half an hour across a run whose whole budget is ~15 minutes of probing. Measured
// through this client instead: ready at 856ms, first action 5.4s, subsequent actions
// 33-44ms — roughly 10s for 80 actions rather than 488s.
//
// WHAT THIS IS NOT. It is not a general RPC channel. The only thing it can send is an
// action from the closed vocabulary, and `hunt-ui-probe.mjs` validates that before a
// request is written. The runner independently re-checks reader namespaces, because a
// trusted executor whose only guard lives in another process is not actually bounded.
//
// REPLAY DOES NOT USE THIS. `runUiPlan` keeps its synchronous `spawnSync` path against
// `--plan`, so the determinism gate still gets a genuinely fresh process and a fresh
// browser context per attempt. Exploration is a session; replay is a clean room. Using
// one mechanism for both would mean either a slow explorer or a replay that inherits
// state, and the second is how phantom repros get through.
//
// No third-party static imports: `agent:tests` runs with `scripts/agent/node_modules`
// absent, and `playwright` does not resolve from this directory anyway.

import { spawn } from "node:child_process";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

// Re-exported, not redeclared. `runUiPlan` and this client must spawn the SAME runner or
// exploration and replay silently diverge, and two copies of a path constant is exactly
// how that starts.
export { UI_RUNNER_REL } from "./hunt-ui-probe.mjs";
import { UI_RUNNER_REL } from "./hunt-ui-probe.mjs";

/** How long to wait for Vite + Chromium to come up before giving up. */
const DEFAULT_READY_TIMEOUT_MS = 90_000;
/** Ceiling on one action's round trip, above the runner's own per-action timeout. */
const DEFAULT_ACT_TIMEOUT_MS = 60_000;
/**
 * Grace period between `op:"close"` and SIGKILL.
 *
 * Injectable, and not merely for tidiness: hardcoded it made every session test pay
 * it twice — once waiting for a close handshake the fake never sends, once waiting for
 * an exit — turning a 1.8s lane into 85s. A timer a test cannot shorten is a
 * testability defect, not a constant.
 */
const DEFAULT_CLOSE_GRACE_MS = 5_000;

/**
 * Split a stream of chunks into complete lines.
 *
 * Hand-rolled rather than `node:readline` so the session owns its own buffering and a
 * partial trailing line can never be parsed as a whole one — a response split across
 * two chunks is the failure that would otherwise show up as a random unparseable line
 * under load.
 *
 * A `StringDecoder` rather than `String(chunk)`, because a multi-byte character split
 * across two chunks decodes to replacement characters — and A CORRUPTED READING IS
 * WORSE THAN A LOST ONE. A lost reply times out and is reported as a fault; a corrupted
 * one is fed to `equals`, disagrees with the baseline, and manufactures a `violated`
 * verdict out of a transport artefact. That is precisely the fail-quiet inversion this
 * hunter must not have. Measured before the fix: a reply carrying "안녕하세요" arrived as
 * "���녕하세요".
 */
function createLineReader(onLine) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  return (chunk) => {
    // A stream someone has already put in string mode hands us strings; the decoder
    // only applies to raw bytes.
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim() !== "") onLine(line);
    }
  };
}

/**
 * Open a live browser session.
 *
 * `spawnImpl` is injectable so the tests can exercise correlation, timeouts, crash
 * handling and close semantics with a scripted stand-in — no browser, no Vite, no
 * network. That matters more here than usual: this is the one part of the UI hunter
 * that cannot be unit-tested through the real thing in the `agent:tests` lane.
 */
export async function openUiSession({
  repoRoot,
  port = 0,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  actTimeoutMs = DEFAULT_ACT_TIMEOUT_MS,
  closeGraceMs = DEFAULT_CLOSE_GRACE_MS,
  spawnImpl = spawn,
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot === "") {
    throw new Error("hunt-ui-session: repoRoot is required");
  }

  const child = spawnImpl(
    process.execPath,
    [path.join(repoRoot, UI_RUNNER_REL), "--serve", "--port", String(port)],
    { cwd: path.join(repoRoot, "packages", "frontend"), stdio: ["pipe", "pipe", "pipe"] },
  );

  /** id -> {resolve, reject, timer} for requests still in flight. */
  const pending = new Map();
  let nextId = 1;
  let ready = null;
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });
  let closed = false;
  /** Whether the OS process is gone. `close()` must not wait for an exit twice. */
  let exited = false;
  /** Kept so a crash can report what the runner said on the way down. */
  const stderrTail = [];

  const failAll = (why) => {
    const error = new Error(why);
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    pending.clear();
    if (!ready) readyReject(error);
  };

  child.stdout?.on(
    "data",
    createLineReader((line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        // Tolerated on purpose. Anything sharing stdout with the protocol — a stray
        // warning from a dependency, a Vite notice that escaped `logLevel: silent` —
        // must not be mistaken for a response or crash the session. Protocol lines are
        // identified by shape, not by position.
        return;
      }
      if (msg?.ready === true) {
        ready = { baseUrl: msg.baseUrl ?? null };
        readyResolve(ready);
        return;
      }
      const p = msg?.id != null ? pending.get(msg.id) : undefined;
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      p.resolve(msg);
    }),
  );

  child.stderr?.on("data", (chunk) => {
    stderrTail.push(String(chunk));
    if (stderrTail.length > 20) stderrTail.shift();
  });

  // A runner that dies takes every in-flight request with it. Rejecting is the point:
  // a session that silently hangs would burn the whole `totalTimeoutMs` on one action.
  child.on("exit", (code, signal) => {
    exited = true;
    if (closed) return;
    failAll(
      `hunt-ui-session: runner exited (code ${code}, signal ${signal ?? "none"})` +
        (stderrTail.length ? `\n${stderrTail.join("").trim().split("\n").slice(-6).join("\n")}` : ""),
    );
  });
  child.on("error", (err) => failAll(`hunt-ui-session: runner could not start: ${err?.message ?? err}`));

  // An EPIPE on the runner's stdin means the channel is gone, so nothing in flight can
  // ever be answered. Routed through `failAll` rather than swallowed: a listener that
  // discards the error would turn a dead pipe into a hang. (Node did not raise this as
  // an unhandled error in testing, so this is insurance rather than a fixed defect.)
  child.stdin?.on("error", (err) => {
    if (closed) return;
    failAll(`hunt-ui-session: runner stdin closed: ${err?.message ?? err}`);
  });

  /**
   * Stop the runner. Used on the paths where NOBODY ELSE CAN.
   *
   * Once `openUiSession` throws, the caller never receives a session and so never gets a
   * `close()` to call — the process would simply survive. Measured before this existed:
   * after a readiness timeout, `child.killed` was null, leaving a Vite server and a
   * Chromium running for the life of the machine.
   */
  const abandon = () => {
    closed = true;
    child.stdin?.end();
    if (!exited) child.kill("SIGKILL");
  };

  const readyTimer = setTimeout(
    () => failAll(`hunt-ui-session: runner was not ready within ${readyTimeoutMs}ms`),
    readyTimeoutMs,
  );
  try {
    await readyPromise;
  } catch (err) {
    abandon();
    throw err;
  } finally {
    clearTimeout(readyTimer);
  }

  const request = (payload, timeoutMs) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error("hunt-ui-session: session is closed"));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`hunt-ui-session: no response for request ${id} within ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    });

  return {
    baseUrl: ready.baseUrl,

    /**
     * Execute one action and return its observation.
     *
     * A FAILED ACTION IS NOT AN ERROR. The runner reports it as an observation with
     * `ok:false`, and that is data the hunter needs — "the click found nothing" is a
     * fact about the app. Only a transport or internal fault throws, so a caller
     * cannot confuse the two.
     */
    async act(action, { timeoutMs = actTimeoutMs } = {}) {
      const reply = await request({ action }, timeoutMs);
      if (reply.error) throw new Error(`hunt-ui-session: ${reply.error}`);
      if (!reply.observation) throw new Error("hunt-ui-session: reply carried no observation");
      return reply.observation;
    },

    /** Shut down, then make sure. Idempotent. */
    async close() {
      if (closed) return;
      // ALREADY GONE. A dead runner cannot answer the handshake, and `child.once("exit")`
      // will never fire a second time — so awaiting it below hung forever. Measured: after
      // the runner crashed, `close()` never resolved, which would strand the orchestrator
      // at the end of every session that lost its browser.
      if (exited) {
        closed = true;
        failAll("hunt-ui-session: session closed");
        child.stdin?.end();
        return;
      }
      try {
        await request({ op: "close" }, closeGraceMs);
      } catch {
        // Already gone, or too slow to say goodbye. Either way the kill below is what
        // guarantees we do not leak a Chromium and a Vite server per session.
      }
      closed = true;
      failAll("hunt-ui-session: session closed");
      child.stdin?.end();
      // Named apart from the outer `exited` flag on purpose: a local `const exited` here
      // shadowed it and put the early-return check above into its temporal dead zone.
      const exitedPromise = new Promise((res) => child.once("exit", res));
      const killer = setTimeout(() => child.kill("SIGKILL"), closeGraceMs);
      try {
        await exitedPromise;
      } finally {
        clearTimeout(killer);
      }
    },

    /** For tests and diagnostics. */
    get pendingCount() {
      return pending.size;
    },
  };
}
