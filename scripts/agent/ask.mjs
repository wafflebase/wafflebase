// Shared Claude Agent SDK wrapper for the agent pipeline — ONE place that opens
// a model session, so the read-only tool invariant is stated once and can be
// tested, rather than living as a hardcoded array inside a single caller.
//
// Extracted from review-panel.mjs unchanged except for one thing: `allowedTools`
// is now a REQUIRED, VALIDATED parameter instead of a hardcoded
// `["Read","Grep","Glob"]`. That matters because a second consumer is arriving
// (the issue hunter), and the tempting way to share this function is to widen
// the tool list for everyone. `assertAllowedTools` makes that impossible: the
// deny-list below is refused no matter who asks, so a caller that needs to
// execute something must do it in its own trusted code rather than by handing
// the capability to a model.
//
// SDK: @anthropic-ai/claude-agent-sdk (imported lazily so the pure helpers here
// are unit-testable without the dependency installed). Verified against
// @anthropic-ai/claude-agent-sdk 0.3.217 (pinned + lockfiled): outputFormat:
// {type:'json_schema'}, result.structured_output, permissionMode 'dontAsk',
// settingSources:[], maxTurns all exist; the SDK reads CLAUDE_CODE_OAUTH_TOKEN.

/**
 * Tools that may NEVER be granted to a subagent spawned through this wrapper,
 * whatever the caller passes.
 *
 * The list is a capability boundary, not a style preference. Every agent that
 * runs through here reads UNTRUSTED input — a branch diff, an issue body, a
 * repository checkout — so any of these would turn injected text into an action:
 * `Bash` executes, the three write tools mutate the checkout, the two network
 * tools exfiltrate, and `Task` spawns a fresh agent that would not inherit this
 * check. Read-only inspection (Read/Grep/Glob) is the whole intended surface.
 *
 * A consumer that genuinely needs to run something does it in its own trusted
 * code, from data the model returned — see `hunt-probe.mjs`, which executes
 * model-proposed argv arrays itself rather than letting the model hold a shell.
 */
export const FORBIDDEN_TOOLS = Object.freeze([
  "Bash",
  "BashOutput",
  "KillShell",
  "Write",
  "Edit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
]);

const FORBIDDEN_SET = new Set(FORBIDDEN_TOOLS);

/**
 * Validate a caller's `allowedTools`, throwing on anything unsafe or malformed.
 *
 * Required rather than defaulted ON PURPOSE. A default would let a new caller
 * inherit read-only access silently and then "just add Bash" at the call site
 * with no signal that it had crossed a boundary; requiring the argument makes
 * every grant an explicit, greppable decision. Returns a frozen copy so the
 * array cannot be mutated after validation.
 *
 * Fails closed on every ambiguity: a non-array, an empty array, a non-string
 * entry, or any entry on the deny-list. An empty array is rejected because the
 * SDK would treat it as "no tools" and the agent would silently be unable to
 * read anything — a session that burns quota and returns nothing useful.
 * (`auth-smoke.mjs` legitimately wants `allowedTools: []` for a pure auth probe,
 * which is why it calls the SDK directly and does not come through here.)
 */
export function assertAllowedTools(allowedTools) {
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    throw new Error(
      "askStructured: `allowedTools` is required and must be a non-empty array " +
        `(got: ${JSON.stringify(allowedTools)})`,
    );
  }
  for (const t of allowedTools) {
    if (typeof t !== "string" || t.trim() === "") {
      throw new Error(`askStructured: \`allowedTools\` entries must be non-empty strings (got: ${JSON.stringify(t)})`);
    }
    if (FORBIDDEN_SET.has(t)) {
      throw new Error(
        `askStructured: tool "${t}" is never permitted — agents here read untrusted ` +
          `input, so granting it would turn injected text into an action. ` +
          `Forbidden: ${FORBIDDEN_TOOLS.join(", ")}.`,
      );
    }
  }
  return Object.freeze([...allowedTools]);
}

