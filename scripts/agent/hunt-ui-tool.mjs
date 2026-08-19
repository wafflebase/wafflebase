// The ONE tool the UI explorer gets: do a thing in the browser, say what you expect.
//
// The CLI hunter's `run` tool hands over a command and returns its output. This one is
// deliberately narrower, because the failure mode here is different. A CLI probe's
// output IS the evidence. A UI action's evidence is whatever the app looks like
// afterwards — and if the tool volunteers that, the model reads the answer before it
// commits to a prediction, and every prediction "holds".
//
// So the shape is: ONE action, plus an optional prediction about what a named reader
// will report once the action lands. THE RUNNER performs that read, inside the same
// round-trip as the action itself (`hunt-ui-runner.mjs`, "THE PREDICTION READ"), and
// this tool only reports the comparison. There is no ordering in which a caller can
// look first and predict second.
//
// WHAT THE MODEL DOES NOT GET BACK:
//
//   * a page snapshot, unless it explicitly read `dom.snapshot`
//   * the value of a non-`read` action (a click returns whether it landed, not what
//     the page now says)
//   * the `actual` of a prediction that HELD or was unevaluable — there is nothing to
//     investigate, and handing back the reading would just be the page state it did not
//     ask for. A VIOLATED prediction does report both sides, because the tool then tells
//     the model to investigate before reporting, and it cannot narrow down a value it
//     was never shown. Guarding against it being "retold as a weaker claim" is the
//     verifier panel's job, not this tool's — and the journal keeps the real reading
//     either way, so a retelling does not survive contact with the report.
//   * anything from a surface this run was not assigned
//
// The last one is the per-run surface pin. A run assigned `doc` cannot read `sheet.*`
// and cannot `goto` the sheet surface. `assertSafeActionPlan` only bounds reader
// NAMESPACES (`doc.`/`sheet.`/`dom.`), which is the right check for it to make and not
// enough for this: without an exact-name check here, "explore docs this run" is a
// sentence in a prompt rather than a constraint.
//
// POLARITY. Every path here fails QUIET: a malformed prediction, an unresolvable
// reference, a read that threw — all become `unevaluable`, which is not a finding. The
// review panel fails closed; hunting fails quiet. Nothing in this file may manufacture a
// candidate out of its own trouble.
//
// No third-party static imports — `agent:tests` runs with `scripts/agent/node_modules`
// absent, so the SDK and zod are imported lazily inside `createUiServer` only.

import { redactSecrets } from "./hunt-probe.mjs";
import { assessExpectation, isUnusableValue } from "./hunt-ui-expect.mjs";
import { assertSafeActionPlan, UI_ACTION_TYPES } from "./hunt-ui-probe.mjs";

export const UI_TOOL_NAME = "mcp__wafflebase__ui";

/**
 * The readers, grouped by the surface that provides them.
 *
 * DUPLICATED FROM THE BRIDGE ON PURPOSE, and guarded against drift by a test that
 * parses `bridge.ts` and demands the two agree. The alternative — asking the browser at
 * boot — would make the tool description depend on a live session, and the description
 * is the only thing that tells the model these readers exist. A stale list is a silent
 * capability gap: the explorer never calls the reader it was not told about, and that
 * reads as "no defects in that area". The drift test is what makes it not silent.
 */
