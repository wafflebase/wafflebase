/**
 * The drafting call: a batch of one-line reports in, issue text and a proposed
 * PR grouping out.
 *
 * **NO TOOLS, AND NO PROJECT CONFIG.** `allowedTools: []` with
 * `settingSources: []` — the session cannot read a file, cannot reach the
 * repository, cannot open a pull request, and inherits none of this project's
 * skills, hooks or MCP servers that would hand it any of those back. That is what
 * makes it acceptable for the credential to live with the app rather than with
 * the repository: the worst case is a wasted token budget and a draft the
 * reporter rejects, and a prompt injection has no privileged action to reach.
 * The pipeline credential — the one that can create commits — stays on the
 * repository side and is never held here (`docs/design/debug-report.md`,
 * *Credentials*).
 *
 * The key is read in the DEV-SERVER PROCESS and never reaches the browser. That
 * is the same rule `design-editor-local-plugin.md` states for the design editor,
 * and it is the reason drafting is an endpoint at all rather than a client call.
 *
 * Captures are DESCRIBED, NOT SENT. The model is told an image exists and what
 * was aimed at; the pixels stay local. A screenshot can contain another person's
 * document, and the design's mitigation for that is the reporter's own consent
 * gate plus never shipping the image further than it has to go.
 */

// TYPE-ONLY, so nothing is loaded at module scope. The SDK costs ~500 ms to
// import, and this module is reachable from `vite.config.ts` — which every
// vitest worker loads — so a static import taxed the entire test suite for a
// dependency only a drafting request needs. Measured: it pushed a 5-second
// boundary test over. `scripts/agent/ask.mjs` defers its SDK for the same
// reason.

/** The model. Opus 5 because a bad draft costs the reporter's trust, not just a retry. */
const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = [
  "You turn a person's one-line observation about a running web app into the issue text a maintainer can act on.",
  "",
  "You have no tools and no repository access. Do not guess file paths, function names or line numbers — the pipeline locates the code afterwards, and a wrong location is worse than none.",
  "",
  "The reporter's sentence is the ground truth. Sharpen it and add the context a maintainer needs; never replace it with a different claim. Where a report is too vague to act on, say so in the body instead of inventing detail.",
  "",
  "Group items into PRs by HOMOGENEITY, not by count: two spacing fixes pass or fail review together, a spacing fix and a behaviour fix do not.",
  "- spacing / color / token / copy / a11y / affordance: group with their own kind.",
  "- layout (structural markup change): leave on its own — its blast radius differs per file.",
  "- logic (behaviour or bug fix): never group, so one blocked review cannot hold up the rest.",
  "At most 8 items per group. Every item appears in exactly one group, and every group is a single kind.",
].join("\n");

/**
 * THE CORE'S MODEL, type-imported.
 *
 * This module used to mirror `DebugItem`, `Target` and `Environment` here as
 * all-optional shapes, on the reasoning that the endpoint receives untrusted
 * JSON. It no longer does: `report-endpoint.ts` runs `parseDraftRequest` before
 * anything reaches this file, so what arrives is the real model — and a second
 * copy of it could only drift away from the one the parser enforces.
 *
 * `.ts` on the specifier because `vite.config.ts` reaches this module, and the
 * extensionless form does not resolve there. The import is type-only, so
 * nothing is loaded at runtime either way.
 */
import type { DebugItem, DraftRequest } from "../types.ts";

/** Kept as the module's own name for its input, so callers read one word. */
export type DraftBundle = DraftRequest;

/**
 * The most characters of one note the model is shown.
 *
 * TRUNCATED HERE, NOT REJECTED UPSTREAM. `parseDraftRequest` bounds how MANY
 * items a call carries; this bounds how much prose each one spends. The full
 * note still travels in the bundle — only the prompt is trimmed, and the
 * marker tells the model it was.
 */
const MAX_NOTE_CHARS = 2_000;

function forPrompt(note: string): string {
  return note.length <= MAX_NOTE_CHARS
    ? note
    : `${note.slice(0, MAX_NOTE_CHARS)}… (truncated)`;
}

