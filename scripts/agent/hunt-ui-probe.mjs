// The agent-side half of the UI probe — validates an action plan, runs it, and
// reduces what came back to a comparable SHAPE.
//
// WHY A SUBPROCESS AND NOT AN IMPORT. `playwright` does not resolve from this
// directory. `scripts/agent` is a standalone npm package outside the pnpm workspace
// with its own `node_modules`; playwright is a dependency of
// `packages/frontend`. Verified, not assumed:
//
//   from packages/frontend :  import('playwright') -> ok, chromium present
//   from scripts/agent     :  import('playwright') -> ERR_MODULE_NOT_FOUND
//
// Adding it here would duplicate a version that `run-browser-tests-docker.sh` pins
// against `Dockerfile.playwright`, so the hunter and CI could silently disagree
// about what a browser is. The driver therefore lives in `packages/frontend/scripts`
// and this module spawns it.
//
// That boundary also keeps the async browser behind a SYNCHRONOUS call, which is
// what lets `hunt-probe.mjs`'s `replay()` — a sync for-loop over `spawnSync` — be
// reused unchanged instead of rewritten.
//
// NO THIRD-PARTY STATIC IMPORTS. `verify-self.mjs`'s `agent:tests` lane runs with
// `scripts/agent/node_modules` ABSENT, so a static import of anything that is not
// `node:` or relative makes every test in this file fail to load. `ask.test.mjs`
// enforces this with a recursive walk; it is stated here too because prose
// invariants get broken (that is exactly how #600 broke CI).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scrubVolatile } from "./hunt-fingerprint.mjs";
import { checkExpectationShape } from "./hunt-ui-expect.mjs";
import { withScratch } from "./hunt-probe.mjs";

/** Relative to the repo root — the driver, which is where playwright resolves. */
export const UI_RUNNER_REL = path.join("packages", "frontend", "scripts", "hunt-ui-runner.mjs");

/**
 * The complete action vocabulary. Closed on purpose: there is no "evaluate this
 * JavaScript" action and no CSS selector, so a caller's reachable surface is bounded
 * by code in this repository rather than by whatever it can phrase.
 */
export const UI_ACTION_TYPES = Object.freeze(["goto", "click", "type", "key", "scroll", "read", "wait"]);

/**
 * Reader namespaces. This is not a duplicate of the reader list — it is the ROUTING
 * contract the driver implements (`dom.*` needs Playwright locators, everything else
 * is the page's own bridge). The authoritative list of reader NAMES lives in the
 * bridge, which refuses an unknown one at runtime with the valid set; checking the
 * prefix here just fails a typo before paying for a browser boot.
 */
export const UI_READER_PREFIXES = Object.freeze(["doc.", "sheet.", "dom."]);

const DEFAULT_ATTEMPTS = 1;
/** Beyond this a value is keyed by hash — a `dom.snapshot` must not become the key. */
const MAX_INLINE_VALUE_CHARS = 200;
/** Mouse buttons Playwright accepts. */
const CLICK_BUTTONS = Object.freeze(["left", "right", "middle"]);
/** Enough for a triple-click; anything more is a typo or a hang. */
const MAX_CLICK_COUNT = 3;

// --- plan validation ---------------------------------------------------------

function bad(message) {
  throw new Error(`hunt-ui-probe: ${message}`);
}

function assertReader(name, where) {
  if (typeof name !== "string" || name === "") bad(`${where} needs a reader name, got ${JSON.stringify(name)}`);
  if (!UI_READER_PREFIXES.some((p) => name.startsWith(p))) {
    bad(`${where} reader ${JSON.stringify(name)} must start with one of ${UI_READER_PREFIXES.join(", ")}`);
  }
}

function assertTarget(target, where) {
  if (!target || typeof target !== "object") bad(`${where} needs a target object, got ${JSON.stringify(target)}`);
  const hasRole = typeof target.role === "string" && target.role !== "";
  const hasReader = typeof target.reader === "string" && target.reader !== "";
  if (hasRole === hasReader) {
    bad(`${where} target must have exactly one of \`role\` or \`reader\`, got ${JSON.stringify(target)}`);
  }
  if (hasReader) assertReader(target.reader, `${where} target`);
  if (target.args !== undefined && !Array.isArray(target.args)) bad(`${where} target \`args\` must be an array`);
}

/**
 * Validate an action plan, throwing on the first problem.
 *
 * Fails CLOSED, the same direction as `assertSafeArgv`: an action whose shape cannot
 * be established is refused rather than passed through and interpreted loosely by
 * the driver. Over-refusing costs one rejected plan; under-refusing means a caller
 * reached something the vocabulary was supposed to bound.
 */