export const UI_READERS_BY_SURFACE = Object.freeze({
  doc: Object.freeze([
    ["doc.text", "", "the document's full plain text"],
    ["doc.blockCount", "", "how many blocks the document has"],
    ["doc.runs", "", "every run's STORED style: {text, bold, italic, fontSize, color, backgroundColor, …}"],
    ["doc.fontSizes", "", "the font size of each block's first run, in order"],
    ["doc.blockTypes", "", 'each block\'s type, e.g. ["heading1","paragraph"]'],
    ["doc.styleSummary", "", "the CURRENT SELECTION's COMPUTED style, 'mixed' where runs differ — differing from doc.runs is EXPECTED, not a defect"],
    ["doc.selection", "", "the current selection range, or null when nothing is selected"],
    ["doc.linkCount", "", "how many links the document contains"],
    ["doc.canUndo", "", "whether an undoable entry exists — CHECK THIS BEFORE PREDICTING UNDO"],
  ]),
  slides: Object.freeze([
    [
      "slides.elements",
      "",
      "every element on the CURRENT slide: {id, type, x, y, w, h, rotation, text?} — " +
        "x/y/w/h are SLIDE-LOGICAL pixels in a 1920x1080 space, NOT screen pixels",
    ],
    ["slides.selection", "", "the ids currently selected, as a list — empty when nothing is selected"],
    ["slides.slideCount", "", "how many slides the deck has"],
    ["slides.currentSlideIndex", "", "which slide is showing, 1-based"],
    ["slides.elementCenter", "(id)", "an element's centre point — name it as a click target's `reader` to click that element"],
    [
      "slides.pointAt",
      "(x, y)",
      "the point at SLIDE-LOGICAL x,y in the 1920x1080 space — name it as a drag's `to` to drag somewhere specific",
    ],
    [
      "slides.handleCenter",
      "(kind)",
      "a selection handle's centre: nw/n/ne/e/se/s/sw/w resize, `rotate`, connector `start`/`end`/`bend`, `adjust-N` — drag one to resize or rotate",
    ],
    ["slides.canUndo", "", "whether an undoable entry exists — TRUE here, unlike the sheet surface"],
  ]),
  sheet: Object.freeze([
    ["sheet.cellValue", "(sref)", "a cell's STORED value, BEFORE any number format — percent/decimals do not change it"],
    ["sheet.activeCellDisplay", "", "what the ACTIVE cell reads as on screen: its stored value WITH its number format applied"],
    ["sheet.cellFormula", "(sref)", "the formula text of a cell, or null when it holds a literal"],
    ["sheet.activeCell", "", "the currently selected cell reference"],
    ["sheet.selectionRange", "", "the selected range, or null"],
    ["sheet.cellCenter", "(sref)", "a cell's centre point — name it as a click target's `reader` to click that cell"],
    ["sheet.rangeStyles", "", "every range-style patch {range,style} the toolbar has appended — they ACCUMULATE, they are not replaced"],
    ["sheet.activeCellStyle", "", "the ACTIVE cell's COMPUTED style (sheet→col→row→cell) — differing from sheet.rangeStyles is EXPECTED, not a defect"],
    ["sheet.canUndo", "", "whether an undoable entry exists — CHECK THIS BEFORE PREDICTING UNDO"],
  ]),
});

/**
 * Readers that do not belong to a surface — they read the page itself.
 *
 * `dom.snapshot` is the ONLY way to obtain the text a ground-C prediction quotes, and it
 * is never returned unless asked for by name. That asymmetry is intentional: it is both
 * the most expensive thing the model can request and the one that most readily lets it
 * stop predicting and start describing.
 */
export const UI_SHARED_READERS = Object.freeze([
  ["dom.text", "(selector)", "the visible text of the first element matching a CSS selector"],
  ["dom.count", "(selector)", "how many elements match a CSS selector"],
  ["dom.controls", "", "every control you can click right now, as {role,name} — READ THIS FIRST, it is the list `target` takes"],
  ["dom.snapshot", "", "the accessibility tree of the page — sparse on canvas surfaces, so prefer the readers above"],
]);

/**
 * Every surface the hunt route can mount. Matches the runner's `goto` vocabulary.
 *
 * Re-exported from `hunt-ui-surfaces.mjs` rather than derived from the reader table
 * above. Deriving it made the table the only place a surface was written down, which read
 * as tidy and hid that the plan validator and the runner each kept their own copy — and
 * the runner's copy failed by silently substituting the sheet. The list now lives below
 * both, and a test pins this table's keys to it, so a surface with no readers and readers
 * with no surface are each a failing test rather than a quiet substitution.
 */
export { UI_SURFACES } from "./hunt-ui-surfaces.mjs";

/** Display ceiling for one reader value. The journal keeps the full reading. */
export const MAX_DISPLAY_CHARS = 1_200;

/** Fallback per-action ceiling, when the charter does not set one. */
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

/**
 * Which readers this run may use.
 *
 * An unknown surface yields the shared readers only, rather than throwing: the
 * orchestrator validates the surface name, and this staying quiet means a configuration
 * slip degrades a run instead of crashing it mid-session.
 */
