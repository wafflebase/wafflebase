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
// One definition of a valid fault id, shared with the two agent-side boundaries.
// All node builtins behind it (~15ms), and this file already reaches across for
// `boundValue` for the same reason: a duplicated rule is a rule that drifts.
import { assertFaultId } from "../../../scripts/agent/hunt-ui-probe.mjs";
import { assertMountedSurface, UI_SURFACES } from "../../../scripts/agent/hunt-ui-surfaces.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

const HOST = "127.0.0.1";
import { domControls } from "./hunt-ui-dom.mjs";

const BRIDGE_KEY = "__WB_HUNT__";
const READY_SELECTOR = "[data-testid='hunt-harness-root'][data-hunt-harness-ready='true']";
const HOST_TESTID = "hunt-harness-host";

/** Per-action ceiling. A hung action must not hang the run. */
const DEFAULT_ACTION_TIMEOUT_MS = 10_000;

// --- argument parsing --------------------------------------------------------

function parseArgs(argv) {
  const out = { plan: null, serve: false, attempts: 1, out: null, port: 4177, timeoutMs: DEFAULT_ACTION_TIMEOUT_MS, fault: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--plan") out.plan = argv[++i];
    else if (a === "--serve") out.serve = true;
    else if (a === "--attempts") out.attempts = Number(argv[++i]);
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--timeout-ms") out.timeoutMs = Number(argv[++i]);
    else if (a === "--fault") out.fault = argv[++i];
    else throw new Error(`hunt-ui-runner: unknown argument ${JSON.stringify(a)}`);
  }
  // Shared with the two agent-side boundaries, and imported rather than copied
  // BECAUSE this file has no test lane of its own — which is exactly where the copy
  // went wrong. See `assertFaultId` for what a trailing `--fault` used to do.
  assertFaultId(out.fault, { label: "--fault" });
  // Exactly one mode. Both would be ambiguous about which one the caller wanted, and
  // neither leaves nothing to do.
  if (out.serve && out.plan) throw new Error("hunt-ui-runner: --serve and --plan are mutually exclusive");
  if (!out.serve && !out.plan) throw new Error("hunt-ui-runner: one of --plan <file.json> or --serve is required");
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
// Derived, not restated. This was the SIXTH copy of the surface vocabulary and the last
// one to be found — the slides surface mounted, the mounted-surface guard passed, the plan
// validator accepted the plan, and then every read was refused here as a typo. Both of the
// remaining prefix checks now follow `UI_SURFACES`; only `dom.` is spelled out, because it
// belongs to no surface.
const READER_PREFIXES = [...UI_SURFACES.map((s) => `${s}.`), "dom."];

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
  if (name === "dom.controls") return await domControls(page);
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

async function waitForReady(page, url, expectedSurface = null) {
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

  // ASK THE PAGE WHAT IT ACTUALLY MOUNTED.
  //
  // The check above proves something is ready, not that it is the right something. The
  // hunt page resolves `?surface=` from the URL and must keep DEFAULTING an unrecognised
  // value, because a URL is typed by hand — so single-sourcing the vocabulary across this
  // repository's own lists still cannot make the page tell us it substituted. This can:
  // the bridge reports the surface it installed, and nothing between here and there gets
  // to disagree silently.
  if (expectedSurface !== null) {
    const mounted = await page.evaluate((key) => {
      const bridge = window[key];
      return bridge && typeof bridge.surface === "function" ? bridge.surface() : null;
    }, BRIDGE_KEY);
    assertMountedSurface(expectedSurface, mounted);
  }
}


async function runAction(page, action, baseUrl, timeoutMs, fault = null) {
  switch (action.type) {
    case "goto": {
      // REFUSED, NOT COERCED. This read `=== "doc" ? "doc" : "sheet"`, so any surface
      // the plan validator had not already rejected became the sheet without a word.
      // Nothing could reach it today — `assertSafeActionPlan` runs first — which is
      // precisely why it was worth removing before a third surface exists rather than
      // after: the copy that errors is the one you remember to update.
      const surface = String(action.surface ?? "");
      if (!UI_SURFACES.includes(surface)) {
        throw new Error(
          `goto surface ${JSON.stringify(action.surface)} is not one of: ${UI_SURFACES.join(", ")}`,
        );
      }
      // `?fault=` rides on the SAME navigation as `?surface=`, so a seeded defect
      // survives every reset the plan performs. Injecting it once at boot instead
      // would silently switch itself off the first time the agent navigated, and a
      // positive control that stops controlling is worse than none.
      const seed = fault ? `&fault=${encodeURIComponent(fault)}` : "";
      await waitForReady(page, `${baseUrl}/harness/hunt?surface=${surface}${seed}`, surface);
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
 * Open a page configured identically for every mode.
 *
 * A FRESH context per replay attempt is the deliberate trade — it resets storage,
 * cookies and page state in ~200ms where a process restart costs the ~6.1s Vite and
 * Chromium boot (measured). What must not leak between attempts is page state, and a
 * context boundary is exactly that.
 */
async function openPage(browser, baseUrl) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
  });
  const page = await context.newPage();
  // Fulfil backend calls rather than letting them fail. They are handled in the app
  // (the toolbar catches and toasts), so this is not about preventing a crash — it
  // is about not teaching a later agent that clicking "save default styles" is a
  // way to make something red.
  await page.route("**/auth/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ styles: {} }) }),
  );
  return { context, page, oracles: attachOracles(page, baseUrl) };
}

/**
 * Execute ONE action and return its observation. The single implementation both modes
 * share.
 *
 * Extracted rather than duplicated for the reason this codebase keeps relearning: two
 * copies of "what an observation is" would drift, and the drift would be invisible —
 * a candidate produced by the interactive path would replay down a subtly different
 * path and be dropped as non-deterministic, or worse, not be.
 */
async function observeAction(page, action, { baseUrl, timeoutMs, oracles, index, fault = null }) {
  let result = null;
  let error = null;
  try {
    result = await runAction(page, action, baseUrl, timeoutMs, fault);
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
  return {
    index,
    action,
    ok: error === null,
    error,
    value: result ? boundValue(result.value) : null,
    // Present only when the action carried a prediction, so an observation
    // without one is distinguishable from one whose read returned null.
    ...(action.expect ? { actual: boundValue(actual), actualError } : {}),
    oracles: [...oracles.drain(), ...domFindings],
  };
}

/**
 * SERVE MODE — boot once, then one action per request for the life of the process.
 *
 * WHY THIS EXISTS. The CLI hunter's tool spawns a fresh process per probe, which costs
 * milliseconds. Doing the same here would cost the whole run: booting Vite and
 * Chromium is ~6.1s and every action after that is ~4ms (measured — a 1-action plan
 * and a 3-action plan both take ~6.1s). At `maxActions: 80` that is ~8 minutes of pure
 * boot per exploration session, and roughly half an hour across a run whose entire
 * budget is ~15 minutes of probing. Boot has to be amortised.
 *
 * PROTOCOL — newline-delimited JSON, one response per request, in order:
 *
 *   <- {"ready":true,"baseUrl":"http://127.0.0.1:53211"}
 *   -> {"id":1,"action":{"type":"goto","surface":"doc"}}
 *   <- {"id":1,"observation":{...}}
 *   -> {"id":2,"op":"close"}
 *   <- {"id":2,"closed":true}
 *
 * An action that FAILS is not a protocol error — it comes back as an observation with
 * `ok:false`, exactly as in plan mode, because "the click missed" is data the hunter
 * needs rather than a transport fault. Only a malformed request or an internal fault
 * answers with `{id,error}`, and even then the process stays up: killing the browser
 * over one bad line would throw away the ~6s boot this mode exists to preserve.
 *
 * ONE page for the whole session, deliberately. An exploration is a user session —
 * type here, then undo, then check — and resetting between actions would make every
 * multi-step behaviour unobservable. Isolation comes from the mount being
 * `MemStore`/`MemDocStore` with no backend, not from discarding state.
 */
async function serve(browser, baseUrl, timeoutMs, fault = null) {
  const readline = await import("node:readline/promises");
  const { context, page, oracles } = await openPage(browser, baseUrl);
  let index = 0;

  const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  send({ ready: true, baseUrl });

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const raw = line.trim();
      if (raw === "") continue;
      let req;
      try {
        req = JSON.parse(raw);
      } catch {
        // Cannot correlate a reply without an id, so say so on the channel and
        // continue rather than guessing which request this was.
        send({ id: null, error: `unparseable request line: ${raw.slice(0, 120)}` });
        continue;
      }
      const id = req?.id ?? null;
      try {
        if (req?.op === "close") {
          send({ id, closed: true });
          return;
        }
        if (!req?.action || typeof req.action !== "object") {
          send({ id, error: "request needs an `action` object or op:\"close\"" });
          continue;
        }
        const observation = await observeAction(page, req.action, {
          baseUrl,
          timeoutMs: Number.isFinite(req.timeoutMs) ? req.timeoutMs : timeoutMs,
          oracles,
          index: index++,
          // Serve mode is the EXPLORER's path. Omitting this made the seeded control
          // inert for every exploration session while still working under `--plan`,
          // so the control passed its own lane and proved nothing about a real hunt —
          // the exact failure the control exists to detect, in the control itself.
          fault,
        });
        send({ id, observation });
      } catch (err) {
        // An internal fault — the page crashed, the context died. Report and stay up;
        // the caller decides whether to keep going.
        send({ id, error: String(err?.message ?? err) });
      }
    }
  } finally {
    rl.close();
    await context.close();
  }
}

