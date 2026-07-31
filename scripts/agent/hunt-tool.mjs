// The explorer's ONE capability: run the wafflebase CLI and see what happened.
//
// WHY THIS EXISTS. The first cut of this hunter could not run anything. Its tools
// were `Read`/`Grep`/`Glob` and its system prompt said "you never run commands
// yourself", so it read the source, PREDICTED a contradiction, and a trusted
// runner tested the prediction afterwards. That inverted the point of targeting a
// CLI at all: a CLI's only unique value is that it is an executable interface, and
// a reader that cannot execute may as well have been pointed at any package in the
// repo. It could never be surprised, and surprise is the entire product.
//
// WHAT IS AND IS NOT BEING RELAXED. The propose/execute split is NOT the mistake
// and is NOT abandoned. It is correct for REPORTING — it is what makes replay
// exact and shell injection structurally impossible. The mistake was applying it
// to EXPLORATION, where blindness is the problem. So:
//
//   exploration  the model calls this tool, sees real output, forms a hypothesis,
//                calls again. Every call is JOURNALED as an argv array.
//   reporting    the trusted runner replays the JOURNAL 3x after the session.
//
// Because the journal records what actually ran rather than what the model claims
// it ran, the repro is now strictly MORE trustworthy than before, not less.
//
// WHY THIS IS NOT A SHELL. `Bash` would grant arbitrary execution. This grants one
// tool that can only reach `node <cli-bin> <argv...>`:
//
//   * `argv` is a string ARRAY. No shell is ever involved (`spawnSync`, no
//     `shell:true`), so quoting, `;`, `$(…)` and globs have no meaning.
//   * `assertSafeArgv` hard-denies credential and session commands independently
//     of the CLI's own schema, and — now that the model drives execution — also
//     consults that schema's `destructive`/`write` annotations via `safetyOf`.
//   * `buildProbeEnv` REPLACES the environment. The developer's real session,
//     config and workspace are unreachable, so the clean room is not a promise
//     about behaviour, it is a property of the process.
//   * A budget bounds probe count and wall-clock, because an uncapped tool loop is
//     how a $6 run becomes a $200 one.
//
// WHY REFUSALS ARE RETURNED, NOT THROWN. A thrown error aborts the tool call and
// teaches the model nothing. A refusal it can READ ("that command is denied; the
// charter is non-mutating") lets it adapt and keep exploring, which is the
// difference between a bounded agent and a stuck one.

// The SDK and zod are imported LAZILY, inside `createProbeServer` only.
//
// This is not style. `scripts/verify-self.mjs`'s `agent:tests` lane runs with
// `scripts/agent/node_modules` ABSENT — CI never installs it — so a static import
// here makes every test in this file, and every file importing it, fail with
// ERR_MODULE_NOT_FOUND. `ask.mjs` states the same invariant and it still caught me
// out in a new file: CI failed with
//   Cannot find package '@anthropic-ai/claude-agent-sdk' imported from … hunt-tool.mjs
//
// So everything testable lives in `createProbeTool`, which has no third-party
// imports at all, and `createProbeServer` is a thin async wrapper that needs them.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertSafeArgv,
  buildProbeEnv,
  redactSecrets,
  runProbe,
  DEFAULT_PROBE_TIMEOUT_MS,
} from "./hunt-probe.mjs";

export const PROBE_TOOL_NAME = "mcp__wafflebase__run";

/** Truncation cap for one stream in a tool result. Bounded, but a stack fits. */
const MAX_STREAM_CHARS = 20_000;

/**
 * Bounds on one exploration session.
 *
 * `charters.json` has declared `maxProbes` and `totalTimeoutMs` since the
 * beginning and NOTHING ever enforced them — only `perProbeTimeoutMs` was read
 * (`hunt.mjs`). That was survivable while the model could not act. The moment it
 * drives a loop, an unenforced budget is the only thing between a normal run and
 * an unbounded one, so it is enforced here, at the single choke point.
 *
 * `now` is injectable so a test can exhaust the clock without waiting.
 */
export function createProbeBudget({ maxProbes = 40, totalTimeoutMs = 600_000, now = Date.now } = {}) {
  const started = now();
  let used = 0;
  const refusals = [];
  return {
    get used() {
      return used;
    },
    get refusals() {
      return [...refusals];
    },
    /**
     * Reserve one probe. Returns `{ok:false, why}` instead of throwing, and does
     * NOT consume the reservation when it refuses — a refused call must not push
     * the budget further toward exhaustion.
     */
    charge() {
      if (used >= maxProbes) {
        refusals.push({ kind: "maxProbes", used });
        return {
          ok: false,
          why:
            `Probe budget exhausted: ${maxProbes} probes already run in this session. ` +
            "No further commands can run. Report what you have found, or return zero candidates.",
        };
      }
      const elapsed = now() - started;
      if (elapsed >= totalTimeoutMs) {
        refusals.push({ kind: "totalTimeoutMs", elapsed });
        return {
          ok: false,
          why:
            `Session probe time exhausted (${Math.round(elapsed / 1000)}s of ` +
            `${Math.round(totalTimeoutMs / 1000)}s). No further commands can run. ` +
            "Report what you have found, or return zero candidates.",
        };
      }
      used++;
      return { ok: true };
    },
  };
}