export function readersForSurface(surface) {
  // Own-property test, not a bare index. `UI_READERS_BY_SURFACE["constructor"]` resolves
  // through the prototype chain to a function, and spreading a function throws — so a
  // misconfigured surface name crashed the run instead of degrading it. Exactly the bug
  // already fixed once in `bridge.ts`, where `readers["toString"]` resolved to a function
  // and got invoked; the same shape deserves the same guard.
  const own = Object.prototype.hasOwnProperty.call(UI_READERS_BY_SURFACE, surface)
    ? UI_READERS_BY_SURFACE[surface]
    : [];
  return [...own, ...UI_SHARED_READERS];
}

/**
 * Render the reader list for the tool description.
 *
 * The description is the explorer's ONLY map of the surface. PR 1's readers were
 * reachable but undiscoverable — nothing told the model that `doc.fontSizes` existed, so
 * an agent asked to check formatting would reach for `dom.snapshot` and read an
 * almost-empty accessibility tree off a canvas. Listing them, with arity, is the fix.
 */
export function describeReaders(surface) {
  return readersForSurface(surface)
    .map(([name, args, meaning]) => `  ${name}${args} — ${meaning}`)
    .join("\n");
}

/**
 * Is this action within this run's assigned surface?
 *
 * Returns null when fine, or a refusal string. Three places a reader can hide, and the
 * third is the one that is easy to miss: a click target may name a reader
 * (`sheet.cellCenter`) to resolve a point, so checking `action.reader` and
 * `expect.read` alone would leave a way to read across surfaces through a target.
 */
export function checkSurfaceScope(action, surface) {
  const allowed = new Set(readersForSurface(surface).map(([name]) => name));
  const everyKnownReader = new Set(
    [...Object.values(UI_READERS_BY_SURFACE).flat(), ...UI_SHARED_READERS].map(([name]) => name),
  );

  const cited = [action?.type === "read" || action?.type === "wait" ? action.reader : null, action?.target?.reader, action?.expect?.read];
  for (const reader of cited) {
    if (typeof reader !== "string" || reader === "") continue;
    if (allowed.has(reader)) continue;
    return everyKnownReader.has(reader)
      ? `reader ${reader} belongs to another surface. This run explores \`${surface}\`. Available readers:\n${describeReaders(surface)}`
      : `unknown reader ${JSON.stringify(reader)}. Available readers:\n${describeReaders(surface)}`;
  }

  // `goto` names its surface directly — there is no URL to parse, because the runner
  // builds the URL itself from this field.
  if (action?.type === "goto" && action.surface !== undefined && action.surface !== surface) {
    return `this run explores \`${surface}\`; navigating to the ${JSON.stringify(action.surface)} surface is not permitted`;
  }

  return null;
}

/**
 * Turn a model-authored candidate into a replayable plan.
 *
 * The same contract as the CLI hunter's `resolveProbeRefs`, and for the same reason: the
 * model cites journal indices, it does not author the repro. A candidate whose
 * references do not resolve is dropped — quietly, because a repro nobody can run must
 * never reach a report.
 *
 * `expect` is carried through. A prediction is part of what the replay must reproduce:
 * strip it and `runUiPlan` would re-perform the actions without ever re-reading the
 * value the finding rests on, so the determinism gate would be checking a weaker claim
 * than the one being reported.
 */
export function resolveActionRefs(candidate, journal) {
  const refs = candidate?.actionRefs;
  if (!Array.isArray(refs) || refs.length === 0) return null;
  if (!refs.every((i) => Number.isInteger(i) && i >= 0 && i < journal.length)) return null;

  const failing = candidate?.failingRef;
  if (!Number.isInteger(failing)) return null;
  const failingIndex = refs.indexOf(failing);
  if (failingIndex === -1) return null; // the failing action must be among the cited ones

  const actions = refs.map((i) => ({ ...journal[i].action }));
  return { actions, failingIndex };
}

/** Clip one value for display. The journal keeps the full reading. */
/** Clip already-rendered text, saying so. `forDisplay` is for raw reader values. */
function clipText(text) {
  const t = String(text ?? "");
  return t.length <= MAX_DISPLAY_CHARS
    ? t
    : `${t.slice(0, MAX_DISPLAY_CHARS)}\n… clipped at ${MAX_DISPLAY_CHARS} of ${t.length} chars`;
}

