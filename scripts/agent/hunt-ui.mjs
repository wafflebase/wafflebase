// UI issue-hunt orchestrator — explore → replay → verify → report.
//
// The browser sibling of hunt.mjs. Same pipeline, same trust boundary, same
// fail-quiet polarity; only the probe layer and the prediction protocol differ.
//
//   explore   MODEL   drives a live browser, predicting before each action
//   coerce    script  drops structurally unusable candidates
//   novelty   script  skips what a previous run already resolved
//   replay    script  re-runs the cited actions 3x in fresh browser contexts
//   verify    MODEL   N verifiers per candidate, each naming a ground (capped)
//   gate      script  isFilingVerdict — the ONLY place "report it" is decided
//   report    script  renders, redacting secrets first
//
// WHAT IS SHARED WITH THE CLI HUNTER, AND WHAT IS NOT.
//
// The GATE is shared, deliberately and at some cost: `isFilingVerdict` takes the
// two things that genuinely differ (the permitted grounds, and where citations come
// from) as options rather than being duplicated here. A second gate would not be
// covered by the mutation tests that guard the first, and "every branch returns
// false, exactly one path to true" is a property that has to be tested rather than
// asserted twice.
//
// The REPORT RENDERER is not shared, and that asymmetry is the point. A renderer is
// presentation: duplicating it costs a little prose and no correctness, while the
// two hunters genuinely want different content — an argv repro versus an action
// plan, `citations` versus a prediction verdict. What IS reused from it is the one
// part that carries a safety property: `redactSecrets` at the egress boundary, and
// the rule that a section for personas which never ran always renders, because
// "found nothing" and "never executed" are otherwise the same zero.
//
// Usage:
//   node hunt-ui.mjs preflight
//   node hunt-ui.mjs run [--charter <id>]... [--surface <doc|sheet>]...
//                        [--out <dir>] [--repo <dir>] [--ledger <file>]
//                        [--run-id <id>] [--fault <id>]
//   node hunt-ui.mjs replay --plan <file.json> [--attempts N]
//   node hunt-ui.mjs report --out <dir>
//
// `preflight` and `replay` return before the SDK is imported, so they work without
// `scripts/agent/node_modules` — which is also how the `agent:tests` lane runs.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { gitSha, repoSlug, makeChangedSince, strArg as sharedStrArg } from "./hunt-cli.mjs";
import { fileURLToPath } from "node:url";

import {
  UI_EXPLORER_SCHEMA,
  UI_VERIFIER_SCHEMA,
  UI_GROUNDS,
  isFilingVerdict,
  dropReason,
  coerceCandidates,
  dedupeCandidates,
} from "./hunt-gate.mjs";
import {
  parseSeenLedger,
  serializeSeenLedger,
  isNovel,
  LEDGER_KEY_VERSION,
} from "./hunt-fingerprint.mjs";
import { renderDeferrals, loadScopedDocs, renderIssues, fetchIssues } from "./hunt-corpus.mjs";
import { createProbeBudget } from "./hunt-tool.mjs";
import { replay, redactSecrets } from "./hunt-probe.mjs";
import {
  assertSafeActionPlan,
  runUiPlan,
  uiPlanKey,
  oraclesFired,
  UI_RUNNER_REL,
} from "./hunt-ui-probe.mjs";
import { openUiSession } from "./hunt-ui-session.mjs";
import {
  createUiServer,
  resolveActionRefs,
  readersForSurface,
  UI_SURFACES,
  UI_TOOL_NAME,
} from "./hunt-ui-tool.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** How many reproduced candidates one persona may send to the verifier panel. */
const DEFAULT_MAX_VERIFIED = 4;

/** The read grant. `ask.mjs` validates this against its own allow-list. */
const HUNT_TOOLS = ["Read", "Grep", "Glob"];

/** The explorer's grant: the same reads, plus the one bounded browser tool. */
const EXPLORER_TOOLS = [...HUNT_TOOLS, UI_TOOL_NAME];

// --- personas ----------------------------------------------------------------

/**
 * Load the persona manifest and attach each one's rubric.
 *
 * Mirrors `loadCharters`. A persona is a charter that also declares a `surface` and
 * carries several differentiated `briefs` — one exploration session each. Briefs
 * replaced repeated identical samples when cross-sample agreement was removed: two
 * sessions are now for COVERAGE, so handing them the same instruction wastes one.
 */
export function loadPersonas(dir) {
  const manifest = JSON.parse(readFileSync(path.join(dir, "personas.json"), "utf8"));
  return manifest.map((p) => ({ ...p, rubric: readFileSync(path.join(dir, `${p.id}.md`), "utf8") }));
}

/**
 * Validate a persona before it is allowed to run.
 *
 * Fails LOUD, like `validateCharter`, and for the same reason: a misconfigured
 * persona is a bug in our own config rather than an uncertain finding, and skipping
 * it silently would look exactly like "found nothing".
 *
 * The surface checks are the ones that did not exist for the CLI. `surface` is a
 * field the CLI charters carry and nothing reads; here it selects which readers the
 * explorer is even shown, so a typo would silently hand it an empty toolbox.
 */
export function validatePersona(p) {
  const problems = [];
  if (!p || typeof p !== "object") return ["not an object"];
  if (typeof p.id !== "string" || p.id === "") problems.push("missing id");
  if (!UI_SURFACES.includes(p.surface)) {
    problems.push(`surface ${JSON.stringify(p.surface)} is not one of: ${UI_SURFACES.join(", ")}`);
  }
  if (!Array.isArray(p.briefs) || p.briefs.length === 0) {
    problems.push("missing briefs[] — a persona explores through at least one brief");
  } else {
    const ids = p.briefs.map((b) => b?.id);
    if (ids.some((id) => typeof id !== "string" || id === "")) problems.push("a brief is missing its id");
    if (new Set(ids).size !== ids.length) problems.push("two briefs share an id — they would collide in the report");
    if (p.briefs.some((b) => typeof b?.task !== "string" || b.task.trim() === "")) {
      problems.push("a brief is missing its task");
    }
  }
  if (!Array.isArray(p.oracles) || p.oracles.length === 0) problems.push("missing oracles[]");
  if (!Array.isArray(p.codeScope) || p.codeScope.length === 0) problems.push("missing codeScope[]");
  if (!Array.isArray(p.reportableSeverities) || p.reportableSeverities.length === 0) {
    problems.push("missing reportableSeverities[]");
  }
  if (Number(p.verifiers) < 2) problems.push("verifiers must be >= 2");
  // The turn ceiling must EXCEED the action budget, or the action budget is
  // unreachable and the session dies mid-exploration instead of reporting.
  //
  // Measured, not theorised: the first live run set `maxActions: 80` against
  // `explorerMaxTurns: 60`, and both briefs died at `error_max_turns` after 61 turns
  // having proposed nothing — $2.82 for two sessions that could never have finished.
  // Every action costs at least one turn and the model needs turns to read and reason
  // between them, so the CLI charters all sit at 1.25-1.4x. Anything at or below 1x
  // is a configuration that cannot succeed.
  const maxActions = p.actionBudget?.maxActions;
  const maxTurns = p.explorerMaxTurns;
  if (Number.isFinite(maxActions) && Number.isFinite(maxTurns) && maxTurns <= maxActions) {
    problems.push(
      `explorerMaxTurns (${maxTurns}) must exceed actionBudget.maxActions (${maxActions}) — ` +
        "every action costs a turn, so the action budget is otherwise unreachable",
    );
  }
  // A persona whose declared surface has no readers could never predict anything.
  // Unreachable while `UI_SURFACES` is derived from the reader table, which is
  // exactly why it is worth asserting: it pins that derivation.
  if (readersForSurface(p.surface).length === 0) problems.push(`surface ${p.surface} exposes no readers`);
  return problems;
}

// --- candidate identity and evidence -----------------------------------------

