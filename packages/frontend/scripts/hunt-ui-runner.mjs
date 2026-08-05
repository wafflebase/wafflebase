// The UI hunter's TRUSTED EXECUTOR — runs an action plan in a browser and reports
// what happened. No model is involved anywhere in this file.
//
// WHY IT LIVES HERE AND NOT IN scripts/agent/. `playwright` resolves from
// `packages/frontend` and NOT from `scripts/agent` — they are separate installs, and
// `scripts/agent` is outside the pnpm workspace. Duplicating the dependency would
// also duplicate the version, which `scripts/run-browser-tests-docker.sh` pins
// against `Dockerfile.playwright`; a drift there means the hunter and CI disagree
// about what a browser is.
//
// Keeping the driver here and spawning it as a SUBPROCESS solves a second problem for
// free: `hunt-probe.mjs`'s `replay()` is synchronous (`spawnSync`, a sync for-loop),
// and a browser is not. A subprocess boundary makes the async side look synchronous
// to the agent, so the well-tested replay/determinism machinery is reused UNCHANGED
// rather than rewritten to be async.
//
// WHY THE ACTION VOCABULARY IS CLOSED. Every action is a tagged object validated
// below; there is no "evaluate this JavaScript" action and no CSS selector. A caller
// can only reach the page through Playwright's role locators or through a NAMED
// reader in the page's own bridge. When PR 3 puts a model behind this, its reachable
// surface is bounded by code reviewed in this repository rather than by a prompt.
//
// ON CLOCK AND RANDOMNESS. Playwright can freeze time (`page.clock`), and the
// obvious move is to pin it for determinism. This deliberately does NOT, because
// freezing `Date.now()` changes application BEHAVIOUR: the sheets mobile-edit panel,
// for one, dismisses itself based on `Date.now() - openedAt < 500`, which is always
// 0 under a frozen clock. A hunter that manufactures defects with its own
// instrumentation is worse than no hunter. Time-derived noise is handled where it
// belongs instead — in `uiObservedKey`, which compares outcome SHAPE and scrubs
// volatile values, exactly as the CLI hunter does. If replay proves flaky in
// practice, revisit with evidence rather than pre-emptively.

import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// The oracles live in their own module so `verify-hunt-oracles.mjs` exercises the
// SAME code this runs. A verification script with its own copy would prove only
// that the copy works.
import { attachOracles, scanDomInvariants } from "./hunt-ui-oracles.mjs";
// `boundValue` lives with `isUnusableValue` in the protocol module, so the producer of
// the oversized/unserializable markers and the predicate that recognises them cannot
// drift. They did drift once: this file promised the protocol treated markers as
// unevaluable and the protocol had never heard of them. Importing across the boundary
// is safe and cheap — the module is pure, and its transitive chain is guarded (~9ms).
import { boundValue } from "../../../scripts/agent/hunt-ui-expect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

const HOST = "127.0.0.1";
const BRIDGE_KEY = "__WB_HUNT__";
const READY_SELECTOR = "[data-testid='hunt-harness-root'][data-hunt-harness-ready='true']";
const HOST_TESTID = "hunt-harness-host";

/** Per-action ceiling. A hung action must not hang the run. */
const DEFAULT_ACTION_TIMEOUT_MS = 10_000;

// --- argument parsing --------------------------------------------------------

function parseArgs(argv) {
  const out = { plan: null, attempts: 1, out: null, port: 4177, timeoutMs: DEFAULT_ACTION_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") out.plan = argv[++i];
    else if (a === "--attempts") out.attempts = Number(argv[++i]);
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else throw new Error(`hunt-ui-runner: unknown argument ${JSON.stringify(a)}`);
  }
  if (!out.plan) throw new Error("hunt-ui-runner: --plan <file.json> is required");
  if (!Number.isInteger(out.attempts) || out.attempts < 1) {
    throw new Error(`hunt-ui-runner: --attempts must be a positive integer, got ${out.attempts}`);
  }
  // `Number("abc")` is NaN, and an unvalidated NaN reaches Vite's `strictPort` listen
  // or Playwright's timeout as a confusing failure far from the typo that caused it.
  // Port 0 is allowed and meaningful: it asks the OS for a free port (see below).
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) {
    throw new Error(`hunt-ui-runner: --port must be an integer in 0..65535, got ${out.port}`);
  }
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) {
    throw new Error(`hunt-ui-runner: --timeout-ms must be a positive number, got ${out.timeoutMs}`);
  }
  return out;
}

