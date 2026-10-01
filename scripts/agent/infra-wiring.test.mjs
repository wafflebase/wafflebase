// The credential probe and the infra page are decided in tested scripts, but
// their safety rests on WHERE the workflow runs them. These pin that.
//
// Ported from yorkie-js-sdk. Its post-agent work all lives in a separate
// `fix-report` job; here the existing reporting steps still run inside `fix`,
// after the agent, so the two added by this port live in their own job,
// `fix-evidence`, and the last test pins that they stay out of `fix`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "..", "..", ".github", "workflows", "agent-review-panel.yml"), "utf8")
  .split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

function job(name) {
  const start = SRC.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `no job ${name}`);
  const next = SRC.slice(start + 1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next < 0 ? SRC.slice(start) : SRC.slice(start, start + 1 + next);
}
function step(jobText, name) {
  const at = jobText.indexOf(`      - name: ${name}\n`);
  assert.ok(at >= 0, `no step named ${JSON.stringify(name)}`);
  const next = jobText.indexOf("\n      - ", at + 1);
  return { at, text: jobText.slice(at, next < 0 ? undefined : next) };
}

test("the probe holds every pool secret, so it runs before any branch code is on disk", () => {
  const fix = job("fix");
  const probe = step(fix, "Pick a live fixer credential");
  assert.match(probe.text, /--probe/);
  for (const n of ["", "_1", "_8"]) {
    assert.match(probe.text, new RegExp(`CLAUDE_CODE_OAUTH_TOKEN${n}: \\$\\{\\{ secrets\\.CLAUDE_CODE_OAUTH_TOKEN${n} \\}\\}`));
  }
  // TRUSTED copy, staged from main before the checkout.
  assert.match(probe.text, /"\$RUNNER_TEMP\/agent-tools\/pick-fix-credential\.mjs"/);
  const branchCheckout = fix.indexOf("ref: ${{ github.event.workflow_run.head_branch }}");
  assert.ok(branchCheckout > 0, "could not find the branch checkout");
  assert.ok(probe.at < branchCheckout, "the probe must run before the branch is checked out");
  assert.ok(probe.at < step(fix, "Generate GitHub App token").at, "and before the App token exists");
  assert.ok(probe.at < step(fix, "Install dependencies").at, "and before any branch dependency is installed");
  assert.ok(step(fix, "Stage the trusted agent scripts").at < probe.at, "after the trusted scripts are staged");
  // The SDK the probe imports is the `deps` job's build, unpacked beside the
  // staged scripts, never the branch's install.
  const unpack = step(fix, "Unpack the Agent SDK beside the trusted scripts");
  assert.ok(unpack.at < probe.at);
  assert.match(unpack.text, /-C "\$RUNNER_TEMP\/agent-tools"/);
  // The round is still recorded after the probe has decided, and only if it found one.
  const record = step(fix, "Record the fix-round dispatch");
  assert.ok(probe.at < record.at);
  assert.match(record.text, /steps\.cred\.outputs\.available != 'false'/);
  // The page says which of the two refusals it was.
  assert.match(step(fix, "Page — no live credential for the fixer").text, /CRED_REASON: \$\{\{ steps\.cred\.outputs\.reason \}\}/);
});

test("an infra failure is paged by fix-evidence with its cause, and `stalled` stands down for it", () => {
  const evidence = job("fix-evidence");
  const infra = step(evidence, "Page an infrastructure failure");
  // Only a FAILED fixer that is KNOWN to have pushed nothing — an unread head is
  // `stalled`'s case, paged generically as before.
  assert.match(infra.text, /needs\.fix\.outputs\.fixer == 'failure' &&\s+steps\.after\.outcome == 'success' && steps\.after\.outputs\.advanced == 'false'/);
  // `advanced=false` is written only when both heads were read and match.
  const after = step(evidence, "Read the branch head after the fix").text;
  assert.match(after, /elif \[ -n "\$BEFORE" \] && \[ -n "\$AFTER" \]; then\s+echo "advanced=false"/);
  assert.doesNotMatch(after, /else\s+echo "advanced=false"/, "an unread head must not read as `nothing pushed`");
  // A latch the gate believes: github-actions[bot].
  assert.match(infra.text, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(infra.text, /continue-on-error/, "a page that failed to post must leave infra_paged empty");
  assert.match(evidence, /infra_paged: \$\{\{ steps\.infra\.outputs\.paged \}\}/);
  // The fix job hands over what fix-evidence reads.
  const fix = job("fix");
  for (const out of ["proceed: ${{ steps.guard.outputs.proceed }}", "available: ${{ steps.cred.outputs.available }}",
    "before: ${{ steps.before-fix.outputs.sha }}", "fixer: ${{ steps.fixer.outcome }}"]) {
    assert.ok(fix.includes(out), `fix must output ${out}`);
  }
  // `stalled` still pages a failed fixer — unless fix-evidence already did.
  const stalled = job("stalled");
  assert.match(stalled, /needs: \[[^\]]*\bfix-evidence\b[^\]]*\]/);
  assert.match(stalled, /\(needs\.fix\.result == 'failure' && needs\.fix-evidence\.outputs\.infra_paged != 'true'\)/);
  assert.doesNotMatch(stalled, /needs\.fix\.result == 'failure' \|\|/, "the bare fix-failure trigger would page twice");
});