/**
 * The evidence check `coerceCandidates` applies to a UI candidate.
 *
 * The UI analogue of `cliProbeEvidence`: same contract (a rejection reason, or
 * `null`), different vocabulary. Re-running `assertSafeActionPlan` here is defence
 * in depth — every action came out of the journal and was validated on the way in —
 * but the alternative is a gate that trusts a shape it never checked, and the whole
 * point of a closed vocabulary is that nothing reaches the browser unvalidated.
 */
export function uiActionEvidence(c) {
  if (!Array.isArray(c.actions) || c.actions.length === 0) return "no actions — cannot be replayed";
  try {
    assertSafeActionPlan({ actions: c.actions });
  } catch (err) {
    return `unsafe action plan: ${err?.message ?? err}`;
  }
  if (!Number.isInteger(c.failingIndex) || c.failingIndex < 0 || c.failingIndex >= c.actions.length) {
    return `failingIndex ${JSON.stringify(c.failingIndex)} out of range`;
  }
  return null;
}

/**
 * Where the gate's citations come from for a UI candidate: the VERIFIERS.
 *
 * The explorer has no `citations` field at all (see `UI_EXPLORER_SCHEMA`), because
 * localising "the font-size button misbehaved" to a source line means tracing
 * toolbar → `EditorAPI` → the docs style application — expensive in turns, and
 * exactly where a model invents a plausible wrong line. The verifiers read source to
 * do their job anyway, so the location comes from them.
 *
 * This does NOT weaken step 4. Every string returned here still has to match
 * `CITATION` and fall inside the persona's `codeScope`; only the source moved.
 */
export function uiCitationsOf(_claimed, verdicts) {
  return (Array.isArray(verdicts) ? verdicts : []).flatMap((v) => (Array.isArray(v?.groundedIn) ? v.groundedIn : []));
}

/**
 * The assessed verdict for a report, taken from the journal entry that holds it.
 *
 * Exported because the wrong source of this was invisible: an observation carries no
 * `verdict`, so reading one off it produced `"unknown"` on every finding and nothing
 * failed. `"unassessed"` rather than `"unknown"` when it is genuinely missing —
 * "unknown" reads like a measurement that came back inconclusive, which is exactly
 * the confusion that let the bug sit.
 */
export function pickPredictionVerdict(prediction) {
  if (!prediction || typeof prediction !== "object") return { verdict: "unassessed" };
  return {
    verdict: typeof prediction.verdict === "string" ? prediction.verdict : "unassessed",
    ...(prediction.detail ? { detail: prediction.detail } : {}),
    ...(typeof prediction.eligible === "boolean" ? { eligible: prediction.eligible } : {}),
  };
}

/**
 * The action plan a candidate is REPLAYED from: the journal prefix up to and
 * including the failing action, not the subset the model cited.
 *
 * ⚠️ THIS IS THE FIX FOR A FALSE-REPRODUCTION BUG THE FIRST LIVE RUN EXPOSED ⚠️
 *
 * `resolveActionRefs` maps the cited refs to actions, and a model cites the actions
 * that DEMONSTRATE its finding — not the ones that set up the state. All three
 * candidates in the first seeded run cited ranges like `[32..40]`, none of which
 * included the opening `goto`. Replaying just those meant a browser that had never
 * navigated: every read failed with "hunt bridge is not installed".
 *
 * And it scored `reproduced`, 3 of 3, deterministic — because all three attempts
 * failed IDENTICALLY, so their plan keys matched. The determinism gate gave a perfect
 * score to a replay in which nothing ran. Every candidate this pipeline produced
 * would have "reproduced".
 *
 * The prefix is also what the design always said Stage 3 does: replay the entire
 * sequence, not the failing action alone, because a mismatch that depends on earlier
 * setup cannot be told apart from an artifact by replaying one step. Trusted code
 * builds it from the journal, so this is reconstruction rather than model authorship
 * — the citation is still what proves the interaction happened.
 *
 * PR 5's shrinker is the answer to the length this costs, and it can only shrink a
 * plan that reproduces in the first place.
 */
export function replayPlanFor(candidate, journal) {
  const entries = Array.isArray(journal) ? journal : [];
  const failing = candidate?.failingRef;
  if (!Number.isInteger(failing) || failing < 0 || failing >= entries.length) return null;
  const actions = entries.slice(0, failing + 1).map((e) => ({ ...e.action }));
  return { actions, failingIndex: failing };
}

/**
 * Did this replay actually exercise the app?
 *
 * Fail-closed companion to the prefix fix above, and deliberately independent of it:
 * `replay()` already refuses an EMPTY attempt, but an attempt in which every action
 * ERRORED is just as empty in substance and was not covered. Three such attempts
 * agree with each other perfectly, which is exactly how the bug above scored 3/3.
 *
 * One successful observation is enough — a plan may legitimately contain a click that
 * missed or a read that failed, and refusing those would discard real findings. What
 * cannot be a reproduction is a run where NOTHING worked.
 */
export function replayDidRun(observations) {
  const list = Array.isArray(observations) ? observations : [];
  return list.length > 0 && list.some((o) => o?.ok === true);
}

/**
 * The claim as the VERIFIERS bounded it, not as the explorer wrote it.
 *
 * The explorer's `title` reaches a maintainer verbatim and has been wrong about its
 * own scope on every real defect found so far. `groundedIn` already established the
 * precedent: the thing the explorer cannot be trusted to get right is supplied by the
 * party that read the source. This does the same for the claim.
 *
 * Falls back to the explorer's title rather than dropping the finding — a missing
 * `scopedTitle` is a degraded report, not an invalid one, and the fail-quiet gate
 * already refuses anything a verifier did not confirm.
 */
export function uiScopedTitle(claimed, verdicts) {
  const scoped = (Array.isArray(verdicts) ? verdicts : [])
    .map((v) => (typeof v?.scopedTitle === "string" ? v.scopedTitle.trim() : ""))
    .filter((t) => t.length > 0);
  return scoped[0] ?? claimed?.title ?? "(untitled)";
}

/** Did any verifier judge the explorer's own title broader than its evidence? */
export function uiOverclaimed(verdicts) {
  return (Array.isArray(verdicts) ? verdicts : []).some((v) => v?.overclaimed === true);
}

/** The gate options that turn the shared gate into the UI hunter's gate. */
export const UI_GATE_OPTIONS = Object.freeze({ grounds: UI_GROUNDS, citationsOf: uiCitationsOf });

/**
 * The identity of a UI defect, for dedupe across briefs and for the ledger.
 *
 * Every component is computed by trusted code FROM THE JOURNAL — never from model
 * prose, and deliberately not from code citations. The CLI hunter keys on cited
 * `file:line`s and that is precisely what retired cross-sample agreement: two
 * sessions finding the same defect cited it a line or two apart. A UI defect has a
 * better identity available, because the prediction protocol already names what
 * broke: this reader, this comparison, after this kind of action.
 *
 * Returns `""` when nothing locatable is available — the same "unlocatable" signal
 * `codeLocations` produces for the CLI, which the caller records as a drop rather
 * than letting `dedupeCandidates` swallow it silently.
 */
export function uiDefectKey(candidate, journal, { personaId } = {}) {
  const entry = Array.isArray(journal) ? journal[candidate?.failingRef] : undefined;
  const action = entry?.action;
  if (!action || typeof action !== "object") return "";
  const expect = action.expect;
  if (expect && typeof expect === "object" && expect.read && expect.op && expect.ground) {
    return `${personaId}|${action.type}|${expect.read}|${expect.op}|${expect.ground}`;
  }
  // No prediction: this is an oracle finding, so key on WHICH invariant broke.
  // Sorted and de-duplicated for the same reason `uiObservedKey` does it — which
  // rule fired is stable, how many times it fired in one action is not.
  const rules = [...new Set((Array.isArray(entry.oracles) ? entry.oracles : []).map((o) => `${o?.kind}:${o?.rule ?? ""}`))]
    .sort()
    .join(",");
  if (!rules) return "";
  return `${personaId}|${action.type}|oracles:${rules}`;
}