/**
 * A scratch directory for one exploration session, plus its disposal.
 *
 * Deliberately per SESSION, not per probe. The model has to be able to write a
 * fixture and then import it, or read back a file a previous command exported —
 * a fresh directory per call would make every multi-step behaviour untestable.
 * Isolation does not come from throwing the directory away: it comes from
 * `buildProbeEnv` replacing the environment, so nothing here can address the
 * developer's real workspace no matter how much state accumulates.
 *
 * (`withScratch` in hunt-probe.mjs is the per-call equivalent and stays in use
 * for replay, where a fresh room per attempt is exactly what is wanted.)
 */
export function openSessionScratch({ prefix = "wb-explore-" } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Turn a candidate's journal REFERENCES into the `probes`/`failingIndex` shape
 * the rest of the pipeline already speaks.
 *
 * The candidate cites indices into the session journal rather than authoring argv
 * itself. That is the honesty property of this whole redesign: a model cannot
 * report a reproduction it never actually ran, because the only commands it can
 * cite are ones this process executed and recorded. Previously `probes` was
 * model-authored prose that a later runner hopefully re-executed; now it is a
 * transcript.
 *
 * Fails QUIET, like every other gate here: any bad reference returns `null` and
 * the caller drops the candidate. An out-of-range index is not repaired and not
 * partially honoured — a candidate whose evidence cannot be located is exactly
 * the thing that must not become a report.
 *
 * Duplicate references are preserved rather than collapsed: running the same
 * command twice is legitimate evidence (idempotency, or a second call behaving
 * differently from the first), and deduplicating would erase that.
 */
export function resolveProbeRefs(candidate, journal) {
  const refs = candidate?.probeRefs;
  if (!Array.isArray(refs) || refs.length === 0) return null;
  if (!refs.every((i) => Number.isInteger(i) && i >= 0 && i < journal.length)) return null;

  const failing = candidate?.failingRef;
  if (!Number.isInteger(failing)) return null;
  const failingIndex = refs.indexOf(failing);
  if (failingIndex === -1) return null; // the failing probe must be among the cited ones

  const probes = refs.map((i) => {
    const e = journal[i];
    return {
      argv: [...e.argv],
      ...(e.note === undefined ? {} : { note: e.note }),
      ...(e.stdin === undefined ? {} : { stdin: e.stdin }),
      ...(e.files === undefined ? {} : { files: e.files }),
    };
  });
  return { probes, failingIndex };
}

/**
 * Is this invocation read-only no matter what the registry says?
 *
 * `assertSafeArgv` fails CLOSED when `safetyOf` cannot resolve a command, which is
 * the right default — an unknown command must not be assumed safe. But two of the
 * explorer's most important commands are unresolvable by construction:
 *
 *   * `docs --help` reduces to the single word `docs`, and the registry only names
 *     leaves (`docs.list`, `docs.export`, …). Commander prints help and exits
 *     WITHOUT running any command, so a help request cannot mutate anything.
 *   * `schema` does not appear in its own output, and all it does is print the
 *     registry.
 *
 * Without this exemption the annotation lookup would refuse `--help` — the primary
 * way an explorer discovers the surface at all — and the whole session would be
 * spent on refusals. The hard-denial list is checked BEFORE `safetyOf` inside
 * `assertSafeArgv`, so `api-keys revoke --help` stays denied regardless.
 */
const HELP_FLAGS = new Set(["--help", "-h", "--version", "-V"]);
const META_READ_ONLY = new Set(["schema"]);
export function isReadOnlyByConstruction(argv) {
  const list = Array.isArray(argv) ? argv : [];
  if (list.some((a) => HELP_FLAGS.has(a))) return true;
  const words = list.filter((a) => typeof a === "string" && !a.startsWith("-"));
  return words.length > 0 && META_READ_ONLY.has(words[0]);
}

/** A tool result the model reads as prose. `isError` marks a refusal. */
function say(text, { isError = false } = {}) {
  return { content: [{ type: "text", text }], isError };
}

function clip(s) {
  const t = String(s ?? "");
  return t.length > MAX_STREAM_CHARS ? `${t.slice(0, MAX_STREAM_CHARS)}\n…[truncated]` : t;
}

/**
 * Render an observation for the model.
 *
 * Both streams are labelled and reported separately even when empty, because
 * WHICH stream carried the output is itself a contract the charter hunts — a
 * message on stdout that the docs promise on stderr is a finding, and collapsing
 * the two would hide it.
 */
function renderObservation(obs, secrets) {
  const parts = [
    `exit code: ${obs.exitCode === null ? "null (killed)" : obs.exitCode}`,
    obs.signal ? `signal: ${obs.signal}` : null,
    obs.timedOut ? "TIMED OUT" : null,
    obs.spawnError ? `spawn error: ${obs.spawnError}` : null,
    `--- stdout (${obs.stdout.length} chars) ---`,
    clip(obs.stdout),
    `--- stderr (${obs.stderr.length} chars) ---`,
    clip(obs.stderr),
  ].filter((p) => p !== null);
  // Redacted HERE, at the boundary where text first becomes visible to a model
  // whose output reaches a public report. `runProbe` output can carry an
  // `Authorization: Bearer …` header or the configured API key verbatim.
  return redactSecrets(parts.join("\n"), { extra: secrets });
}

/**
 * The in-process MCP server exposing the single `run` tool.
 *
 * `runner` is injectable for the same reason `runProbe`'s is: the tests must
 * exercise refusal, budgeting, journalling and redaction without spawning a CLI
 * or touching a network.
 */
/**
 * The tool's behaviour, with NO third-party dependency.
 *
 * Returns the handler `createProbeServer` will register. Split out so the tests can
 * exercise budgeting, refusal, journalling and redaction without the SDK installed
 * — which is the environment CI actually runs.
 *
 * `runner` is injectable for the same reason `runProbe`'s is: no CLI, no network.
 */
export function createProbeTool({
  charter,
  bin,
  cfg = {},
  scratch,
  budget,
  journal,
  safetyOf = null,
  runner = null,
} = {}) {
  const secrets = [cfg.apiKey].filter(Boolean);
  const timeoutMs = charter?.probeBudget?.perProbeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  return async function runTool({ argv, note, stdin, files } = {}) {
    // 1. BUDGET FIRST. Checked before validation so an exhausted session cannot be
    //    kept alive by a stream of malformed calls.
    const charged = budget.charge();
    if (!charged.ok) return say(charged.why, { isError: true });

    // 2. SAFETY. Independent of the CLI's own schema for the hard denials, and
    //    additionally consulting that schema, whose wrongness is itself one of the
    //    things this hunter looks for.
    try {
      assertSafeArgv(argv, {
        mutating: charter?.mutating === true,
        safetyOf: isReadOnlyByConstruction(argv) ? () => "read-only" : safetyOf,
      });
    } catch (err) {
      return say(
        `Refused: ${err.message}\n\n` +
          "This is a hard limit, not a suggestion. Choose a different command; do not " +
          "retry this one.",
        { isError: true },
      );
    }

    // 3. RUN in the replaced environment, inside the session scratch.
    let obs;
    try {
      obs = runProbe(
        { argv, stdin, files },
        { bin, env: buildProbeEnv(scratch, cfg), cwd: scratch, timeoutMs, runner },
      );
    } catch (err) {
      // A fixture path escaping the scratch lands here. Still a readable refusal,
      // not a thrown tool call.
      return say(`Refused: ${err.message}`, { isError: true });
    }

    // 4. JOURNAL. This, not any model-authored field, is what the trusted runner
    //    replays and what the report's repro is rendered from.
    journal.push({
      argv: [...argv],
      note: typeof note === "string" ? note : undefined,
      stdin: typeof stdin === "string" ? stdin : undefined,
      files: Array.isArray(files) ? files : undefined,
      observed: obs,
    });

    // 5. REDACT on the way out.
    return say(renderObservation(obs, secrets));
  };
}

/**
 * The in-process MCP server exposing the single `run` tool.
 *
 * ASYNC and lazy on purpose: this is the only function here that touches the SDK or
 * zod, so it is the only one that cannot run in the `agent:tests` lane. Everything
 * worth testing is in `createProbeTool`, which this merely wraps in a tool schema.
 */
export async function createProbeServer(opts = {}) {
  const { createSdkMcpServer, tool } = await import("@anthropic-ai/claude-agent-sdk");
  const { z } = await import("zod");
  const runTool = createProbeTool(opts);

  return createSdkMcpServer({
    name: "wafflebase",
    version: "1.0.0",
    instructions:
      "Run the wafflebase CLI in an isolated scratch workspace. Arguments are passed " +
      "directly to the binary as an array — there is no shell, so quoting and " +
      "substitution have no effect. Credential, login and context-switching commands " +
      "are refused. State persists across calls within this session.",
    tools: [
      tool(
        "run",
        "Run the wafflebase CLI with the given arguments and return its exit code, " +
          "stdout and stderr. `argv` excludes the binary name: pass " +
          '["docs","--help"], not ["wafflebase","docs","--help"].',
        {
          argv: z
            .array(z.string())
            .min(1)
            .describe('CLI arguments after the binary name, e.g. ["docs","import","--dry-run","f.docx"]'),
          note: z
            .string()
            .optional()
            .describe("Why you are running this — recorded alongside the command for the report."),
          stdin: z.string().optional().describe("Text to write to the command's stdin."),
          files: z
            .array(
              z.object({
                path: z.string().describe("Path relative to the scratch workspace."),
                contentBase64: z.string().describe("File contents, base64-encoded."),
              }),
            )
            .optional()
            .describe("Fixture files to create before running, e.g. a document to import."),
        },
        (args) => runTool(args),
      ),
    ],
  });
}