export function assertSafeActionPlan(plan) {
  if (!plan || typeof plan !== "object") bad(`plan must be an object, got ${JSON.stringify(plan)}`);
  const actions = plan.actions;
  if (!Array.isArray(actions) || actions.length === 0) bad("plan.actions must be a non-empty array");

  actions.forEach((action, i) => {
    const where = `action ${i}`;
    if (!action || typeof action !== "object") bad(`${where} must be an object, got ${JSON.stringify(action)}`);
    if (!UI_ACTION_TYPES.includes(action.type)) {
      bad(`${where} has unknown type ${JSON.stringify(action.type)}; valid: ${UI_ACTION_TYPES.join(", ")}`);
    }
    // A prediction is validated HERE, before a browser boots, for the same reason
    // the action vocabulary is: a shape problem should surface at the plan rather
    // than eight seconds later inside Playwright. The reader also goes through the
    // same namespace check as any other, so `expect.read` is not a way around it.
    if (action.expect !== undefined) {
      const problems = checkExpectationShape(action.expect);
      if (problems.length > 0) bad(`${where} prediction is malformed: ${problems.join("; ")}`);
      assertReader(action.expect.read, `${where} prediction`);
    }
    switch (action.type) {
      case "goto":
        if (action.surface !== "sheet" && action.surface !== "doc") {
          bad(`${where} surface must be "sheet" or "doc", got ${JSON.stringify(action.surface)}`);
        }
        break;
      case "click":
        assertTarget(action.target, where);
        // `button` and `clickCount` are forwarded straight to Playwright, so an
        // unvalidated value fails inside the browser driver rather than at plan
        // validation — and `clickCount: 1e6` would not fail at all, it would hang.
        // The vocabulary is closed everywhere else; these two were the gap.
        if (action.button !== undefined && !CLICK_BUTTONS.includes(action.button)) {
          bad(`${where} button must be one of ${CLICK_BUTTONS.join(", ")}, got ${JSON.stringify(action.button)}`);
        }
        if (
          action.clickCount !== undefined &&
          (!Number.isInteger(action.clickCount) || action.clickCount < 1 || action.clickCount > MAX_CLICK_COUNT)
        ) {
          bad(`${where} clickCount must be an integer in 1..${MAX_CLICK_COUNT}, got ${JSON.stringify(action.clickCount)}`);
        }
        break;
      case "type":
        if (typeof action.text !== "string") bad(`${where} needs a string \`text\``);
        break;
      case "key":
        if (typeof action.key !== "string" || action.key === "") bad(`${where} needs a non-empty \`key\``);
        break;
      case "scroll":
        if (action.target !== undefined) assertTarget(action.target, where);
        if (!Number.isFinite(action.dx ?? 0) || !Number.isFinite(action.dy ?? 0)) {
          bad(`${where} dx/dy must be finite numbers`);
        }
        break;
      case "read":
      case "wait":
        assertReader(action.reader, where);
        if (action.args !== undefined && !Array.isArray(action.args)) bad(`${where} \`args\` must be an array`);
        break;
      default:
        bad(`${where} unhandled type ${JSON.stringify(action.type)}`);
    }
  });
  return true;
}

// --- outcome shape -----------------------------------------------------------

/**
 * Remove the parts of an observation that legitimately differ between two runs of
 * the same behaviour.
 *
 * Layered on `scrubVolatile` rather than replacing it, so the two hunters cannot
 * drift on what "volatile" means. One UI-specific rule is added because
 * `generateBlockId()` is `block-${Date.now()}-${counter}` — measured live, the same
 * selection read twice gave `block-1785735868118-3` and `block-1785735870911-3`.
 * Only the timestamp moves, so only the timestamp is scrubbed: keeping the ordinal
 * preserves the distinction between block 3 and block 5, which is real signal.
 */
export function scrubUiVolatile(text) {
  const once = scrubVolatile([String(text ?? "")])[0];
  return once.replace(/\bblock-\d{10,}-(\d+)\b/g, "block-<T>-$1");
}

/**
 * Collapse a Playwright/driver error to a stable class.
 *
 * A raw message embeds timeouts in ms and locator text, so keying on it would make
 * every replay look divergent — the same reason `observedKey` compares outcome shape
 * rather than message text.
 */
export function classifyUiError(message) {
  const m = String(message ?? "");
  if (m === "") return "none";
  if (/Timeout .*exceeded|timed out/i.test(m)) return "timeout";
  if (/unknown reader/i.test(m)) return "unknown-reader";
  if (/unresolvable target|did not return \{x,y\}/i.test(m)) return "unresolvable-target";
  if (/hunt bridge is not installed/i.test(m)) return "no-bridge";
  if (/goto the (sheet|doc) surface first/i.test(m)) return "wrong-surface";
  if (/unknown action type/i.test(m)) return "unknown-action";
  return `other:${scrubUiVolatile(m).split("\n")[0].slice(0, 80)}`;
}

function valueKey(value) {
  if (value === null || value === undefined) return "null";
  const scrubbed = scrubUiVolatile(typeof value === "string" ? value : JSON.stringify(value));
  if (scrubbed.length <= MAX_INLINE_VALUE_CHARS) return scrubbed;
  return `sha256:${createHash("sha256").update(scrubbed).digest("hex").slice(0, 16)}`;
}