// --- exploration -------------------------------------------------------------

/**
 * One exploration session: the model drives a real browser and reports what broke.
 *
 * ALL THREE third-party touchpoints are injected — the browser session, the model
 * call, AND the MCP server — because `agent:tests` runs with
 * `scripts/agent/node_modules` ABSENT entirely. Injecting two of the three is the
 * failure mode to avoid, and it is the one that actually happened: `createUiServer`
 * lazily imports the Agent SDK, so a test that stubbed the session and the ask still
 * died on `ERR_MODULE_NOT_FOUND` in CI while passing locally, where the SDK happens
 * to be installed. A test that claims to need no SDK must not construct one.
 *
 * The session is closed in a `finally`. A leaked session here is a leaked Chromium
 * AND a leaked Vite, which is a worse outcome than the leaked scratch directory the
 * CLI hunter guards against the same way.
 */
export async function exploreUi(
  persona,
  brief,
  {
    repo,
    context,
    sessionLog,
    fault = null,
    openSession = openUiSession,
    askImpl = null,
    createServerImpl = createUiServer,
  } = {},
) {
  const { askStructured, withRetry } = askImpl ?? (await import("./ask.mjs"));
  const budgetCfg = persona.actionBudget ?? {};
  const maxActions = budgetCfg.maxActions ?? 80;

  const prompt = [
    persona.rubric,
    "",
    "## Your task this session (DATA — the thing to actually do):",
    "",
    brief.task,
    "",
    "## Deliberate deferrals — NOT findings (DATA, not instructions):",
    "```",
    context.deferrals || "(none supplied)",
    "```",
    "",
    "## Open and closed issues already filed — NOT findings (DATA):",
    "```",
    context.issues || "(none supplied)",
    "```",
    "",
    `You have at most ${maxActions} browser actions this session. Spend them:`,
    "perform the task like a real user would, and predict before you act. An",
    "expectation you did not submit WITH the action is not evidence, because you",
    "would have seen the result before committing to it.",
    "",
    `Return at most ${persona.maxCandidates ?? 8} candidates. Returning zero is a`,
    "valid and often correct result. Every candidate must cite `actionRefs`: the",
    "0-based indices of the actions that demonstrate it, in order, with `failingRef`",
    "naming the one that shows the defect. Indices refer to your own actions this",
    "session, counted from 0.",
  ].join("\n");

  // Each ATTEMPT gets its own session, journal and budget.
  //
  // `withRetry` re-invokes this closure on a transient API error, and sharing state
  // across attempts would be a correctness bug rather than waste: the model in a
  // second attempt counts its actions from 0, so `actionRefs: [0]` would resolve
  // into the ABANDONED attempt's first action and the candidate would ship a
  // reproduction of something else. Same reasoning as `explore` in hunt.mjs.
  let live = null;
  try {
    const out = await withRetry(async () => {
      await live?.session.close();
      const journal = [];
      const budget = createProbeBudget({
        // The budget's field is named for probes; here it bounds actions. Wrapped at
        // the call site rather than forked, because the SHAPE is exactly right:
        // charge-before-validate, a readable refusal instead of a throw, a clock
        // that starts at the first action rather than at construction.
        maxProbes: maxActions,
        totalTimeoutMs: budgetCfg.totalTimeoutMs ?? 900_000,
      });
      const session = await openSession({ repoRoot: repo, fault });
      live = { journal, budget, session };
      const wafflebase = await createServerImpl({
        charter: persona,
        surface: persona.surface,
        session,
        budget,
        journal,
        cfg: context.cfg,
      });
      return askStructured({
        systemPrompt:
          `You are the ${persona.title} hunter, exploring the ${persona.surface} surface. ` +
          "Stay strictly in your lane. Use the wafflebase ui tool to act in a real " +
          "browser and observe what actually happens; report only what you have " +
          "demonstrated and what a trusted verdict called violated.",
        prompt,
        model: persona.model,
        repo,
        schema: UI_EXPLORER_SCHEMA,
        sessionLog,
        maxTurns: Number.isFinite(persona.explorerMaxTurns) ? persona.explorerMaxTurns : 60,
        allowedTools: EXPLORER_TOOLS,
        mcpServers: { wafflebase },
        label: "hunt-ui",
      });
    });
    return { out, journal: live.journal, actionCount: live.budget.used, refusals: live.budget.refusals };
  } catch (err) {
    // CARRY THE JOURNAL OUT ON THE ERROR PATH TOO.
    //
    // Without this the partial journal dies with the exception, and the caller
    // persists nothing — which defeats the one file that exists to explain a zero
    // run. Measured on the first live run: both briefs hit `error_max_turns`,
    // `explore-raw.json` was written as `[]`, and $2.82 bought no way to tell
    // whether the explorer had been predicting well and run out of room or had
    // spent sixty turns achieving nothing. The most likely failure mode was the
    // one where diagnosis was impossible.
    if (live) {
      err.journal = live.journal;
      err.actionCount = live.budget.used;
      err.refusals = live.budget.refusals;
    }
    throw err;
  } finally {
    await live?.session.close();
  }
}

// --- verification ------------------------------------------------------------

/**
 * One verifier's read on one candidate.
 *
 * The rubric change that agreement's removal forced lives here. Agreement used to be
 * the second opinion on whether the EXPECTATION was reasonable; without it, that
 * rests entirely on this panel. So the first question is no longer "is this
 * behaviour wrong?" but "was this the right thing to expect?" — and the specific
 * failure to look for is a whole-surface reader compared against an action that
 * touched part of the surface. That prediction is traceable, replayable, and
 * measures the wrong thing.
 */