// --- playwright --------------------------------------------------------------

async function loadPlaywright() {
  try {
    const mod = await import("playwright");
    if (!mod.chromium) throw new Error("Playwright chromium launcher is unavailable.");
    return mod;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Cannot find package 'playwright'") || message.includes("Cannot find module 'playwright'")) {
      console.error("[hunt-ui-runner] Playwright is required. Run `pnpm install`, then");
      console.error("[hunt-ui-runner] `pnpm --filter @wafflebase/frontend exec playwright install chromium`.");
      process.exit(1);
    }
    throw error;
  }
}

// --- reading -----------------------------------------------------------------

/**
 * Run a named reader.
 *
 * `dom.*` readers use Playwright locators and so must run OUT of page; everything
 * else is the page's own bridge. Routing on the prefix keeps the two namespaces from
 * having to know about each other.
 */
/**
 * Reader namespaces, duplicated here ON PURPOSE.
 *
 * `hunt-ui-probe.mjs` validates these too, but it runs in a different PROCESS — this
 * driver is invocable directly, and a trusted executor whose only namespace check
 * lives in an out-of-process validator is not actually bounded. Cheap defence in
 * depth; the authoritative reader list is still the bridge's.
 */
const READER_PREFIXES = ["doc.", "sheet.", "dom."];

function assertReaderName(name) {
  if (typeof name !== "string" || !READER_PREFIXES.some((p) => name.startsWith(p))) {
    throw new Error(`reader ${JSON.stringify(name)} must start with one of ${READER_PREFIXES.join(", ")}`);
  }
}

/**
 * Read a value once the UI has stopped changing.
 *
 * A single fixed sleep was the only settling window, and a prediction read is not a
 * display concern — a stale value read a few milliseconds early becomes `violated`,
 * which becomes an eligible candidate. Because the prediction is deliberately bundled
 * with its action (so the caller cannot look before committing), the caller has no way
 * to insert a wait of its own, so the settling has to happen here.
 *
 * Two consecutive equal reads is the signal, not a longer sleep: it returns as soon as
 * the value is stable rather than always paying the worst case, and it does not
 * silently pass a value that is still moving when the deadline expires — the caller
 * gets the last read either way, but a still-moving value will then diverge across
 * replay attempts and be dropped as non-deterministic, which is the correct outcome.
 */
async function readSettled(page, name, args, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let previous = await readValue(page, name, args);
  let serialized = JSON.stringify(previous ?? null);
  while (Date.now() < deadline) {
    await page.waitForTimeout(25);
    const next = await readValue(page, name, args);
    const nextSerialized = JSON.stringify(next ?? null);
    if (nextSerialized === serialized) return next;
    previous = next;
    serialized = nextSerialized;
  }
  return previous;
}

async function readValue(page, name, args) {
  assertReaderName(name);
  if (name === "dom.snapshot") {
    return await page.locator("body").ariaSnapshot();
  }
  if (name === "dom.text") {
    const [role, accName] = args;
    return await page.getByRole(role, { name: accName }).first().innerText();
  }
  if (name === "dom.count") {
    const [role, accName] = args;
    const loc = accName === undefined ? page.getByRole(role) : page.getByRole(role, { name: accName });
    return await loc.count();
  }
  return await page.evaluate(
    ([key, readerName, readerArgs]) => {
      const bridge = window[key];
      if (!bridge) throw new Error("hunt bridge is not installed");
      return bridge.read(readerName, readerArgs);
    },
    [BRIDGE_KEY, name, args],
  );
}