function forDisplay(value) {
  if (isUnusableValue(value)) {
    return value.__oversized
      ? "<oversized — the runner could not deliver this value>"
      : "<unserializable — the runner could not deliver this value>";
  }
  if (value === undefined) return "undefined";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (typeof text !== "string") return String(value);
  if (text.length <= MAX_DISPLAY_CHARS) return text;
  return `${text.slice(0, MAX_DISPLAY_CHARS)}\n… clipped at ${MAX_DISPLAY_CHARS} of ${text.length} chars`;
}

/**
 * What the model is told about one action.
 *
 * Every omission is deliberate. A non-`read` action reports only whether it landed — a
 * click that returns the resulting page state is a click that lets the caller skip
 * predicting. Oracles are always reported, because a console error or an `[object
 * Object]` in the DOM is evidence the model did not ask for and must not be able to
 * miss. And a prediction reports its VERDICT, never its `actual`: handing back the
 * measured value invites re-describing a violated prediction as some weaker claim that
 * happens to fit, which is the rationalisation this whole design forbids.
 */
export function renderUiObservation({ action, observation, prediction = null, atIndex = null }) {
  const oracles = Array.isArray(observation?.oracles) ? observation.oracles : [];
  const lines = [];
  lines.push(
    observation.ok ? `ok: ${action.type}` : `FAILED: ${action.type} — ${observation.error ?? "no detail given"}`,
  );

  if ((action.type === "read" || action.type === "wait") && observation.ok) {
    lines.push(`${action.reader} => ${forDisplay(observation.value)}`);
  }

  // THE TOKEN THAT CITES THIS ENTRY, next to the value it names.
  //
  // Ground A requires `value` to be `@read:<i>` or `@input:<i>`, and the caller had no
  // way to learn `<i>` except by counting its own actions since the session began. It
  // miscounts: across three live runs, 10 of 97 predictions resolved to nothing and were
  // discarded as unevaluable — ~10% of all predictive work paid for and thrown away, on
  // arithmetic rather than on anything about the app.
  //
  // Emitted only for entries that CAN be cited, and only on success. Offering
  // `@read:<i>` for a failed read, or for a click, would trade a miscount for a
  // reference that resolves to an unusable entry — the same waste with a friendlier
  // cause. `@input:` names typed text, which is why a `type` gets the other token.
  if (Number.isInteger(atIndex) && observation.ok) {
    if (action.type === "read" || action.type === "wait") {
      lines.push(`cite this reading as @read:${atIndex}`);
    } else if (action.type === "type") {
      lines.push(`cite this text as @input:${atIndex}`);
    }
  }

  if (prediction) {
    lines.push("");
    lines.push(`prediction (${action.expect.op} on ${action.expect.read}): ${prediction.verdict}`);
    // Clipped like any other value. `detail` embeds BOTH sides of the comparison, so a
    // violated `equals` on two large readings rendered ~40k characters straight into the
    // tool result — past the cap `value` respects, in the one place the module calls cost
    // the single biggest lever. Measured before this: 8237 chars against a 1200 cap.
    if (prediction.detail) lines.push(`  ${clipText(prediction.detail)}`);
    if (prediction.verdict === "violated") {
      lines.push(
        prediction.eligible
          ? "  GROUNDED — a candidate. Investigate it before reporting: read more, narrow it down, " +
              "and satisfy yourself it is the app's fault and not your assumption's."
          : `  not grounded, so not reportable: ${prediction.why}`,
      );
    } else if (prediction.verdict === "unevaluable") {
      lines.push(`  ${prediction.why}`);
    }
  }

  if (oracles.length > 0) {
    lines.push("");
    lines.push("oracles fired:");
    for (const o of oracles) lines.push(`  [${o.kind ?? "oracle"}] ${o.detail ?? o.rule ?? ""}`.trimEnd());
  }

  return lines.join("\n");
}

const say = (text, extra = {}) => ({ content: [{ type: "text", text }], ...extra });

/**
 * Build the tool handler.
 *
 * Pure by construction — no SDK, no zod, no network, no browser. `session` is injected,
 * so the whole handler is testable against a stub returning scripted observations, which
 * is the only way any of this runs in `agent:tests`.
 */
/**
 * One line describing an action that just completed, for a human watching a live run.
 *
 * A run costs up to ten minutes and several dollars and, until now, printed NOTHING
 * between "issue corpus: 91 issues" and the final funnel — the journal is only persisted
 * when a brief FINISHES, so a run that hangs leaves no trace of how far it got. Asked
 * whether a 23-minute run was working or stuck, the only available answer was "the
 * process is alive".
 *
 * REDACTED like every other output boundary, and truncated, because the line carries
 * whatever the explorer typed. `budget` is included because it is the one number that
 * separates "working through a long brief" from "looping": actions climb in the first
 * case and stall in the second.
 */
