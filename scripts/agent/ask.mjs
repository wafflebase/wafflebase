// Shared Claude Agent SDK wrapper for the agent pipeline — ONE place that opens
// a model session, so the read-only tool invariant is stated once and can be
// tested, rather than living as a hardcoded array inside a single caller.
//
// Extracted from review-panel.mjs, which called the SDK inline. Two changes come
// with the move, both about making the read-only claim real rather than assumed:
//
//   1. The tool grant is a REQUIRED, VALIDATED parameter checked against the
//      `PERMITTED_TOOLS` allow-list below, instead of a hardcoded array. Sharing
//      a wrapper invites widening it for everyone; an allow-list makes that a
//      rejected call rather than a one-word edit.
//   2. The session now sets `tools` as well as `allowedTools`. Only the former
//      restricts what exists; the latter just pre-approves. See the call site.
//
// A consumer that genuinely needs to execute something must do it in its own
// trusted code, acting on data the model returned — never by holding the
// capability itself.
//
// SDK: @anthropic-ai/claude-agent-sdk (imported lazily so the pure helpers here
// are unit-testable without the dependency installed). Verified against
// @anthropic-ai/claude-agent-sdk 0.3.217 (pinned + lockfiled): outputFormat:
// {type:'json_schema'}, result.structured_output, permissionMode 'dontAsk',
// settingSources:[], maxTurns all exist; the SDK reads CLAUDE_CODE_OAUTH_TOKEN.

/**
 * The COMPLETE set of tools any agent spawned through this wrapper may ever be
 * granted. Callers pass a subset; anything else is refused.
 *
 * This is an ALLOW-list, and that shape is the whole point. A deny-list of
 * dangerous names cannot express "read-only" in this SDK, for three independent
 * reasons — each of which silently grants capability:
 *
 *   1. `allowedTools` entries are permission RULES, not bare names. `Bash(git
 *      diff:*)` is a legal entry, and since `allowedTools` is an auto-approve
 *      list (see askStructured), it would not merely evade a name-based check —
 *      it would PRE-APPROVE that shell invocation past `permissionMode:
 *      'dontAsk'`. Whitespace and `mcp__server__exec` forms slip through the
 *      same way.
 *   2. The tool namespace moves. Pinned SDK 0.3.217 ships `Agent` (spawns
 *      subagents, which inherit the parent's tools), `REPL`, `Workflow`,
 *      `CronCreate` and `RemoteTrigger` — none of which an author of a
 *      hand-written deny-list in 2026 would have thought to name. A deny-list
 *      is wrong by default and only accidentally right.
 *   3. It is unfalsifiable in review: you cannot tell by reading it whether it
 *      is complete.
 *
 * An allow-list inverts all three: unknown, scoped, aliased and future names are
 * refused because they are not present, not because someone predicted them.
 *
 * Read/Grep/Glob is the entire intended surface. Every agent here reads
 * UNTRUSTED input — a branch diff, an issue body, a repository checkout — so a
 * consumer that genuinely needs to run something must do it in its own trusted
 * code, from data the model returned, rather than holding the capability itself.
 */
export const PERMITTED_TOOLS = Object.freeze(["Read", "Grep", "Glob"]);

const PERMITTED_SET = new Set(PERMITTED_TOOLS);

/**
 * Validate a caller's tool grant, throwing on anything outside PERMITTED_TOOLS.
 *
 * Required rather than defaulted ON PURPOSE. A default would let a new caller
 * inherit read-only access silently and then widen it at the call site with no
 * signal that it had crossed a boundary; requiring the argument makes every
 * grant an explicit, greppable decision.
 *
 * Matching is exact against the canonical names — deliberately strict. `" Read"`
 * and `"read"` are refused rather than normalized, because a validator that
 * repairs its input is guessing at intent, and the one place you do not want
 * guessing is a capability gate. The caller's fix is to pass the canonical name.
 *
 * Fails closed on every ambiguity: a non-array, an empty array, a non-string
 * entry, or any entry not in the permitted set. An empty array is rejected
 * because the SDK would treat it as "no tools" and the agent would silently be
 * unable to read anything — a session that burns quota and returns nothing.
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
    if (!PERMITTED_SET.has(t)) {
      throw new Error(
        `askStructured: tool ${JSON.stringify(t)} is not permitted. Agents here read ` +
          `untrusted input, so the grant is limited to read-only inspection: ` +
          `${PERMITTED_TOOLS.join(", ")}. Scoped permission rules (e.g. "Bash(git diff:*)"), ` +
          `MCP tool names and non-canonical spellings are refused by the same rule.`,
      );
    }
  }
  return [...allowedTools];
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
  // Validate BEFORE the dynamic import: a bad grant must fail without opening a
  // session (ask.test.mjs asserts this ordering by observing that an invalid
  // grant throws the validation error even when the SDK cannot be resolved).
  const sessionTools = assertAllowedTools(allowedTools);
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
      // `tools` and `allowedTools` are DIFFERENT levers and both are needed.
      // Per the pinned SDK's own docs (sdk.d.ts:1341-1348, :1395-1404):
      //   tools        = "the base set of available built-in tools" — the actual
      //                  RESTRICTION. Anything omitted is not in the model's
      //                  context at all, so it cannot be called or injected into.
      //   allowedTools = "auto-allowed without prompting" — a PRE-APPROVAL list,
      //                  not a restriction. On its own it would leave Bash/Write/
      //                  WebFetch/Agent present and merely unapproved.
      // Setting only `allowedTools` (as this code did before) left the read-only
      // claim resting entirely on `permissionMode: 'dontAsk'`. That does deny
      // un-pre-approved calls, so it was not exploitable by itself — but it made
      // the guarantee a property of one enum value rather than of the tool set,
      // and it left every dangerous tool visible to a model reading an untrusted
      // diff. `tools` closes that: same list, so the two can never disagree.
      tools: sessionTools,
      allowedTools: sessionTools, // pre-approve the same read-only set
      permissionMode: "dontAsk", // deny anything not pre-approved, no prompts
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
          : // `label` here too: with two consumers sharing the wrapper, an
            // unattributed "structured output not produced" is exactly the
            // ambiguity `label` exists to remove.
            `${label} query: structured output not produced (${c.detail})`,
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