async function resolveTarget(page, target) {
  if (target && typeof target.role === "string") {
    return { kind: "role", locator: page.getByRole(target.role, { name: target.name }).first() };
  }
  if (target && typeof target.reader === "string") {
    const point = await readValue(page, target.reader, target.args ?? []);
    // Number.isFinite, NOT typeof: `typeof NaN === "number"`, so a `typeof` check
    // waves NaN coordinates straight through to `page.mouse.click(NaN, NaN)` and the
    // failure surfaces as an opaque Playwright error instead of naming the reader.
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`target reader ${target.reader} did not return finite {x,y}, got ${JSON.stringify(point)}`);
    }
    return { kind: "point", point };
  }
  throw new Error(`unresolvable target ${JSON.stringify(target)}`);
}

// --- the action loop ---------------------------------------------------------

async function waitForReady(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });
  // Same animation kill the interaction lane uses. Transitions in flight are the
  // cheapest source of a screenshot or a hit-test landing on the wrong frame.
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important;}",
  });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  await page.waitForFunction(
    (key) => {
      const bridge = window[key];
      return !!bridge && typeof bridge.ready === "function" && bridge.ready();
    },
    BRIDGE_KEY,
    { timeout: 20_000 },
  );
}


async function runAction(page, action, baseUrl, timeoutMs) {
  switch (action.type) {
    case "goto": {
      const surface = action.surface === "doc" ? "doc" : "sheet";
      await waitForReady(page, `${baseUrl}/harness/hunt?surface=${surface}`);
      return { value: surface };
    }
    case "click": {
      const target = await resolveTarget(page, action.target);
      const opts = {
        button: action.button ?? "left",
        clickCount: action.clickCount ?? 1,
        timeout: timeoutMs,
      };
      if (target.kind === "role") await target.locator.click(opts);
      else await page.mouse.click(target.point.x, target.point.y, opts);
      return { value: null };
    }
    case "type": {
      await page.keyboard.type(String(action.text ?? ""), { delay: 0 });
      return { value: null };
    }
    case "key": {
      await page.keyboard.press(String(action.key));
      return { value: null };
    }
    case "scroll": {
      if (action.target) {
        const target = await resolveTarget(page, action.target);
        if (target.kind === "point") await page.mouse.move(target.point.x, target.point.y);
        else await target.locator.hover({ timeout: timeoutMs });
      }
      await page.mouse.wheel(Number(action.dx ?? 0), Number(action.dy ?? 0));
      return { value: null };
    }
    case "read": {
      return { value: await readValue(page, action.reader, action.args ?? []) };
    }
    case "wait": {
      const deadline = Date.now() + (Number(action.timeoutMs) || timeoutMs);
      let last;
      while (Date.now() < deadline) {
        last = await readValue(page, action.reader, action.args ?? []);
        if (action.equals === undefined || JSON.stringify(last) === JSON.stringify(action.equals)) {
          return { value: last };
        }
        await page.waitForTimeout(50);
      }
      throw new Error(`wait on ${action.reader} timed out; last value ${JSON.stringify(last)}`);
    }
    default:
      throw new Error(`unknown action type ${JSON.stringify(action.type)}`);
  }
}

/**
 * One attempt: a FRESH browser context, so nothing carries over from the last.
 *
 * A fresh context rather than a fresh process is the deliberate trade — it resets
 * storage, cookies and page state in ~200ms where a process restart costs the ~8s
 * Vite and Chromium boot. What must not leak between attempts is page state, and a
 * context boundary is exactly that.
 */