/**
 * The SHAPE of what one action did — never its message text.
 *
 * The UI analogue of `observedKey` in hunt-fingerprint.mjs, and it carries one thing
 * that one does not: the read VALUE. For a CLI probe the outcome is the exit code;
 * for a UI read the value IS the outcome — `[11,18,32]` versus `[11,11,11]` is the
 * entire difference between working and broken. Values are scrubbed, and hashed past
 * a threshold so a page snapshot cannot become the key.
 *
 * Oracles are reduced to `kind:rule` and de-duplicated: WHICH invariant broke is
 * stable, how many times it broke in one action is not.
 */
export function uiObservedKey(observation) {
  const o = observation && typeof observation === "object" ? observation : {};
  const type = o.action && typeof o.action === "object" ? String(o.action.type ?? "?") : "?";
  const reader = o.action && typeof o.action === "object" && o.action.reader ? String(o.action.reader) : "";
  const oracles =
    [...new Set((Array.isArray(o.oracles) ? o.oracles : []).map((x) => (x?.rule ? `${x.kind}:${x.rule}` : String(x?.kind ?? "?"))))]
      .sort()
      .join(",") || "none";
  const err = o.ok === true ? "none" : classifyUiError(o.error);
  // `actual` participates for the same reason `value` does, and more urgently: it is
  // the value a prediction verdict RESTS on. Leaving it out made replay — the
  // determinism gate that exists to kill phantom repros — blind to the one number a
  // violation was computed from, so a flaky prediction outcome sailed through 3/3
  // identical attempts. `actualError` is folded in as a class, not a message.
  const predicted = "actual" in o ? `|actual:${valueKey(o.actual)}|aerr:${o.actualError ? classifyUiError(o.actualError) : "none"}` : "";
  return `act:${type}${reader ? `(${reader})` : ""}|ok:${o.ok === true}|err:${err}|oracles:${oracles}|value:${valueKey(o.value)}${predicted}`;
}

/**
 * One key for a whole attempt.
 *
 * `replay()` keys only the LAST observation, which for a CLI probe is the failing one
 * but for a UI plan usually is not — the failing action is commonly mid-sequence with
 * reads after it. Folding every observation in means a divergence ANYWHERE in the
 * plan is a divergence, which is the property replay actually needs.
 *
 * Order is significant: the per-observation keys are joined in sequence, so the same
 * outcomes in a different order hash differently. That is intended — two attempts of
 * one plan execute the same actions in the same order, and if they did not, that is
 * itself a divergence worth catching.
 */
export function uiPlanKey(observations) {
  const parts = (Array.isArray(observations) ? observations : []).map(uiObservedKey);
  return `n:${parts.length}|${createHash("sha256").update(parts.join(" ")).digest("hex").slice(0, 32)}`;
}

/** Did any free oracle fire anywhere in this attempt? */
export function oraclesFired(observations) {
  const out = [];
  for (const o of Array.isArray(observations) ? observations : []) {
    for (const oracle of Array.isArray(o?.oracles) ? o.oracles : []) {
      out.push({ index: o.index, ...oracle });
    }
  }
  return out;
}

// --- running -----------------------------------------------------------------

/**
 * Run an action plan in a browser, N times, returning one observation array per
 * attempt.
 *
 * `runner` is injectable for the same reason `runProbe`'s is: the tests exercise
 * validation, keying and error handling with no browser and no network.
 *
 * A runner-level failure (`ok: false`) THROWS rather than returning empty
 * observations. Infrastructure trouble must not be able to present itself as "the
 * app did nothing", which is a shape a caller could mistake for a finding.
 */
export function runUiPlan(
  plan,
  { repoRoot, attempts = DEFAULT_ATTEMPTS, timeoutMs = 180_000, port = 0, runner = null } = {},
) {
  assertSafeActionPlan(plan);
  if (!Number.isInteger(attempts) || attempts < 1) bad(`attempts must be a positive integer, got ${attempts}`);

  if (typeof runner === "function") return runner(plan, { repoRoot, attempts, port });

  const runnerPath = path.join(repoRoot, UI_RUNNER_REL);
  return withScratch((dir) => {
    const planFile = path.join(dir, "plan.json");
    const outFile = path.join(dir, "out.json");
    writeFileSync(planFile, JSON.stringify(plan));

    const res = spawnSync(
      process.execPath,
      // Port 0 by default: the OS picks a free one. The runner's own default is a
      // fixed port for reproducible manual runs, but two concurrent samples on a
      // fixed port make the second fail to boot, and PR 4 runs samples concurrently.
      [runnerPath, "--plan", planFile, "--out", outFile, "--attempts", String(attempts), "--port", String(port)],
      {
        cwd: path.join(repoRoot, "packages", "frontend"),
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        encoding: "utf8",
        maxBuffer: 8 << 20,
      },
    );

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(outFile, "utf8"));
    } catch {
      const detail = (res.stderr || res.stdout || "").trim().split("\n").slice(-5).join("\n");
      bad(`runner produced no readable result (exit ${res.status}${res.signal ? `, ${res.signal}` : ""})\n${detail}`);
    }
    if (!parsed.ok) bad(`runner failed: ${parsed.error}`);
    return parsed.attempts.map((a) => a.observations);
  }, { prefix: "wb-hunt-ui-" });
}