/** One replay attempt: a whole plan against a fresh page. */
async function runAttempt(browser, plan, baseUrl, timeoutMs, fault = null) {
  const { context, page, oracles } = await openPage(browser, baseUrl);
  try {
    const observations = [];
    for (const [index, action] of plan.actions.entries()) {
      observations.push(await observeAction(page, action, { baseUrl, timeoutMs, oracles, index, fault }));
    }
    return { observations };
  } finally {
    await context.close();
  }
}

// --- main --------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
let plan = null;
if (!args.serve) {
  plan = JSON.parse(readFileSync(args.plan, "utf8"));
  if (!Array.isArray(plan.actions) || plan.actions.length === 0) {
    throw new Error("hunt-ui-runner: plan must have a non-empty `actions` array");
  }
}

const playwright = await loadPlaywright();
// `--port 0` means "do not pin a port", and that is what `runUiPlan` passes. Samples
// run concurrently from PR 4 onward, and a fixed port under `strictPort` makes the
// second runner fail to boot. A pinned port stays the default for manual runs, where a
// stable URL is worth more than concurrency.
//
// Measured, because the obvious reading of this is wrong: it does NOT get an
// OS-assigned ephemeral port. Vite treats `port: 0` as unset and falls back to its own
// default, then auto-increments because `strictPort` is off — three concurrent sessions
// came up on 5173, 5174 and 5175. Non-collision is what matters and it holds, but the
// mechanism is vite's scan, not `bind(0)`, and `baseUrl` is resolved from the listening
// socket afterwards precisely so this file never has to assume which it got.
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

  if (args.serve) {
    // Serve mode owns stdout for the protocol, so it never produces a `result`
    // envelope. It returns when the caller sends `op:"close"` or closes stdin.
    await serve(browser, baseUrl, args.timeoutMs, args.fault);
    result = null;
  } else {
    const attempts = [];
    for (let i = 0; i < args.attempts; i++) {
      attempts.push(await runAttempt(browser, plan, baseUrl, args.timeoutMs, args.fault));
    }
    result = { ok: true, attempts };
  }
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

if (result === null) {
  // Serve mode. Every line it owed the caller is already on stdout.
  process.exit(0);
}
const json = JSON.stringify(result);
if (args.out) writeFileSync(args.out, `${json}\n`);
else process.stdout.write(`${json}\n`);
process.exit(result.ok ? 0 : 1);