async function runAttempt(browser, plan, baseUrl, timeoutMs) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
  });
  try {
    const page = await context.newPage();
    // Fulfil backend calls rather than letting them fail. They are handled in the app
    // (the toolbar catches and toasts), so this is not about preventing a crash — it
    // is about not teaching a later agent that clicking "save default styles" is a
    // way to make something red.
    await page.route("**/auth/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ styles: {} }) }),
    );
    const oracles = attachOracles(page, baseUrl);

    const observations = [];
    for (const [index, action] of plan.actions.entries()) {
      let result = null;
      let error = null;
      try {
        result = await runAction(page, action, baseUrl, timeoutMs);
      } catch (err) {
        error = String(err?.message ?? err);
      }
      // Give async errors from this action a chance to land before draining. Without
      // it a rejection scheduled by the click is attributed to the NEXT action.
      //
      // This is the ORACLE window only. It is deliberately NOT the prediction window:
      // a fixed sleep is fine for "did anything throw" and wrong for "what is the value
      // now", so the prediction read settles on its own below.
      await page.waitForTimeout(30);

      // THE PREDICTION READ, performed in the SAME round-trip as the action.
      //
      // Atomicity is the entire point. If the caller had to issue a separate read to
      // find out what happened, it could act, look at the result, and only then
      // decide what it had "expected" — which is the difference between a prediction
      // and a rationalisation. Submitting `expect` with the action and reading here
      // means the outcome is fixed before the caller sees anything.
      //
      // The runner does NOT compare. It reports `actual` and nothing more; the
      // verdict is `hunt-ui-expect.mjs`'s to render, in pure code the tests can
      // exercise without a browser.
      let actual = null;
      let actualError = null;
      if (action.expect && typeof action.expect.read === "string") {
        try {
          actual = await readSettled(page, action.expect.read, action.expect.args ?? [], timeoutMs);
        } catch (err) {
          // A failed prediction read is not a failed action, and must not be
          // reported as one — the action may well have succeeded. It leaves `actual`
          // null, which the protocol treats as unevaluable rather than a violation.
          actualError = String(err?.message ?? err);
        }
      }

      const domFindings = await scanDomInvariants(page, HOST_TESTID);
      observations.push({
        index,
        action,
        ok: error === null,
        error,
        value: result ? boundValue(result.value) : null,
        // Present only when the action carried a prediction, so an observation
        // without one is distinguishable from one whose read returned null.
        ...(action.expect ? { actual: boundValue(actual), actualError } : {}),
        oracles: [...oracles.drain(), ...domFindings],
      });
    }
    return { observations };
  } finally {
    await context.close();
  }
}

// --- main --------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const plan = JSON.parse(readFileSync(args.plan, "utf8"));
if (!Array.isArray(plan.actions) || plan.actions.length === 0) {
  throw new Error("hunt-ui-runner: plan must have a non-empty `actions` array");
}

const playwright = await loadPlaywright();
// `--port 0` asks the OS for a free port, and that is what `runUiPlan` passes.
// Samples run concurrently from PR 4 onward, and a fixed port under `strictPort`
// makes the second runner fail to boot. A pinned port stays the default for manual
// runs, where a stable URL is worth more than concurrency.
const ephemeralPort = args.port === 0;
const server = await createServer({
  configFile: path.resolve(frontendRoot, "vite.config.ts"),
  root: frontendRoot,
  logLevel: "silent",
  server: { host: HOST, port: args.port, strictPort: !ephemeralPort },
});

let browser;
let result;
try {
  await server.listen();
  const listening = server.httpServer?.address();
  const actualPort = listening && typeof listening === "object" ? listening.port : args.port;
  const baseUrl = `http://${HOST}:${actualPort}`;
  browser = await playwright.chromium.launch({ headless: true });

  const attempts = [];
  for (let i = 0; i < args.attempts; i++) {
    attempts.push(await runAttempt(browser, plan, baseUrl, args.timeoutMs));
  }
  result = { ok: true, attempts };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Executable doesn't exist") || message.includes("download new browsers")) {
    console.error("[hunt-ui-runner] Chromium is not installed for this Playwright version.");
    console.error("[hunt-ui-runner] Run `pnpm --filter @wafflebase/frontend exec playwright install chromium`.");
    process.exit(1);
  }
  // A runner-level failure is NOT an observation — reporting it as one would let
  // infrastructure trouble masquerade as a finding about the app.
  result = { ok: false, error: message, attempts: [] };
} finally {
  if (browser) await browser.close();
  await server.close();
}

const json = JSON.stringify(result);
if (args.out) writeFileSync(args.out, `${json}\n`);
else process.stdout.write(`${json}\n`);
process.exit(result.ok ? 0 : 1);