export async function verifyUi(candidate, persona, { repo, context, sessionLog, index, askImpl = null } = {}) {
  const { askStructured, withRetry } = askImpl ?? (await import("./ask.mjs"));
  const claimed = candidate.claimed;
  const prompt = [
    "A hunter proposed the defect below while driving the real UI, and a trusted",
    "runner ALREADY REPRODUCED it in a fresh browser context. Decide whether it",
    "should be reported to maintainers.",
    "",
    "You are verifier #" + (index + 1) + ".",
    "",
    "## Attack the EXPECTATION first",
    "",
    "This is the most important instruction here, and it is not the obvious one.",
    "A prediction can be well-formed, traceable to a value the agent itself read,",
    "and reproduce every time — and STILL be the wrong thing to have expected. The",
    "specific failure to look for: a reader that reports the WHOLE surface compared",
    "against an action that only touched PART of it. `doc.fontSizes` reports every",
    "block; if the agent selected two of five paragraphs and expected every size to",
    "increase, the prediction fails for a reason that is not a defect.",
    "",
    "So, in order:",
    "  1. Does the reader's SCOPE match what the action actually did?",
    "  2. Do its arguments, and the traced baseline, describe that same thing?",
    "  3. Only then: is the behaviour actually wrong?",
    "",
    "## Then the usual three",
    "",
    "  1. It is genuinely wrong — not intended behavior, not a deliberate deferral.",
    "  2. It is not already covered by an existing issue (set `duplicateOf` if it is).",
    "  3. It is worth a maintainer's attention at the claimed severity.",
    "",
    "## And then bound the CLAIM to the evidence — `scopedTitle`",
    "",
    "The hunter's title is the one thing it writes that reaches a maintainer verbatim,",
    "and every real defect found so far has been described more broadly than its own",
    "evidence supports. Each of these was a TRUE observation wrapped in a FALSE",
    "universal, and each would have sent someone chasing a bug that does not exist:",
    "",
    '  "Bold only removes bold — it can never apply it"        Bold applies fine to',
    "                                                          ordinary text.",
    '  "after a scroll, clicks no longer select any cell"      Clicks work; the cells',
    "                                                          had scrolled offscreen.",
    '  "never removes italic from a right-to-left selection"   It removes correctly',
    "                                                          when the preceding run",
    "                                                          shares the style.",
    "",
    "So write `scopedTitle`: one line, stating the defect no more broadly than what",
    "was actually demonstrated plus what you established in the source. Name the",
    "PRECONDITION that makes it fire if there is one. Prefer the mechanism over the",
    "symptom when you have found it — a title naming the wrong cause is as costly as",
    "one naming the wrong scope.",
    "",
    "Set `overclaimed: true` when the hunter's title asserts more than its evidence.",
    "That does NOT refute the finding — a real defect described loosely is still real,",
    "and your `scopedTitle` is what gets reported. It is recorded so a drift toward",
    "overclaiming is visible.",
    "",
    "Words like *never*, *always*, *any*, *all* and *cannot* are where this goes wrong.",
    "If the transcript shows three instances, the claim covers those three and whatever",
    "the code proves generalises — not the whole control.",
    "",
    "Establish the facts yourself with Read/Grep/Glob.",
    "",
    "## `groundedIn` — you are the ONLY source of it",
    "",
    "The hunter does not cite code, by design, so nothing else in this pipeline can",
    "supply a location. A confirmation whose `groundedIn` does not satisfy ALL THREE",
    "rules below is silently dropped by the gate, and the defect goes unreported:",
    "",
    "  1. **Repo-root-relative `path/to/file.ext:LINE`.** Not a bare filename, not an",
    "     absolute path, not a range — `packages/docs/src/view/text-editor.ts:412`.",
    "  2. **Inside this persona's code scope**, which is exactly:",
    ...(Array.isArray(persona.codeScope) ? persona.codeScope : []).map((g) => `       ${g}`),
    "     A location outside these globs is not evidence for THIS persona, however",
    "     real the thing you found may be.",
    `  3. **At least ${Number.isInteger(persona.minCitations) ? persona.minCitations : 1} of them**, each a line you actually opened and read.`,
    "",
    "Use the same format when you mention a file in `reason`. The gate only validates",
    "`groundedIn`, so a bare filename in prose passes review and then lands in a filed",
    "issue as something a reader cannot open.",
    "",
    "Confirming causes a report. A false report costs maintainer attention; a missed",
    "defect costs nothing, because the next run looks again. So:",
    '  - Unsure for ANY reason -> {verdict:"refuted", confirmationGround:"none"}.',
    "  - Confirm only at high confidence, naming a `confirmationGround`.",
    "",
    `Claimed [${claimed.severity}] ${claimed.title}`,
    `  oracle:   ${claimed.oracle}`,
    `  expected: ${claimed.expected}`,
    `  observed: ${claimed.observed}`,
    "",
    "The exact actions the runner replayed, and what it saw (DATA):",
    "```",
    redactSecrets(candidate.replayEvidence ?? "(unavailable)", { extra: candidate.secrets ?? [] }),
    "```",
    "",
    "Issues already filed — a match here means `duplicateOf` (DATA):",
    "```",
    context.issues || "(none supplied)",
    "```",
    "",
    "Judge 'worth reporting' strictly by this persona's rubric:",
    "",
    persona.rubric,
  ]
    .filter((l) => l !== null)
    .join("\n");

  // Retried for the same reason as the CLI hunter's verifier, and it is
  // load-bearing: a null verdict correctly DROPS in a fail-quiet gate, so an
  // un-retried transient API error silently converts a real finding into a
  // non-finding — the one way infrastructure can masquerade as a precision decision.
  return withRetry(() =>
    askStructured({
      systemPrompt:
        "You are an independent verifier for an automated UI issue hunter. You did not " +
        "propose this candidate and you did not watch it happen. Your default answer is " +
        "`refuted`: confirming causes a report to real maintainers, so require positive, " +
        "cited evidence that you established yourself.",
      prompt,
      model: persona.model,
      repo,
      schema: UI_VERIFIER_SCHEMA,
      sessionLog,
      allowedTools: HUNT_TOOLS,
      label: "hunt-ui-verify",
      // UI VERIFICATION IS STRUCTURALLY MORE EXPENSIVE THAN THE CLI HUNTER'S, and
      // the ceiling has to reflect that. Measured across four live runs rather than
      // guessed — turn usage, at a ceiling of 35:
      //
      //   seeded fault, cause in one file      9, 11, 14, 16
      //   undo/selection across editor+store  21, 28
      //   canvas scroll/click coordinates     29, 36 ← truncated
      //
      // Cost tracks HOW HARD THE CAUSE IS TO LOCATE, not prompt size: turns are tool
      // round-trips, and this verifier is the sole source of the citation, so it must
      // find the cause from scratch in packages it has never read. The CLI hunter's
      // verifier can lean on the explorer's citations and settles at 14-16.
      //
      // Raising the ceiling is close to free, which is the non-obvious part. Seven of
      // eight sessions finished naturally well under 35 — models spend what the task
      // needs, not what they are offered — so a higher ceiling does not inflate the
      // common case, it only rescues the tail. A truncation, by contrast, is pure
      // waste twice: the session is paid for and yields nothing, and the candidate is
      // deliberately not ledgered so the next run pays to assess it again.
      //
      // `stats.unjudgedVerifier` is the signal to watch. If it stays above zero at 50,
      // raise again — but check first whether one persona is asking for causes that
      // are genuinely unlocatable from its `codeScope`.
      maxTurns: Number.isFinite(persona.verifierMaxTurns) ? persona.verifierMaxTurns : 20,
    }),
  );
}

// --- replay ------------------------------------------------------------------

/**
 * Re-run a candidate's cited actions in fresh browser contexts and decide whether it
 * reproduces deterministically.
 *
 * ⚠️ THE WIRING HERE IS THE EASIEST THING IN THIS FILE TO GET SILENTLY WRONG ⚠️
 *
 * `replay()` compares `observedKey(observations[failingIndex])` — ONE observation.
 * That is right for a CLI probe, whose failing command is the whole claim. It is
 * wrong for a UI plan: the failing action is usually mid-sequence with reads after
 * it, so keying one observation would let a divergence anywhere else through. That
 * is why `uiPlanKey` folds EVERY observation.
 *
 * The two fit together exactly one way. Each attempt is wrapped in a single-element
 * array, so `observations[0]` IS that attempt's whole observation array and
 * `uiPlanKey` receives what it expects. `failingIndex: 0` selects it.
 *
 * Get this wrong — pass `uiObservedKey`, or omit `failingIndex` — and replay silently
 * checks a weaker claim than the one being reported. That is the same failure class
 * as #656, where an omitted `failingIndex` made every mid-sequence candidate compare
 * the wrong probe, and it is invisible from the outside because the status still
 * reads `reproduced`.
 */
export function replayUiCandidate(actions, firstObservations, { repo, attempts = 3, fault = null, runPlan = runUiPlan } = {}) {
  const pre = runPlan({ actions }, { repoRoot: repo, attempts, fault });
  return replay(actions, firstObservations, {
    attempts,
    observedKey: uiPlanKey,
    runAttempt: (_actions, i) => [pre[i]],
    failingIndex: 0,
  });
}