/** How one item is described to the model. */
export function renderItem(item: DebugItem): string {
  const target = item.target;
  const where =
    target.kind === "dom"
      ? `a DOM element: <${target.tag}>${
          target.testId ? ` [data-testid="${target.testId}"]` : ""
        } selector \`${target.selector}\`${
          target.text ? `, visible text ${JSON.stringify(target.text)}` : ""
        }`
      : target.kind === "canvas"
        ? `the ${target.surface} canvas${target.address ? ` at ${target.address}` : ""}`
        : `a ${Math.round(target.rect?.w ?? 0)}×${Math.round(
            target.rect?.h ?? 0,
          )} region${
            target.elements && target.elements.length > 0
              ? ` containing ${target.elements
                  .slice(0, 8)
                  .map((el) => `<${el.tag}>${el.text ? ` ${JSON.stringify(el.text)}` : ""}`)
                  .join(", ")}`
              : ""
          }`;
  return [
    `- itemId: ${item.id}`,
    `  reporter said: ${JSON.stringify(forPrompt(item.note))}`,
    `  aimed at: ${where}`,
    `  screenshot exists: ${item.capture ? "yes" : "no"}`,
    `  reporter's disposition: ${item.disposition}`,
  ].join("\n");
}

export function renderPrompt(bundle: DraftBundle): string {
  const env = bundle.env;
  return [
    "A person collected these reports while using the app. Write the issue text for each, and propose how they split into PRs.",
    "",
    "Environment:",
    `- route: ${env.route ?? "unknown"}`,
    `- build: ${env.buildSha ?? "UNKNOWN — say so in any body where the code version matters"}`,
    `- viewport: ${env.viewport?.w ?? "?"}×${env.viewport?.h ?? "?"} at dpr ${
      env.dpr ?? "?"
    }, theme ${env.theme ?? "?"}`,
    env.documentType ? `- document type: ${env.documentType}` : "",
    "",
    "Reports:",
    bundle.items.map(renderItem).join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The schema the answer is held to.
 *
 * PASSED IN, not imported. `vite.config.ts` is evaluated by Node, which cannot
 * resolve the extensionless relative imports inside a source-exported TypeScript
 * package — so the plugin loads `DRAFT_SCHEMA` through Vite's own module runner
 * and hands it here. One schema, no second copy to drift.
 */
export type JsonSchema = Record<string, unknown>;

export type DraftFailure = {
  /** `not-configured` is a normal state the panel degrades from, not an error. */
  reason: "not-configured" | "failed" | "empty";
  detail: string;
};

export type DraftOutcome =
  | { ok: true; result: Record<string, unknown> }
  | ({ ok: false } & DraftFailure);

/**
 * The credential pool, by environment-variable name.
 *
 * `CLAUDE_CODE_OAUTH_TOKEN` plus `_1` … `_8` — the shape wafflebase's own agent
 * scripts already use, so one secret configures every model call in the
 * repository. It is read here rather than imported from `scripts/agent/` because
 * that directory is a separate npm island outside this workspace, and because
 * "which variables hold a credential" is not repository-specific once the base
 * name is a constant.
 *
 * A pool exists for one reason: a drained credential answers 429, and drafting
 * runs while somebody waits at a preview panel. Without failover that 429 is the
 * end of the batch.
 */
export const TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
const POOL_SLOTS = 8;

export type Slot = { name: string; token: string };

/** Named, de-duplicated, empties dropped. The NAME travels so a diagnostic can
 *  say which secret is bad without printing it. */
export function readPoolSlots(env: Record<string, string | undefined>): Slot[] {
  const names = [TOKEN_ENV, ...Array.from({ length: POOL_SLOTS }, (_, i) => `${TOKEN_ENV}_${i + 1}`)];
  const seen = new Set<string>();
  const slots: Slot[] = [];
  for (const name of names) {
    const token = env[name]?.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    slots.push({ name, token });
  }
  return slots;
}

/**
 * Whether this failure means "this credential is out", as opposed to "the request
 * was wrong". Only the first is worth another slot — a malformed schema fails
 * identically on all nine.
 */
export function isExhausted(text: string): boolean {
  return /\b(?:session|usage|weekly|daily|monthly)\s+limit\b|\b429\b|rate.?limit|quota/i.test(text);
}

/** Whether this failure means "no usable credential at all". */
export function isNotConfigured(text: string): boolean {
  return /\b401\b|unauthoriz|authentication|invalid.{0,12}(?:api.?key|token)|could not resolve/i.test(
    text,
  );
}

/** The parts of the Agent SDK this module uses, so a test needs no network. */
export type AgentQuery = (input: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<{
  type: string;
  subtype?: string;
  result?: string;
  structured_output?: Record<string, unknown>;
}>;

/**
 * One session's options — exported so the empty tool grant is a tested claim
 * rather than a comment.
 *
 * `allowedTools: []` is the whole security argument, and `settingSources: []` is
 * what keeps it true: without it the session would inherit this project's skills,
 * hooks and MCP servers, and the grant above would describe nothing.
 *
 * `Options.env` REPLACES the subprocess environment rather than merging it, so
 * the spread is load-bearing — without it the CLI loses `PATH` and never starts.
 */
export function sessionOptions(input: {
  schema: JsonSchema;
  token?: string;
  env: Record<string, string | undefined>;
}): Record<string, unknown> {
  return {
    model: MODEL,
    systemPrompt: SYSTEM_PROMPT,
    allowedTools: [],
    permissionMode: "dontAsk",
    settingSources: [],
    maxTurns: 1,
    outputFormat: { type: "json_schema", schema: input.schema },
    ...(input.token ? { env: { ...input.env, [TOKEN_ENV]: input.token } } : {}),
  };
}

type Sdk = { query: AgentQuery };
let sdk: Sdk | undefined;

/**
 * Ask for drafts, trying each pooled credential until one answers.
 *
 * Returns a typed failure rather than throwing: drafting being unavailable is a
 * state the panel renders (the reporter's own sentences, one PR per item), not an
 * exception for the dev server to log and swallow.
 */
export async function draftBundle(
  bundle: DraftBundle,
  options: { query?: AgentQuery; schema: JsonSchema; env?: Record<string, string | undefined> },
): Promise<DraftOutcome> {
  if (bundle.items.length === 0) {
    return { ok: false, reason: "empty", detail: "the bundle has no items" };
  }
  const env = options.env ?? process.env;

  let query = options.query;
  if (!query) {
    try {
      sdk ??= (await import("@anthropic-ai/claude-agent-sdk")) as unknown as Sdk;
      query = sdk.query;
    } catch (err) {
      // An OPTIONAL peer dependency, so this is a supported state rather than a
      // broken one — and the lazy import is also why `vite.config.ts` reaching
      // this module does not load the SDK in every process that reads a config.
      return {
        ok: false,
        reason: "not-configured",
        detail: `the Agent SDK is not installed (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  }

  const slots = readPoolSlots(env);
  // An empty pool tries once with the ambient environment, so a developer who
  // authenticated some other way gets the same answer they always did.
  const attempts: Array<{ token?: string }> = slots.length ? slots : [{}];

  let last: DraftOutcome = { ok: false, reason: "failed", detail: "no attempt was made" };
  for (const slot of attempts) {
    const outcome = await askOnce(query, bundle, { ...options, env }, slot.token);
    if (outcome.ok) return outcome;
    last = outcome;
    // Only a drained credential is worth the next slot.
    if (!isExhausted(outcome.detail)) return outcome;
  }
  // Every slot was drained. Reported as `failed`, not `not-configured`: the
  // panel's copy for the latter tells the reporter to set a credential they
  // already have, and the problem is the window rather than the secret.
  return { ...last, ok: false, reason: "failed" };
}

async function askOnce(
  query: AgentQuery,
  bundle: DraftBundle,
  options: { schema: JsonSchema; env: Record<string, string | undefined> },
  token?: string,
): Promise<DraftOutcome> {
  let structured: Record<string, unknown> | undefined;
  let subtype = "(no result message)";
  try {
    for await (const message of query({
      prompt: renderPrompt(bundle),
      options: sessionOptions({ schema: options.schema, token, env: options.env }),
    })) {
      if (message.type !== "result") continue;
      subtype = message.subtype ?? subtype;
      if (message.subtype === "success") structured = message.structured_output;
      else if (message.result) subtype = `${subtype}: ${message.result}`;
    }
  } catch (err) {
    return classify(err instanceof Error ? err.message : String(err));
  }
  if (structured) return { ok: true, result: structured };
  // A success with no structured output is a schema the model could not satisfy.
  // `parseDraftResult` would refuse it anyway; saying so here is clearer.
  return classify(subtype);
}

function classify(detail: string): DraftOutcome {
  if (isNotConfigured(detail) && !isExhausted(detail)) {
    return {
      ok: false,
      reason: "not-configured",
      detail: `no usable model credential in the dev-server environment (${TOKEN_ENV})`,
    };
  }
  return { ok: false, reason: "failed", detail };
}

export const __testables = { SYSTEM_PROMPT, MODEL };
