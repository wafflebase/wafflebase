// Which credential should the FIXER use, and is there one at all?
//
// WHY THIS EXISTS. `token-pool.mjs` is a Node module, so only the SDK-driven steps
// can consult it. Every `claude-code-action` step in the pipeline — the `fix` job
// here, plus agent-fix, agent-implement, agent-iterate-ci, agent-review-reply and
// agent-summarize — instead takes one hardcoded `secrets.CLAUDE_CODE_OAUTH_TOKEN`.
// That variable is SLOT ZERO of the pool (`token-pool.mjs::TOKEN_ENV`, "the
// unsuffixed variable is slot zero"), which means the fixer runs on the credential
// the panel is most likely to have just burned. `isExhausted`'s docblock names the
// hazard exactly: falling back to the ambient token re-uses "a credential the pool
// has already retired".
//
// Measured on #876: the panel drained both configured accounts, the fix job
// dispatched round 1 of 3, and `claude-code-action` died 1.6s after init with
// `is_error:true`, turns=1, tokens=0. The branch head never moved, the loop paged
// "the fixer agent failed", and the PR had spent a fix round on a session that never
// ran. #873 is the same root cause one step earlier: a lens reported "every
// credential in the pool (2) was retired — nothing left to fail over to".
//
// So this reads the pool state the panel recorded and answers two questions:
//   slot=<suffix>   which secret to hand `claude-code-action` ("" = the unsuffixed one)
//   available=      true/false — is there any live credential to spend a round on
//
// FAIL DIRECTION — and it is deliberately NOT uniform, because the two failures are
// not alike:
//
//   * Cannot READ the pool state (no artifact, malformed JSON, panel crashed before
//     writing it) → `available=true`, `slot=` empty. We do not know that the fixer
//     would fail, and skipping it would lose a fix that might well have worked. This
//     is exactly today's behaviour, so an un-wired or half-broken hand-off costs
//     nothing that is not already lost.
//   * KNOW every slot is retired → `available=false`. Here we do know. Dispatching
//     would consume one of three fix rounds on a session that cannot start, which is
//     strictly worse than pausing and saying so.
//
// Usage:
//   node pick-fix-credential.mjs [--state <dir-or-file>] [--out-env]
// Always exits 0. Writes `slot=` / `available=` / `reason=` to $GITHUB_OUTPUT when
// set, and always logs a human line.

import { readFileSync, existsSync, statSync, appendFileSync } from "node:fs";
import path from "node:path";
import { MAX_SLOTS, TOKEN_ENV } from "./token-pool.mjs";

const STATE_FILE = "review-pool-state.json";

/**
 * The env-var suffix for a slot name: `CLAUDE_CODE_OAUTH_TOKEN_3` → `"3"`, and the
 * unsuffixed slot-zero name → `""`.
 *
 * Returns `null` for anything that is not one of this pool's names. That matters
 * because the caller interpolates the result into a `secrets[...]` lookup: a name
 * from a malformed artifact must not be able to steer that lookup at some other
 * secret, so the value is re-derived from the KNOWN slot list rather than trusted.
 */
export function slotSuffix(name) {
  if (typeof name !== "string") return null;
  if (name === TOKEN_ENV) return "";
  for (let i = 1; i <= MAX_SLOTS; i++) {
    if (name === `${TOKEN_ENV}_${i}`) return String(i);
  }
  return null;
}

/**
 * Decide from a parsed pool-state object. Pure, so the fail directions above are
 * testable without artifacts.
 *
 * `live` is filtered through `slotSuffix`, so an unrecognised name is dropped rather
 * than forwarded — an artifact naming `GITHUB_TOKEN` cannot make the fixer read it.
 */
export function chooseCredential(state) {
  if (!state || typeof state !== "object") {
    return { slot: "", available: true, reason: "no-pool-state" };
  }
  const live = Array.isArray(state.live) ? state.live : null;
  if (!live) return { slot: "", available: true, reason: "pool-state-unreadable" };

  const usable = live.map(slotSuffix).filter((s) => s !== null);
  if (usable.length === 0) {
    // Three different states reach here and only ONE of them is evidence that
    // dispatching would waste a round.
    //
    // An unconfigured pool (`size: 0`) means the repo runs on the ambient credential
    // alone — nothing to fail over to OR away from — so the fixer proceeds as it
    // always has.
    if (Number(state.size) === 0) {
      return { slot: "", available: true, reason: "pool-unconfigured" };
    }
    // A live list that is genuinely EMPTY, with slots configured, is the drained
    // pool: the panel retired every one of them. This is the only fail-closed case.
    if (live.length === 0) {
      return { slot: "", available: false, reason: "all-slots-retired" };
    }
    // A NON-empty live list none of whose names we recognise is a malformed or
    // tampered artifact, not a drained pool — nothing here says a credential is
    // unavailable, only that we cannot tell which. By the rule at the top of this
    // file that is an "unreadable" state and it fails OPEN: refusing here would
    // block every fixer on a repo whose artifact shape drifted.
    return { slot: "", available: true, reason: "unrecognised-slots" };
  }
  // First live slot in slot order. Not the panel's current slot and not a random
  // one: order is stable, so two jobs reading the same state agree, and a human
  // reading the log can predict what it picked.
  return { slot: usable[0], available: true, reason: "live-slot" };
}

/** Read the state file from a directory or an explicit path. Never throws. */
export function readPoolState(target) {
  try {
    if (!target) return null;
    let file = target;
    if (existsSync(target) && statSync(target).isDirectory()) file = path.join(target, STATE_FILE);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * How many slots are configured out of the ceiling — the capacity line an operator
 * can act on. A page that says "a lens failed" is not actionable; one that says
 * "2 of 9 credential slots are configured" is.
 */
export function capacityNote(state) {
  const size = Number(state?.size);
  if (!Number.isInteger(size) || size < 0) return "";
  const max = Number.isInteger(state?.maxSlots) ? state.maxSlots : MAX_SLOTS;
  const total = max + 1; // slot zero plus the suffixed ones
  const retired = Array.isArray(state?.retired) ? state.retired.length : 0;
  const detail = `${size} of ${total} credential slot(s) configured, ${retired} retired this round`;
  if (size === 0) return `${detail} — the pool is OFF; the pipeline runs on the ambient credential alone`;
  if (size <= 2) return `${detail} — register more \`${TOKEN_ENV}_N\` secrets; a round spends 6 lenses plus a verifier per finding`;
  return detail;
}

function main(argv) {
  const at = argv.indexOf("--state");
  const target = at >= 0 ? argv[at + 1] : "/tmp/review-panel-execution";
  const state = readPoolState(target);
  const { slot, available, reason } = chooseCredential(state);

  const which = slot === "" ? TOKEN_ENV : `${TOKEN_ENV}_${slot}`;
  console.log(
    available
      ? `fixer credential: ${which} (reason: ${reason})`
      : `fixer credential: NONE LIVE (reason: ${reason}) — not dispatching, so no fix round is spent`,
  );
  const note = capacityNote(state);
  if (note) console.log(`credential capacity: ${note}`);

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `slot=${slot}\navailable=${available}\nreason=${reason}\n`);
    appendFileSync(out, `capacity=${note}\n`);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