/** What the verifier is shown of a replayed sequence. */
export function summarizeUiObservations(observations, actions) {
  return (observations ?? [])
    .map((o, i) => {
      const a = actions?.[i] ?? o.action ?? {};
      const head = `action ${i}: ${a.type ?? "?"}${a.reader ? ` ${a.reader}` : ""}${o.ok === false ? " FAILED" : ""}`;
      const lines = [head];
      if (o.value !== undefined) lines.push(`  read: ${JSON.stringify(o.value)?.slice(0, 800)}`);
      if (o.error) lines.push(`  error: ${String(o.error).slice(0, 400)}`);
      if ("actual" in o) lines.push(`  prediction read: ${JSON.stringify(o.actual)?.slice(0, 800)}`);
      for (const oracle of Array.isArray(o.oracles) ? o.oracles : []) {
        lines.push(`  [${oracle.kind}] ${oracle.detail ?? oracle.rule ?? ""}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

// --- report ------------------------------------------------------------------

/**
 * The runnable repro: an action plan a maintainer can execute without reading prose.
 *
 * Rendered FROM THE JOURNAL, never authored — the same property that makes
 * `renderReproSh` trustworthy. The plan file is written beside the report, and the
 * command replays it in a fresh browser.
 */
export function renderUiRepro(actions, { planPath = "<plan.json>" } = {}) {
  return [
    "```json",
    JSON.stringify({ actions }, null, 2),
    "```",
    "",
    "Replay it:",
    "",
    "```sh",
    `node scripts/agent/hunt-ui.mjs replay --plan ${planPath}`,
    "```",
  ].join("\n");
}

export function renderUiReport({ runId, headSha, personas, reported, dropped, stats, skipped = [], fault = null }) {
  const lines = [
    "# UI hunt report",
    "",
    // FIRST, before anything a reader could mistake for a finding. A seeded run
    // fabricates its findings on purpose; a report that looks identical to a real
    // hunt is how one gets filed. The stderr banner is not enough — the report is the
    // artifact that outlives the terminal.
    ...(fault
      ? [
          `> ⚠️ **SEEDED RUN — NOT A HUNT.** This run injected the known defect \`${fault}\` into`,
          "> the harness, so any finding below is MANUFACTURED and must not be filed. The",
          "> novelty ledger was deliberately not written.",
          ">",
          "> **A refutation here is SUCCESS, not failure.** The verifiers read source to",
          "> establish cause, and this fault lives in the harness route — in this repository.",
          "> A competent verifier will therefore identify it as our own instrumentation and",
          "> refuse it, every time. The control passes when the explorer FINDS it, replay",
          "> REPRODUCES it, and the panel refutes it *for that demonstrable reason*. It does",
          "> NOT pass by being reported; making it reportable would mean blinding the",
          "> verifier to the repository, which is a worse instrument, not a better control.",
          "",
        ]
      : []),
    `- run: \`${runId}\``,
    `- commit: \`${headSha}\``,
    `- personas: ${personas.join(", ")}`,
    ...(fault ? [`- **seeded fault:** \`${fault}\``] : []),
    "",
    "## Funnel",
    "",
    "| stage | count |",
    "| --- | --- |",
    ...Object.entries(stats).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    // Immediately after the funnel, because a reader who sees "0 reported" without
    // this concludes the UI is clean when in fact nothing ran. `--surface` makes
    // this easier to trigger than it ever was for the CLI hunter: filtering to one
    // surface is a one-flag way to manufacture a zero that reads as a clean bill.
    ...(skipped.length > 0
      ? [
          `## Personas that did NOT run (${skipped.length})`,
          "",
          "A zero above is not a clean bill of health — these never executed.",
          "",
          ...skipped.map((k) => `- \`${k.persona}\` — ${k.kind}: ${k.why}`),
          "",
        ]
      : []),
  ];

  if (reported.length === 0) {
    lines.push(
      "## No candidates reported",
      "",
      "This is a normal outcome, not a failure. Every candidate either failed to",
      "reproduce deterministically, was already known, or was refuted by a verifier.",
      "See the drop table below.",
      "",
    );
  } else {
    lines.push(`## Reported (${reported.length})`, "");
    for (const c of reported) {
      const k = c.claimed;
      // The VERIFIERS' scoped claim is the heading, not the explorer's. The explorer
      // has been wrong about its own scope on every real defect found so far, and
      // this is the one line a maintainer reads first.
      const heading = c.scopedTitle ?? k.title;
      lines.push(
        `### [${k.severity}] ${heading}`,
        "",
        // Shown only when they differ, so the report carries what the hunter actually
        // said without implying the two are interchangeable. A reader chasing a
        // filed issue back to its run needs to see the original.
        ...(c.scopedTitle && c.scopedTitle !== k.title
          ? [`> The hunter proposed this as **"${k.title}"** — narrowed by the verifiers to the heading above.`, ""]
          : []),
        `- **persona:** ${c.personaId} / ${c.briefId} (surface \`${c.surface}\`)`,
        `- **oracle:** ${k.oracle}`,
        `- **expected:** ${k.expected}`,
        `- **observed:** ${k.observed}`,
        c.prediction ? `- **prediction:** \`${c.prediction.read}\` ${c.prediction.op} ${c.prediction.value} (ground ${c.prediction.ground}) — ${c.prediction.verdict}` : null,
        // The location comes from the VERIFIERS, not the hunter — the hunter has no
        // citations field. Saying so in the report keeps a reader from looking for
        // an explorer citation that was never collected.
        `- **located by the verifiers:** ${(c.groundedIn ?? []).map((s) => `\`${s}\``).join(", ") || "(none)"}`,
        `- **defect key:** \`${c.defectKey}\``,
        "",
        "Reproduction (generated from the actions that actually ran):",
        "",
        renderUiRepro(c.actions, { planPath: c.planPath ?? "<plan.json>" }),
        "",
      );
    }
  }

  // Candidates the verification CAP truncated, SHOWN rather than merely counted — a
  // bound on how much gets verified is only honest if what it dropped can be read.
  const capped = dropped.filter((d) => d.capped && d.reproduced);
  if (capped.length > 0) {
    lines.push(
      `## Reproduced but not verified — cap reached (${capped.length})`,
      "",
      "Each REPRODUCED deterministically and was dropped only because this persona's",
      "verification cap was already spent. Judge them by hand, and raise",
      "`persona.maxVerified` if the tail is consistently worth the tokens. They are",
      "deliberately absent from the ledger, so they stay eligible for a later run.",
      "",
    );
    for (const d of capped) {
      const c = d.claimed ?? {};
      lines.push(
        `### ${d.title ?? "(untitled)"}`,
        "",
        `- oracle: \`${c.oracle ?? "?"}\` — severity: \`${c.severity ?? "?"}\``,
        `- expected: ${c.expected ?? "(none)"}`,
        `- observed: ${c.observed ?? "(none)"}`,
        "",
      );
    }
  }

  if (dropped.length > 0) {
    lines.push(`## Dropped (${dropped.length})`, "", "| candidate | reason |", "| --- | --- |");
    for (const d of dropped) {
      const title = String(d.title ?? "(untitled)").replace(/\|/g, "\\|").slice(0, 80);
      lines.push(`| ${title} | ${String(d.why).replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }

  // The published-report egress boundary, same as the CLI hunter's. The per-block
  // renderers above redact nothing on their own, so a token echoed inside `observed`
  // or the drop table would otherwise reach a public report on generic patterns
  // alone.
  const extra = [
    ...new Set([...reported, ...dropped].flatMap((c) => (Array.isArray(c.secrets) ? c.secrets : []))),
  ];
  return redactSecrets(lines.filter((l) => l !== null).join("\n"), { extra });
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv, start) {
  const a = { charter: [], surface: [] };
  for (let i = start; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (key === "charter" || key === "surface") a[key].push(value);
    else a[key] = value;
    if (value !== true) i++;
  }
  return a;
}

const strArg = (args, name) => sharedStrArg(args, name, fail);

function fail(msg) {
  console.error(`hunt-ui: ${msg}`);
  process.exit(1);
}

function loadContext(repo, args, personas) {
  const read = (p) => (p && existsSync(p) ? readFileSync(p, "utf8") : "");

  let deferrals = read(args.deferrals);
  if (!deferrals) {
    const scope = [...new Set(personas.flatMap((p) => p.docsScope ?? []))];
    deferrals = renderDeferrals(loadScopedDocs(repo, scope));
  }

  let issues = read(args.issues);
  if (!issues) {
    const slug = repoSlug(repo);
    const fetched = slug ? fetchIssues(slug) : { error: "could not resolve the repo slug" };
    if (fetched.error) {
      console.error(
        `hunt-ui: WARNING — issue corpus unavailable (${fetched.error}). Duplicate suppression is WEAKER this run; the verifiers' own duplicate check is the only guard.`,
      );
      issues = "";
    } else {
      issues = renderIssues(fetched);
      console.error(`hunt-ui: issue corpus: ${fetched.length} issues (open + closed)`);
    }
  }

  return {
    deferrals,
    issues,
    cfg: { apiKey: process.env.WAFFLEBASE_HUNT_API_KEY ?? "" },
  };
}

/**
 * Which personas run this run, and WHY the others did not.
 *
 * Returns both halves on purpose. A surface filter is the easiest new way to
 * manufacture a zero that reads as a clean run, so the excluded personas travel
 * with the selection rather than being computed away.
 */
export function selectPersonas(personas, { charter = [], surface = [] } = {}) {
  const selected = [];
  const excluded = [];
  for (const p of personas) {
    if (charter.length && !charter.includes(p.id)) {
      excluded.push({ persona: p.id, kind: "not-selected", why: `--charter did not name it (selected: ${charter.join(", ")})` });
      continue;
    }
    if (surface.length && !surface.includes(p.surface)) {
      excluded.push({ persona: p.id, kind: "surface-filtered", why: `explores \`${p.surface}\`, and this run was limited to ${surface.map((s) => `\`${s}\``).join(", ")}` });
      continue;
    }
    selected.push(p);
  }
  return { selected, excluded };
}

async function cmdPreflight(args) {
  const repo = path.resolve(strArg(args, "repo") ?? path.join(HERE, "..", ".."));
  const chartersDir = path.resolve(strArg(args, "charters-dir") ?? path.join(HERE, "charters-ui"));
  const problems = [];
  const notes = [];

  // 1. The runner and its browser. `playwright` resolves from packages/frontend and
  //    NOT from scripts/agent, which is the whole reason the driver is a subprocess.
  const runner = path.join(repo, UI_RUNNER_REL);
  if (!existsSync(runner)) problems.push(`runner missing at ${UI_RUNNER_REL} — is this the right --repo?`);
  if (!existsSync(path.join(repo, "packages", "frontend", "node_modules", "playwright"))) {
    problems.push("playwright is not installed in packages/frontend — run `pnpm install`");
  }

  // 2. The personas.
  try {
    const personas = loadPersonas(chartersDir);
    for (const p of personas) {
      const bad = validatePersona(p);
      if (bad.length) problems.push(`persona "${p.id}" is misconfigured: ${bad.join("; ")}`);
    }
    const surfaces = [...new Set(personas.map((p) => p.surface))];
    notes.push(`${personas.length} personas over ${surfaces.length} surface(s): ${surfaces.join(", ")}`);
    notes.push(`${personas.reduce((n, p) => n + (p.briefs?.length ?? 0), 0)} briefs = that many explorer sessions`);
  } catch (err) {
    problems.push(`could not load personas from ${chartersDir}: ${err.message}`);
  }

  // 3. The SDK and the token. Imported lazily so this command still works without
  //    `scripts/agent/node_modules`, which is how `agent:tests` runs.
  try {
    await import("@anthropic-ai/claude-agent-sdk");
  } catch {
    problems.push("the Agent SDK is not installed — run `npm ci` in scripts/agent");
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    problems.push("neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set in THIS shell");
  }

  for (const n of notes) process.stdout.write(`hunt-ui: ${n}\n`);
  if (problems.length) {
    for (const p of problems) console.error(`hunt-ui: PROBLEM — ${p}`);
    process.exit(1);
  }
  process.stdout.write("hunt-ui: preflight ok\n");
}

async function cmdRun(args) {
  const repo = path.resolve(strArg(args, "repo") ?? path.join(HERE, "..", ".."));
  const outDir = path.resolve(strArg(args, "out") ?? path.join(repo, ".harness-reports", "hunt-ui"));
  const chartersDir = path.resolve(strArg(args, "charters-dir") ?? path.join(HERE, "charters-ui"));
  const runId = String(strArg(args, "run-id") ?? gitSha(repo).slice(0, 8));
  const headSha = gitSha(repo);
  // A SEPARATE ledger from the CLI hunter's, so the two cannot invalidate each
  // other's suppression: the key spaces are different and a collision would
  // silently hide a real defect.
  const ledgerFile = path.resolve(strArg(args, "ledger") ?? path.join(outDir, "seen.json"));
  const fault = strArg(args, "fault") ?? null;

  const all = loadPersonas(chartersDir);
  for (const p of all) {
    const bad = validatePersona(p);
    if (bad.length) fail(`persona "${p.id}" is misconfigured: ${bad.join("; ")}`);
  }
  const { selected: personas, excluded } = selectPersonas(all, { charter: args.charter, surface: args.surface });
  if (personas.length === 0) fail("no personas selected");
  for (const s of args.surface) {
    if (!UI_SURFACES.includes(s)) fail(`--surface ${JSON.stringify(s)} is not one of: ${UI_SURFACES.join(", ")}`);
  }

  const { seen, parseErrors, staleKeys } = parseSeenLedger(
    existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8") : "",
  );
  if (parseErrors > 0) {
    fail(`ledger ${ledgerFile} has ${parseErrors} unreadable entries — refusing to run on a ledger it cannot trust (fix or delete it)`);
  }
  if (staleKeys > 0) {
    console.error(
      `hunt-ui: WARNING — ${staleKeys} ledger entries were written under an older key version and cannot suppress anything (current v${LEDGER_KEY_VERSION}). Previously-seen defects may be re-reported this run.`,
    );
  }

  const context = loadContext(repo, args, personas);
  const sessionLog = [];
  const out = await runHunt({
    personas,
    excluded,
    repo,
    outDir,
    runId,
    headSha,
    seen,
    context,
    sessionLog,
    fault,
  });
  const { reported, dropped, skipped, stats, ledgerAdds } = out;

  mkdirSync(outDir, { recursive: true });
  const report = renderUiReport({
    runId,
    headSha,
    personas: personas.map((p) => p.id),
    reported,
    dropped,
    stats,
    skipped,
    fault,
  });
  writeFileSync(path.join(outDir, "report.md"), report);
  writeFileSync(
    path.join(outDir, "run.json"),
    redactSecrets(JSON.stringify({ runId, headSha, seededFault: fault, stats, reported, dropped, skipped }, null, 2), {
      extra: [context.cfg.apiKey].filter(Boolean),
    }) + "\n",
  );
  // Shape-compatible with the review panel's `review-execution.json`, so
  // metrics.mjs can sum tokens and cost over it the same way. Without this the run's
  // actual spend is unknowable, which is the one number that decides whether this
  // pipeline is worth running.
  writeFileSync(path.join(outDir, "hunt-ui-execution.json"), JSON.stringify(sessionLog));

  // `runHunt` has already emptied `ledgerAdds` for a seeded run — see there for why
  // the property lives in the tested function rather than in this branch. Skipping
  // the write too is belt and braces: rewriting the file with identical content is
  // harmless, but not touching it at all is the behaviour a reader expects from
  // "a seeded run does not write the ledger".
  if (out.seeded) {
    console.error(`hunt-ui: seeded run — ${ledgerFile} left untouched`);
  } else {
    writeFileSync(ledgerFile, serializeSeenLedger([...seen, ...ledgerAdds]));
  }
  process.stdout.write(
    `hunt-ui: ${stats.proposed} proposed → ${stats.unique} unique → ${stats.novel} novel → ` +
      `${stats.reproduced} reproduced → ${stats.reported} reported\n` +
      `         ${stats.refutedAfterReplay} reproduced but refuted by the panel, ` +
      `${stats.cappedUnverified} reproduced but never verified (cap), ` +
      `${stats.unjudgedVerifier} left unjudged (a verifier could not finish)\n` +
      (stats.overclaimed > 0
        ? `         ${stats.overclaimed} reported finding(s) the verifiers had to narrow\n`
        : "") +
      `hunt-ui: report written to ${path.join(outDir, "report.md")}\n`,
  );
}

/**
 * The pipeline itself: personas in, findings out.
 *
 * Separated from `cmdRun` so the whole funnel is exercisable with stubbed explorer,
 * verifier and runner — no browser, no SDK, no network, no spend. That matters more
 * than the usual testability argument: this glue is where the stages meet, and a
 * pipeline whose only integration test costs $15 a run is a pipeline nobody
 * integration-tests. `cmdRun` keeps everything that touches argv, the environment or
 * the filesystem.
 *
 * The three injected implementations default to the real ones, so the production
 * path is the tested path with different arguments rather than a parallel one.
 */
export async function runHunt({
  personas,
  excluded = [],
  repo,
  outDir,
  runId,
  headSha,
  seen = [],
  context,
  sessionLog = [],
  fault = null,
  exploreImpl = exploreUi,
  verifyImpl = verifyUi,
  runPlanImpl = runUiPlan,
  writeArtifact = (file, body) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  },
} = {}) {
  const reported = [];
  const dropped = [];
  const skipped = [...excluded];
  const stats = {
    actionsRun: 0,
    actionRefusals: 0,
    proposed: 0,
    unique: 0,
    novel: 0,
    reproduced: 0,
    refutedAfterReplay: 0,
    // A candidate no verifier could finish judging. Distinct from every other drop
    // because it is pure WASTE, twice over: the truncated session is paid for and
    // produces nothing, and the candidate is deliberately not ledgered so the next
    // run pays to assess it again.
    //
    // It had no stat until this was reconstructed from raw execution logs, which is
    // the whole reason it needs one — a budget you can only measure by log
    // archaeology is a budget nobody measures. Rising means the turn ceiling is too
    // low for the causes this surface asks verifiers to locate.
    unjudgedVerifier: 0,
    // Reported findings whose own title asserted more than the evidence. Not a gate
    // input -- a real defect described loosely is still real -- but tracked, because
    // every real defect found so far has been overclaimed and that is the thing
    // standing between this pipeline and a filable issue.
    overclaimed: 0,
    cappedUnverified: 0,
    reported: 0,
  };
  const ledgerAdds = [];

  if (fault) {
    console.error(`hunt-ui: FAULT INJECTION ACTIVE (?fault=${fault}) — this run is a positive control, not a hunt`);
  }

  for (const persona of personas) {
    const personaDir = path.join(outDir, persona.id);

    // Briefs run SERIALLY, unlike the CLI hunter's samples.
    //
    // Not an oversight and not a token decision: each concurrent brief is a Vite
    // plus a Chromium (~6.1s boot, real memory), so parallelism here buys wall-clock
    // at a cost the CLI hunter never paid for a subprocess. Serial also means one
    // port-0 session at a time, which removes a whole class of bind races.
    const briefResults = [];
    for (const brief of persona.briefs) {
      try {
        briefResults.push({ brief, ...(await exploreImpl(persona, brief, { repo, context, sessionLog, fault })) });
      } catch (err) {
        console.error(`hunt-ui: ${persona.id}/${brief.id} failed: ${err.message}`);
        skipped.push({ persona: `${persona.id}/${brief.id}`, kind: "session-failed", why: err.message });
        // Keep what it DID do. A failed brief still explored, and those actions are
        // the only evidence of why the run produced nothing — so they are persisted
        // alongside the successful briefs' journals, with `out: null` so the
        // candidate loop below contributes nothing from it.
        briefResults.push({
          brief,
          out: null,
          failed: err.message,
          journal: err.journal ?? [],
          actionCount: err.actionCount ?? 0,
          refusals: err.refusals ?? [],
        });
      }
    }

    // Persist the RAW proposals before any filtering, journal included. For a run
    // that reports nothing, WHAT THE MODEL DID is the only thing that explains why,
    // and it is not recoverable from the candidates it chose not to return.
    writeArtifact(
      path.join(personaDir, "explore-raw.json"),
      redactSecrets(
        JSON.stringify(
          briefResults.map((r) => ({
            brief: r.brief.id,
            // Present only on a brief that did NOT finish. First thing to read when
            // a run reports nothing: it separates "explored and found nothing" from
            // "never got to answer", which are the same zero in the funnel.
            ...(r.failed ? { failed: r.failed } : {}),
            summary: r.out?.summary,
            candidates: r.out?.candidates,
            journal: r.journal,
            actionCount: r.actionCount,
            refusals: r.refusals,
          })),
          null,
          2,
        ),
        { extra: [context.cfg.apiKey].filter(Boolean) },
      ) + "\n",
    );

    // Resolve journal references into replayable action plans, then coerce. A
    // candidate citing an action that did not happen is DROPPED, not repaired: it is
    // the signature of a model describing an interaction it never performed, which
    // is exactly what citing the journal exists to make impossible.
    const proposals = [];
    for (const { brief, out, journal, actionCount, refusals } of briefResults) {
      stats.actionsRun += actionCount ?? journal.length;
      stats.actionRefusals += refusals?.length ?? 0;
      const raw = Array.isArray(out?.candidates) ? out.candidates : [];
      stats.proposed += raw.length;
      const resolved = [];
      for (const c of raw) {
        const refs = resolveActionRefs(c, journal);
        if (!refs) {
          dropped.push({
            title: c?.title,
            why: `cited actions that did not happen (actionRefs ${JSON.stringify(c?.actionRefs)}, failingRef ${JSON.stringify(c?.failingRef)}, journal has ${journal.length})`,
          });
          continue;
        }
        resolved.push({ ...c, ...refs, __journal: journal, __brief: brief.id });
      }
      const { kept, dropped: bad } = coerceCandidates(resolved, { evidenceOf: uiActionEvidence });
      for (const b of bad) dropped.push({ title: b.candidate?.title, why: `malformed: ${b.why}` });
      proposals.push(...kept);
    }

    const keyOf = (c) => uiDefectKey(c, c.__journal, { personaId: persona.id });
    for (const c of proposals) {
      if (keyOf(c) === "") {
        dropped.push({ title: c.title, why: "no identifiable defect — neither a prediction nor an oracle at the failing action" });
      }
    }
    const unique = dedupeCandidates(proposals, keyOf);
    stats.unique += unique.length;

    const maxVerified = Number.isInteger(persona.maxVerified) ? persona.maxVerified : DEFAULT_MAX_VERIFIED;
    let verifiedThisPersona = 0;
    const changedSince = makeChangedSince(repo, persona.codeScope);

    for (const cand of unique) {
      const dk = keyOf(cand);
      if (!isNovel(dk, seen, { changedSince })) {
        dropped.push({ title: cand.title, why: "already seen in a previous run (ledger)" });
        continue;
      }
      stats.novel++;

      // Run once to get the claim's own observations, then replay. Both go through
      // `runUiPlan`, i.e. a fresh process and a fresh browser context per attempt —
      // NOT the live session the explorer used. Exploration is a session; replay is
      // a clean room, and sharing one mechanism is how state-dependent phantom
      // repros get through.
      // The plan is the journal PREFIX, not the cited subset — see `replayPlanFor`
      // for the false-reproduction bug that made this necessary.
      const plan = replayPlanFor(cand, cand.__journal);
      if (!plan) {
        dropped.push({ title: cand.title, why: `failingRef ${JSON.stringify(cand.failingRef)} does not resolve into the journal` });
        continue;
      }
      let firstObservations;
      let rep;
      try {
        firstObservations = runPlanImpl({ actions: plan.actions }, { repoRoot: repo, attempts: 1, fault })[0];
        rep = replayUiCandidate(plan.actions, firstObservations, { repo, attempts: 3, fault, runPlan: runPlanImpl });
      } catch (err) {
        dropped.push({ title: cand.title, why: `replay could not run: ${err.message}` });
        continue;
      }

      // Fail closed: a run in which every action errored is not a reproduction, no
      // matter how consistently the attempts agree with each other.
      if (!replayDidRun(firstObservations)) {
        dropped.push({
          title: cand.title,
          why: "replay never exercised the app — every action failed, so there is nothing to reproduce",
        });
        continue;
      }

      const record = {
        personaId: persona.id,
        briefId: cand.__brief,
        surface: persona.surface,
        defectKey: dk,
        runId,
        headSha,
        claimed: {
          oracle: cand.oracle,
          severity: cand.severity,
          title: cand.title,
          expected: cand.expected,
          observed: cand.observed,
        },
        actions: plan.actions,
        failingIndex: plan.failingIndex,
        // The verdict comes from the JOURNAL, not from the observation.
        //
        // The runner deliberately does not compare — it reports `actual` and stops,
        // leaving the verdict to `hunt-ui-expect.mjs` in pure, testable code. So an
        // observation has no `verdict` field at all, and reading one off it yielded
        // "unknown" on every finding this pipeline could ever report. The journal
        // entry is where `assessExpectation` wrote it, during exploration, which is
        // also the verdict the candidate is actually claiming.
        prediction: plan.actions[plan.failingIndex]?.expect
          ? {
              ...plan.actions[plan.failingIndex].expect,
              ...pickPredictionVerdict(cand.__journal?.[cand.failingRef]?.prediction),
            }
          : null,
        oracles: oraclesFired(firstObservations),
        replay: rep,
        replayEvidence: summarizeUiObservations(firstObservations, plan.actions),
        secrets: [context.cfg.apiKey].filter(Boolean),
      };

      const reproduced = rep.status === "reproduced" && rep.deterministic;
      if (reproduced) stats.reproduced++;
      if (!reproduced) {
        dropped.push({ title: cand.title, why: `replay: ${rep.status}`, reproduced: false });
        ledgerAdds.push({ fp: dk, keyVersion: LEDGER_KEY_VERSION, charterId: persona.id, verdict: "dropped", dropReason: rep.status, runId, sha: headSha });
        continue;
      }

      // The cost bound that replaces agreement. NOT written to the ledger, for the
      // same reason an unjudged verdict is not: a candidate no verifier ever
      // assessed has to stay eligible next run, or the cap would permanently hide
      // whatever it truncated.
      if (verifiedThisPersona >= maxVerified) {
        dropped.push({
          title: cand.title,
          why: `verification cap reached (${maxVerified} per persona) — NOT recorded, will be retried next run`,
          capped: true,
          reproduced: true,
          claimed: record.claimed,
          secrets: record.secrets,
        });
        stats.cappedUnverified++;
        continue;
      }
      verifiedThisPersona++;

      const verdicts = await Promise.all(
        Array.from({ length: Math.max(2, Number(persona.verifiers) || 2) }, async (_unused, i) => {
          try {
            return await verifyImpl(record, persona, { repo, context, sessionLog, index: i });
          } catch (err) {
            console.error(`hunt-ui: verifier ${i} errored on "${cand.title}": ${err.message}`);
            return null; // a null verdict DROPS here — see hunt-gate.mjs
          }
        }),
      );
      const unjudged = verdicts.some((v) => !v || typeof v !== "object");

      if (isFilingVerdict(record, verdicts, persona, UI_GATE_OPTIONS)) {
        // The plan file the report's repro command points at. Written here rather
        // than in the renderer so the report can never name a file that does not
        // exist.
        const planPath = path.join(personaDir, `repro-${reported.length + 1}.json`);
        writeArtifact(planPath, JSON.stringify({ actions: plan.actions }, null, 2) + "\n");
        record.planPath = path.relative(repo, planPath);
        record.groundedIn = uiCitationsOf(record.claimed, verdicts);
        record.scopedTitle = uiScopedTitle(record.claimed, verdicts);
        record.overclaimed = uiOverclaimed(verdicts);
        if (record.overclaimed) stats.overclaimed++;
        reported.push(record);
        stats.reported++;
        ledgerAdds.push({ fp: dk, keyVersion: LEDGER_KEY_VERSION, charterId: persona.id, verdict: "reported", runId, sha: headSha });
      } else {
        const why = dropReason(record, verdicts, persona, UI_GATE_OPTIONS);
        dropped.push({ title: cand.title, why: unjudged ? `${why} — NOT recorded, will be retried next run` : why, secrets: record.secrets });
        // THE precision signal now that agreement is gone. An `unjudged` drop is
        // excluded: a verifier that errored produced no opinion, and counting
        // infrastructure failure as a refutation would make the signal read worse
        // the flakier the API got.
        if (unjudged) stats.unjudgedVerifier++;
        if (!unjudged) {
          stats.refutedAfterReplay++;
          ledgerAdds.push({ fp: dk, keyVersion: LEDGER_KEY_VERSION, charterId: persona.id, verdict: "dropped", dropReason: why, runId, sha: headSha });
        }
      }
    }
  }

  // A SEEDED RUN MUST NOT TEACH THE LEDGER ANYTHING.
  //
  // Its findings are fabricated by construction — that is the point of a positive
  // control — and the ledger is keyed on the DEFECT, not on the run. Recording them
  // would file a manufactured defect as "reported", and the next REAL run keying the
  // same reader/op/ground would be suppressed as already-seen. A control that
  // silently blinds the instrument it validates is worse than no control.
  //
  // Enforced HERE rather than at the `writeFileSync` in `cmdRun`, because this is the
  // function tests can reach. The stated safety property of the whole positive-control
  // design cannot live in an unexported branch nothing exercises — that is how it
  // becomes a comment describing behaviour the code does not have.
  if (fault && ledgerAdds.length > 0) {
    console.error(
      `hunt-ui: seeded run (?fault=${fault}) — discarding ${ledgerAdds.length} ledger ` +
        "entr" + (ledgerAdds.length === 1 ? "y" : "ies") +
        " so fabricated findings cannot suppress a real one later",
    );
    ledgerAdds.length = 0;
  }

  return { reported, dropped, skipped, stats, ledgerAdds, seeded: fault ?? null };
}

/**
 * Replay a saved action plan. The command a maintainer runs from a report.
 *
 * No SDK and no model — this is the trusted runner alone, which is the point: a
 * repro nobody can run without an API key is not a repro.
 */
function cmdReplay(args) {
  const repo = path.resolve(strArg(args, "repo") ?? path.join(HERE, "..", ".."));
  const planFile = strArg(args, "plan");
  if (!planFile) fail("replay needs --plan <file.json>");
  const attempts = Number(strArg(args, "attempts") ?? 1);
  const plan = JSON.parse(readFileSync(path.resolve(planFile), "utf8"));
  const results = runUiPlan(plan, { repoRoot: repo, attempts: Number.isInteger(attempts) ? attempts : 1, fault: strArg(args, "fault") ?? null });
  for (const [i, observations] of results.entries()) {
    process.stdout.write(`--- attempt ${i} (key ${uiPlanKey(observations)}) ---\n`);
    process.stdout.write(summarizeUiObservations(observations, plan.actions) + "\n");
  }
}

function cmdReport(args) {
  const outDir = path.resolve(strArg(args, "out") ?? ".harness-reports/hunt-ui");
  const f = path.join(outDir, "report.md");
  if (!existsSync(f)) fail(`no report at ${f} — run \`node hunt-ui.mjs run\` first`);
  process.stdout.write(readFileSync(f, "utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv, 3);
  if (cmd === "preflight") cmdPreflight(args).catch((e) => fail(e.message));
  else if (cmd === "run") cmdRun(args).catch((e) => fail(e.message));
  else if (cmd === "replay") {
    try {
      cmdReplay(args);
    } catch (e) {
      fail(e.message);
    }
  } else if (cmd === "report") cmdReport(args);
  else {
    console.error("usage: hunt-ui.mjs <preflight|run|replay|report> [--charter id]... [--surface doc|sheet]... [--out dir] [--repo dir]");
    process.exit(2);
  }
}