/**
 * Classify an SDK `result` message. The SDK reports API/quota failures as
 * subtype "success" with `is_error: true` (+ `api_error_status`, and a human
 * `result` string like "You've hit your session limit · resets 3:30pm (UTC)"),
 * so "subtype === success" alone is NOT proof the model ran. Returns one of:
 *   { ok:true, output }                                  — real structured verdict
 *   { ok:false, kind:'api-error', status, detail, retryable } — API/quota failure
 *   { ok:false, kind:'no-output', detail, retryable:false }   — ran but no verdict
 * A session/usage-limit resets on a fixed schedule (often hours out), so it is
 * NOT retryable in-run; any other API error (plain 429/529/overload/network) is.
 */
export function classifyResult(message) {
  const m = message || {};
  if (m.subtype === "success" && m.structured_output) {
    return { ok: true, output: m.structured_output };
  }
  if (m.is_error || m.api_error_status || m.terminal_reason === "api_error") {
    const detail = typeof m.result === "string" && m.result ? m.result : "";
    const isQuota = /session limit|usage limit|quota|rate limit|resets?\b/i.test(detail);
    return { ok: false, kind: "api-error", status: m.api_error_status ?? null, detail, retryable: !isQuota };
  }
  return { ok: false, kind: "no-output", status: null, detail: `subtype=${m.subtype}`, retryable: false };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying ONLY on errors flagged `err.retryable === true` (see
 * classifyResult), with exponential backoff + jitter. A non-retryable error
 * (quota/session-limit, or a genuine no-output) throws immediately — no wasted
 * retries on a limit that can't clear in-run. `sleep` is injectable for tests.
 */
export async function withRetry(fn, { retries = 2, baseMs = 2000, sleep = defaultSleep, jitter = () => 0 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!err || err.retryable !== true || attempt === retries) throw err;
      await sleep(baseMs * 2 ** attempt + jitter());
    }
  }
  throw last;
}

/**
 * Open one structured-output SDK session and return the validated object.
 *
 * `allowedTools` is required and passes through `assertAllowedTools`. `label`
 * only shapes the thrown error's wording ("<label> query API error …") so a
 * caller's logs read naturally; it has no behavioral effect.
 *
 * Throws on every non-success path, with `kind`/`status`/`detail`/`retryable`
 * copied onto the error from `classifyResult` so `withRetry` can decide whether
 * another attempt could possibly help.
 */
export async function askStructured({
  systemPrompt,
  prompt,
  model,
  repo,
  schema,
  sessionLog,
  maxTurns,
  allowedTools,
  label = "agent",
}) {
  const tools = assertAllowedTools(allowedTools);
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  for await (const message of query({
    prompt,
    options: {
      systemPrompt,
      model,
      cwd: repo,
      // Only set when the caller asks for a ceiling; omitting it takes the SDK
      // default. `maxTurns` exists in the pinned SDK (0.3.217), on the same
      // Options type as allowedTools/outputFormat/permissionMode.
      ...(Number.isFinite(maxTurns) ? { maxTurns } : {}),
      allowedTools: tools, // validated read-only set; see FORBIDDEN_TOOLS
      permissionMode: "dontAsk", // deny anything not allow-listed, no prompts
      // SECURITY: do NOT load project settings/hooks/agents from cwd — cwd may be
      // an untrusted branch checkout, and a branch-supplied .claude hook would be
      // a shell command the SDK could execute. `settingSources: []` disables that
      // (the review workflow also strips the branch's `.claude/` as
      // belt-and-suspenders).
      // settingSources exists in the pinned SDK (0.3.217); [] loads no project config.
      settingSources: [],
      outputFormat: { type: "json_schema", schema },
    },
  })) {
    if (message.type === "result") {
      // Record cost/turns/tokens regardless of success — the call still burned
      // compute even when it didn't produce usable structured output. This is
      // the ONLY place an SDK call's result is observable at all; callers
      // discard everything else, so record before the throw below.
      if (sessionLog) sessionLog.push(message);
      const c = classifyResult(message);
      if (c.ok) return c.output;
      const err = new Error(
        c.kind === "api-error"
          ? `${label} query API error${c.status ? ` (${c.status})` : ""}: ${c.detail || "unknown"}`
          : `structured output not produced (${c.detail})`,
      );
      err.kind = c.kind;
      err.status = c.status;
      err.detail = c.detail;
      err.retryable = c.retryable;
      throw err;
    }
  }
  throw new Error("query ended without a result message");
}
