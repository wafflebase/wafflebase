/**
 * The drafting call: a batch of one-line reports in, issue text and a proposed
 * PR grouping out.
 *
 * **TOOL-FREE BY CONSTRUCTION.** There is no `tools` parameter on this request,
 * so there is nothing to widen and nothing to audit — the session cannot read a
 * file, cannot reach the repository, cannot open a pull request. That is what
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
import type Anthropic from "@anthropic-ai/sdk";

/** The model. Opus 5 because a bad draft costs the reporter's trust, not just a retry. */
const MODEL = "claude-opus-5";

/** Non-streaming, so this stays under the SDK's HTTP timeout. */
const MAX_TOKENS = 16_000;

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

/** Just the part of the SDK this module uses, so a test needs no network. */
export type DraftClient = {
  messages: {
    create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  };
};

type Sdk = typeof import("@anthropic-ai/sdk");

let cached: DraftClient | undefined;
let sdk: Sdk | undefined;

/**
 * The client, built once, from a lazily loaded SDK.
 *
 * `@anthropic-ai/sdk` IS AN OPTIONAL PEER DEPENDENCY, so a consumer that
 * installs this package without it is a supported state, not a broken one: the
 * import rejects, the catch below turns that into `not-configured`, and the
 * panel degrades to the reporter's own sentences with one PR per item. The
 * import is also lazy because `vite.config.ts` reaches this module — a static
 * one loaded the SDK in every process that read a Vite config, tests included.
 *
 * An unset `ANTHROPIC_API_KEY` does NOT mean there is no credential — the SDK
 * also resolves `ANTHROPIC_AUTH_TOKEN` and an `ant auth login` profile — so
 * construction is attempted and the AUTHENTICATION ERROR is what reports
 * "not configured". Guessing from environment variables would tell a developer
 * who is logged in that they are not.
 */
async function defaultClient(): Promise<DraftClient> {
  sdk ??= await import("@anthropic-ai/sdk");
  cached ??= new sdk.default();
  return cached;
}

/**
 * Whether this failure means "no usable credential".
 *
 * Checked against the loaded SDK's class where it is available, and against the
 * HTTP status where it is not — an injected client in a test never loads the SDK,
 * and a 401 means the same thing either way.
 */
function isAuthFailure(err: unknown): boolean {
  if (sdk && err instanceof sdk.AuthenticationError) return true;
  return typeof err === "object" && err !== null && (err as { status?: unknown }).status === 401;
}

/**
 * Ask for drafts. Returns a typed failure rather than throwing: drafting being
 * unavailable is a state the panel renders (the reporter's own sentences, one PR
 * per item), not an exception for the dev server to log and swallow.
 */
export async function draftBundle(
  bundle: DraftBundle,
  options: { client?: DraftClient; schema: JsonSchema },
): Promise<DraftOutcome> {
  if (bundle.items.length === 0) {
    return { ok: false, reason: "empty", detail: "the bundle has no items" };
  }

  let client: DraftClient;
  try {
    client = options.client ?? (await defaultClient());
  } catch (err) {
    return {
      ok: false,
      reason: "not-configured",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: renderPrompt(bundle) }],
      // Adaptive thinking: deciding how a batch splits into homogeneous PRs is
      // the part worth thinking about.
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: options.schema } },
      // NO `tools` KEY. See the file docblock — this absence is the security
      // argument, not a default that could be overridden later.
    });

    if (response.stop_reason === "refusal") {
      return {
        ok: false,
        reason: "failed",
        detail: `the model declined (${response.stop_details?.category ?? "unspecified"})`,
      };
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (text.trim().length === 0) {
      return { ok: false, reason: "empty", detail: "the model returned no text" };
    }
    try {
      return { ok: true, result: JSON.parse(text) as Record<string, unknown> };
    } catch {
      // The schema is enforced server-side, so this is a surprise worth
      // reporting rather than repairing — and the client validates the shape
      // again anyway before the panel renders any of it.
      return { ok: false, reason: "failed", detail: "the response was not JSON" };
    }
  } catch (err) {
    if (isAuthFailure(err)) {
      return {
        ok: false,
        reason: "not-configured",
        detail:
          "no usable model credential in the dev-server environment " +
          "(ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or `ant auth login`)",
      };
    }
    return {
      ok: false,
      reason: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export const __testables = { SYSTEM_PROMPT, MODEL, MAX_TOKENS };
