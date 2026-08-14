// Live auth smoke test for the Claude Agent SDK.
//
// This is the ONE pre-arm item that cannot be verified statically: a secret
// can't be validated offline. It runs a single trivial query and asserts the
// SDK authenticated and returned a successful result — using the exact same
// SDK + auth path (CLAUDE_CODE_OAUTH_TOKEN) that review-panel.mjs uses, so a
// green run here means the panel will authenticate too. It is NOT a review: no
// repo code is read (allowedTools: []).
//
// EXIT CODES ARE A CONTRACT, because this is the FIRST thing an adopter runs and
// its message is the first diagnosis they get:
//
//   0  authenticated, and the service returned a result. Safe to arm.
//   1  the credential is missing, wrong, or rejected — or the failure could not
//      be classified. Actionable: fix the secret, or read the raw message.
//   2  the credential WORKED and the service refused on capacity or quota
//      (session limit, rate limit, overloaded). Nothing is misconfigured; retry.
//   3  the SDK is not installed — `npm ci` was not run in this directory.
//
// Code 2 exists because of a real diagnosis this script got wrong. It reported
// "auth almost certainly failed" for `You've hit your session limit`, which is
// the opposite of the truth: a quota refusal is proof the credential was
// accepted and the request reached the service. Sending an adopter to hunt a
// credential problem they do not have is the worst thing a pre-arm check can do.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT = Object.freeze({ ok: 0, auth: 1, quota: 2, tooling: 3 });

// Deliberately NOT a catch-all. Each list matches only what it is confident
// about, and anything else is `unknown` — reported with the raw message and
// treated as needing attention. Guessing in either direction is worse than
// saying "I don't know": a quota error read as auth sends someone after a good
// credential, and an auth error read as quota sends them to wait for a reset
// that will never help.
const QUOTA = [
  /session limit/i,
  /rate[ _-]?limit/i,
  /\b429\b/,
  /overloaded/i,
  /usage limit/i,
  /quota/i,
  /capacity/i,
  /too many requests/i,
];

const AUTH = [
  /\b401\b/,
  /\b403\b/,
  /unauthorized/i,
  /authentication[ _-]?(error|failed)/i,
  /invalid[ _-]?(api[ _-]?key|token|credential)/i,
  /expired[ _-]?(token|credential)/i,
  /not[ _-]?authenticated/i,
  /permission[ _-]?denied/i,
  // What an unauthenticated Agent SDK actually says, measured rather than
  // guessed: "Not logged in · Please run /login". The first version of this list
  // missed it, so the single most likely real-world failure — a token that is
  // absent or malformed — fell through to "could not be classified".
  /not[ _-]?logged[ _-]?in/i,
  /please run \/login/i,
  /\/login\b/,
];

/** Classify a failure message. Returns "quota" | "auth" | "unknown". */
export function classifyFailure(message) {
  const text = String(message ?? "");
  // Quota is checked FIRST and deliberately: a capacity refusal often arrives
  // wrapped in language about credentials or permissions, and the specific
  // signal ("session limit", "429") is the more reliable one.
  if (QUOTA.some((re) => re.test(text))) return "quota";
  if (AUTH.some((re) => re.test(text))) return "auth";
  return "unknown";
}

/** The message and exit code for a classified failure. */
export function describeFailure(kind, detail) {
  const raw = String(detail ?? "").trim() || "(no detail)";
  if (kind === "quota") {
    return {
      code: EXIT.quota,
      text:
        `⏳ Authentication SUCCEEDED — the service refused on capacity or quota: ${raw}\n` +
        "   Nothing is misconfigured. CLAUDE_CODE_OAUTH_TOKEN was accepted and the request " +
        "reached the service; a quota refusal is proof of that. Retry when the limit resets.",
    };
  }
  if (kind === "auth") {
    return {
      code: EXIT.auth,
      text:
        `❌ Authentication FAILED: ${raw}\n` +
        "   Check that CLAUDE_CODE_OAUTH_TOKEN is set on the 'agent' environment, is not " +
        "expired, and belongs to an account that may use the Agent SDK.",
    };
  }
  return {
    code: EXIT.auth,
    text:
      `❌ The Agent SDK query failed, and the reason could not be classified: ${raw}\n` +
      "   Treating it as needing attention. If the message mentions a limit or capacity the " +
      "credential is probably fine; if it mentions credentials or permissions, it is not.",
  };
}

async function main() {
  const model = process.env.SMOKE_MODEL || "claude-haiku-4-5-20251001";

  let query;
  try {
    ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
  } catch (err) {
    console.error(`Could not import the Agent SDK — run \`npm ci\` in this directory first: ${err.message}`);
    process.exit(EXIT.tooling);
  }

  let ok = false;
  let lastSubtype = "(no result message)";
  try {
    for await (const message of query({
      prompt: "Reply with exactly one word: pong",
      options: {
        model,
        allowedTools: [], // no tools — this is a pure auth check
        permissionMode: "dontAsk",
        settingSources: [], // load no project config
      },
    })) {
      if (message.type === "result") {
        lastSubtype = message.subtype;
        if (message.subtype === "success") ok = true;
        // A non-success result carries the reason in the message itself, which is
        // where the session-limit text arrives — so classify from it rather than
        // only from a thrown error.
        else if (message.subtype) lastSubtype = String(message.subtype);
        if (!ok && message.result) lastSubtype = `${lastSubtype}: ${message.result}`;
      }
    }
  } catch (err) {
    const { code, text } = describeFailure(classifyFailure(err.message), err.message);
    console.error(text);
    process.exit(code);
  }

  if (!ok) {
    const { code, text } = describeFailure(classifyFailure(lastSubtype), lastSubtype);
    console.error(text);
    process.exit(code);
  }
  console.log(
    `✅ Agent SDK authenticated and returned a result (model: ${model}). ` +
      "CLAUDE_CODE_OAUTH_TOKEN works on this runner — the review panel will authenticate.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
