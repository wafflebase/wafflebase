// Live auth smoke test for the Claude Agent SDK.
//
// This is the ONE pre-arm item that cannot be verified statically: a secret
// can't be validated offline. It runs a single trivial query and asserts the
// SDK authenticated and returned a successful result — using the exact same
// SDK + auth path (CLAUDE_CODE_OAUTH_TOKEN) that review-panel.mjs uses, so a
// green run here means the panel will authenticate too. It is NOT a review: no
// repo code is read (allowedTools: []). Exits non-zero on any failure so a
// workflow_dispatch run is an unambiguous pass/fail.

const model = process.env.SMOKE_MODEL || "claude-haiku-4-5-20251001";

let query;
try {
  ({ query } = await import("@anthropic-ai/claude-agent-sdk"));
} catch (err) {
  console.error(
    `Could not import the Agent SDK — run \`cd scripts/agent && npm ci\` first: ${err.message}`,
  );
  process.exit(1);
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
    }
  }
} catch (err) {
  console.error(`❌ Agent SDK query threw — auth almost certainly failed: ${err.message}`);
  process.exit(1);
}

if (!ok) {
  console.error(
    `❌ Agent SDK did not return a successful result (last subtype: ${lastSubtype}). ` +
      "Check that CLAUDE_CODE_OAUTH_TOKEN is set on the 'agent' environment and is valid.",
  );
  process.exit(1);
}
console.log(
  `✅ Agent SDK authenticated and returned a result (model: ${model}). ` +
    "CLAUDE_CODE_OAUTH_TOKEN works on this runner — the review panel will authenticate.",
);