export function renderUiProgress({ label = "", index = 0, action: rawAction, observation: rawObservation, prediction = null, used = 0, total = 0 } = {}) {
  // A default parameter only fills in `undefined`, and this runs on EVERY action of
  // every run — a null slipping through would take down a session to print a log line.
  const action = rawAction && typeof rawAction === "object" ? rawAction : {};
  const observation = rawObservation && typeof rawObservation === "object" ? rawObservation : {};
  const what =
    action.type === "read" || action.type === "wait"
      ? action.reader ?? "?"
      : action.type === "type"
        ? JSON.stringify(String(action.text ?? "").slice(0, 24))
        : action.type === "key"
          ? String(action.key ?? "")
          : (action.target?.name ?? action.target?.reader ?? action.surface ?? "");
  const status = observation.ok === true ? "ok" : `FAILED ${String(observation.error ?? "").slice(0, 60)}`;
  const verdict = prediction?.verdict ? ` · ${prediction.verdict}` : "";
  const budget = total > 0 ? `${used}/${total}` : String(used);
  return `hunt-ui:   ${label} [${budget}] #${index} ${action.type} ${what} ${status}${verdict}`.trimEnd();
}

export function createUiTool({ charter = {}, surface = "doc", session, budget, journal, cfg = {}, label = "", maxActions = 0, onProgress = null } = {}) {
  if (!session || typeof session.act !== "function") throw new Error("hunt-ui-tool: a session with act() is required");
  if (!budget || typeof budget.charge !== "function") throw new Error("hunt-ui-tool: a budget is required");
  if (!Array.isArray(journal)) throw new Error("hunt-ui-tool: a journal array is required");

  const secrets = [cfg.apiKey].filter(Boolean);
  const perActionTimeoutMs = charter?.actionBudget?.perActionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const safe = (text) => redactSecrets(text, { extra: secrets });

  /**
   * The most recent successful `dom.snapshot`, for ground C.
   *
   * Held here rather than passed in, so a ground-C prediction can only be grounded
   * against text the explorer actually caused to be captured. An agent that never
   * snapshots simply has no ground C available — correct, not a gap.
   */
  let lastSnapshot = "";

  return async function runUiTool({ action, note } = {}) {
    // 1. BUDGET FIRST — before validation, so a stream of malformed calls cannot keep an
    //    exhausted session alive.
    const charged = budget.charge();
    if (!charged.ok) return say(charged.why, { isError: true });

    // 2. VALIDATE. `assertSafeActionPlan` owns the whole action vocabulary — including
    //    the prediction's shape and its reader namespace — so it is called and not
    //    re-implemented. A second shape check here could only drift from it.
    try {
      assertSafeActionPlan({ actions: [action] });
    } catch (err) {
      budget.noteRefusal?.("unsafe-action", err.message);
      return say(
        `Refused: ${err.message}\n\nThis is a hard limit, not a suggestion. Choose a different action; do not retry this one.`,
        { isError: true },
      );
    }

    // 3. SURFACE PIN. Checked here because only this call site knows the assignment.
    const scope = checkSurfaceScope(action, surface);
    if (scope) {
      // The MODEL gets the full reader listing, because being told what is available is
      // the only way it recovers. The refusal LOG gets the first line only: a run summary
      // that repeats twelve reader descriptions per refusal is one nobody reads.
      budget.noteRefusal?.("surface-scope", scope.split("\n")[0]);
      return say(`Refused: ${scope}`, { isError: true });
    }

    // 4. EXECUTE, prediction included. The runner reads `expect` and performs the
    //    verification read itself, atomically with the action — that atomicity is what
    //    makes a prediction a prediction, so `expect` is passed through untouched.
    let observation;
    try {
      observation = await session.act(action, {
        // Never let one action outlive the session budget it was admitted under.
        timeoutMs: Math.max(1, Math.min(perActionTimeoutMs, charged.remainingMs ?? perActionTimeoutMs)),
      });
    } catch (err) {
      // A transport or internal fault, not a failed action. It ends up as a readable
      // refusal rather than a thrown tool call, and it is NOT a finding.
      budget.noteRefusal?.("session-fault", err.message);
      return say(`The browser session failed: ${safe(String(err.message ?? err))}`, { isError: true });
    }

    if (action.type === "read" && action.reader === "dom.snapshot" && observation.ok) {
      lastSnapshot = typeof observation.value === "string" ? observation.value : "";
    }

    // 5. JOURNAL. Before assessment, not after: `@read:` references resolve against this
    //    array by index, and an entry that does not exist yet can be neither referenced
    //    nor ordered against. Values arrive already through `boundValue` in the runner,
    //    so they are stored as they came — re-bounding would double-wrap the markers
    //    `isUnusableValue` looks for.
    const entry = {
      action: { ...action },
      note: typeof note === "string" ? note : undefined,
      ok: observation.ok === true,
      value: observation.value,
      error: observation.ok ? undefined : observation.error,
      oracles: Array.isArray(observation.oracles) ? observation.oracles : [],
    };
    journal.push(entry);
    const atIndex = journal.length - 1;

    const progress = (pred) => {
      if (typeof onProgress !== "function") return;
      // Through `safe`, like every other egress from this file: the line carries the
      // control name and whatever was typed.
      onProgress(
        safe(
          renderUiProgress({
            label,
            index: atIndex,
            action,
            observation,
            prediction: pred,
            used: budget.used ?? 0,
            total: maxActions,
          }),
        ),
      );
    };

    if (!action.expect) {
      progress(null);
      return say(safe(renderUiObservation({ action, observation, atIndex })));
    }

    // 6. ASSESS. `atIndex` is this action's own index, so a prediction cannot cite
    //    itself as its own baseline — `not-equals @read:<own index>` is otherwise a
    //    finding generator that passes every grounding check.
    const prediction = assessExpectation(action.expect, observation.actual, {
      journal,
      snapshot: lastSnapshot,
      charter,
      actualError: observation.actualError ?? null,
      atIndex,
    });
    entry.prediction = prediction;

    progress(prediction);

    // 7. REDACT on the way out. Public repo; every output boundary is guarded.
    return say(safe(renderUiObservation({ action, observation, prediction, atIndex })));
  };
}