test("fix-evidence runs on a fresh runner from trusted main, and survives a superseded run", () => {
  const evidence = job("fix-evidence");
  assert.match(evidence, /needs: \[review-panel, fix\]/);
  assert.match(evidence, /if: >-\s+always\(\) && needs\.fix\.outputs\.proceed == 'true'/);
  assert.match(evidence, /ref: main\s+sparse-checkout: scripts\/agent\s+sparse-checkout-cone-mode: false\s+persist-credentials: false/);
  // No secret beyond the GITHUB_TOKEN: no App key, no Claude credential.
  assert.doesNotMatch(evidence, /AGENT_APP_PRIVATE_KEY|CLAUDE_CODE_OAUTH_TOKEN/);
  // The fixer's push cancels this run; a step on the default `success()` would
  // then be skipped, on exactly the rounds the removal record is for.
  const steps = evidence.split("\n      - ").slice(1);
  assert.ok(steps.length >= 5);
  for (const st of steps) {
    assert.match(st, /\n\s+if: (>-\s+)?always\(\)/, `every fix-evidence step needs always(): ${st.split("\n")[0]}`);
  }
});

test("the page and the evidence never run in the agent's own job", () => {
  // Everything after the agent in `fix` runs where the agent had a shell. The
  // two steps this port added must not move there.
  const fix = job("fix");
  for (const s of ["fix-outcome.mjs", "test-removals.mjs"]) {
    assert.ok(!fix.includes(s), `${s} must run in fix-evidence, not after the agent in fix`);
  }
});

// A dead pool must go straight to its page. Before this, `available=false`
// still minted the App token, checked the branch out and ran `pnpm install`
// (minutes, and branch code on disk for nothing), then set `agent:fixing`
// just before the page set `agent:blocked`.
test("a known-dead pool skips the setup steps and still reaches its page", () => {
  const fix = job("fix");
  const steps = fix.split("\n      - ").slice(1).map((s) => "      - " + s);
  const at = (needle) => {
    const i = steps.findIndex((s) => s.includes(needle));
    assert.ok(i >= 0, `no step with ${JSON.stringify(needle)}`);
    return i;
  };
  const from = at("name: Generate GitHub App token");
  const to = at("name: Set state → fixing");
  assert.ok(from < to);
  const gated = steps.slice(from, to + 1);
  // The token, the branch checkout, the toolchain, the install, the state flip.
  assert.ok(gated.length >= 6, `expected the setup block, got ${gated.length} step(s)`);
  for (const st of gated) {
    assert.match(st, /\n\s+if: steps\.guard\.outputs\.proceed == 'true' && steps\.cred\.outputs\.available != 'false'(\n|$)/,
      `a setup step runs on a dead pool: ${st.split("\n")[0].trim()}`);
  }
  // What the page needs runs regardless: the staged scripts (set-state.mjs)
  // and the probe that decided. The page itself uses only those and the
  // GITHUB_TOKEN, never anything the gated block produced.
  for (const pre of ["name: Stage the trusted agent scripts", "name: Pick a live fixer credential"]) {
    const st = steps[at(pre)];
    assert.doesNotMatch(st, /available/, `${pre} must not depend on the probe's answer`);
    assert.ok(at(pre) < at("name: Page — no live credential for the fixer"));
  }
  const page = steps[at("name: Page — no live credential for the fixer")];
  assert.match(page, /if: steps\.guard\.outputs\.proceed == 'true' && steps\.cred\.outputs\.available == 'false'/);
  assert.match(page, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(page, /steps\.app-token|steps\.before-fix|pnpm/);
  assert.match(page, /"\$RUNNER_TEMP\/agent-tools\/set-state\.mjs" "\$PR" blocked/);
});