/**
 * The in-process MCP server exposing the single `ui` tool.
 *
 * ASYNC and lazy for the same reason as `createProbeServer`: this is the only function
 * in the file that touches the SDK or zod, so it is the only one that cannot run in the
 * `agent:tests` lane. Everything worth testing lives in `createUiTool`.
 */
export async function createUiServer(opts = {}) {
  // Set BEFORE the SDK is imported — see `createProbeServer` for why this env var is the
  // only available lever on in-process server tool timeouts.
  if (!process.env.MCP_TOOL_TIMEOUT) process.env.MCP_TOOL_TIMEOUT = String(60_000);

  const { createSdkMcpServer, tool } = await import("@anthropic-ai/claude-agent-sdk");
  const { z } = await import("zod");
  const runUiTool = createUiTool(opts);
  const surface = opts.surface ?? "doc";

  const target = z
    .object({
      role: z.string().optional().describe('ARIA role, e.g. "button".'),
      name: z.string().optional().describe('Accessible name, e.g. "Increase font size".'),
      reader: z
        .string()
        .optional()
        .describe('A reader returning {x,y}, e.g. "sheet.cellCenter" — this is how you click a canvas cell.'),
      args: z.array(z.union([z.string(), z.number()])).optional().describe("Arguments for `reader`."),
    })
    .describe("Exactly one of `role` or `reader`. There is no CSS-selector or raw-coordinate targeting.");

  return createSdkMcpServer({
    name: "wafflebase",
    version: "1.0.0",
    instructions:
      `Drive the Wafflebase \`${surface}\` surface in a real browser, one action per call. ` +
      "State persists across calls — this is one continuous session, not independent requests, " +
      "so you can type, then undo, then check what happened.\n\n" +
      "YOU CANNOT SEE THE PAGE. There are no screenshots. You observe only by naming a " +
      "reader, and readers return exact structured values rather than pixels — which is " +
      "better for this purpose, because a claim about a value can be checked and a claim " +
      "about an image cannot.\n\n" +
      "Every action may carry a PREDICTION of what a reader will report once it lands. The " +
      "prediction is submitted with the action and the read is performed for you in the " +
      "same step, so you never see the result first. That is deliberate: a prediction made " +
      "after looking is worthless. Predict often, and predict things you would be genuinely " +
      "surprised to be wrong about.\n\n" +
      "A WRONG PREDICTION IS NOT AUTOMATICALLY A BUG. It becomes a candidate only if it is " +
      "grounded — see `ground`. Most wrong predictions are your own mistaken assumptions " +
      "about how the app should behave, and concluding that is a good outcome, not a " +
      "failure. Do not go looking for a way to call something a defect.\n\n" +
      `Readers available on \`${surface}\`:\n${describeReaders(surface)}`,
    tools: [
      tool(
        "ui",
        `Perform one action on the \`${surface}\` surface, optionally predicting what a reader ` +
          "will then report. Returns whether the action landed, the value if it was a read, " +
          "any oracle that fired, and the prediction's verdict. It does NOT return the page " +
          "state — name a reader for that.",
        {
          action: z
            .object({
              type: z.enum(UI_ACTION_TYPES).describe("What to do."),
              surface: z
                // The run's OWN surface is the only member, so the wrong one is
                // unrepresentable rather than merely refused. `checkSurfaceScope` still
                // checks it — a bound that exists only in a schema the model could be
                // served a stale copy of is not a bound.
                .enum([surface])
                .optional()
                .describe(`For goto: which surface to mount. This run explores "${surface}" and no other.`),
              target: target
                .optional()
                .describe("For click and drag, and optionally for scroll: what to act on. For drag this is where the gesture STARTS."),
              to: target.optional().describe("For drag: where the gesture ENDS. Same shape as `target`."),
              button: z.enum(["left", "right", "middle"]).optional().describe("For click: defaults to left."),
              clickCount: z.number().int().optional().describe("For click: 2 for a double-click."),
              text: z.string().optional().describe("For type: the text to type at the current caret."),
              key: z
                .string()
                .optional()
                .describe('For key: the key to press, e.g. "Control+z", "Enter", "ArrowDown".'),
              dx: z.number().optional().describe("For scroll: horizontal wheel delta."),
              dy: z.number().optional().describe("For scroll: vertical wheel delta."),
              reader: z.string().optional().describe("For read and wait: the reader name."),
              args: z.array(z.union([z.string(), z.number()])).optional().describe("For read and wait: reader arguments."),
              equals: z
                .any()
                .optional()
                .describe("For wait: keep re-reading until the reader returns this value, or time out."),
              expect: z
                .object({
                  read: z.string().describe("Which reader to check the prediction against."),
                  args: z.array(z.union([z.string(), z.number()])).optional().describe("That reader's arguments."),
                  op: z
                    .enum(["equals", "not-equals", "contains", "not-contains", "each-greater-than", "each-less-than"])
                    .describe("How to compare. There is no regex — comparisons are exact by design."),
                  value: z
                    .any()
                    .describe(
                      "What you expect. Either a literal, or a reference to an earlier step in " +
                        'this session: "@read:3" is the value read at step 3, "@input:5" is the ' +
                        "text typed at step 5. A reference must point to an EARLIER step that " +
                        "succeeded — including to your own current step is refused.",
                    ),
                  ground: z
                    .enum(["A", "B", "C", "D"])
                    .describe(
                      "Why you are entitled to expect this. " +
                        "A = self-evident: it follows from something you read earlier in THIS " +
                        "session, and `value` must be the @read:/@input: reference to that step. " +
                        "B = documented: a design doc or README says so, and `source` is its path. " +
                        "C = the UI itself says so, and `source` quotes the text from a " +
                        "dom.snapshot you actually took. " +
                        "D = convention or general expectation — NEVER reportable, but still " +
                        "worth predicting, because a surprise is worth knowing about even when " +
                        "it is not a bug.",
                    ),
                  source: z.string().optional().describe("Required for B (a doc path) and C (the quoted UI text)."),
                  because: z.string().describe("One line: why you expect this."),
                })
                .optional()
                .describe("Your prediction. Optional, but an action without one teaches nothing."),
            })
            .describe("The single action to perform."),
          note: z
            .string()
            .optional()
            .describe("Why you are doing this — recorded with the action and read by whoever triages the report."),
        },
        (args) => runUiTool(args),
      ),
    ],
  });
}
