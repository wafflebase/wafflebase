---
title: api-key-setup-flow
target-version: 0.6.20
---

# API Key Setup Flow — Task Tracking

A `/impeccable critique` of the journey "install the Claude plugin → set up
a bot" (25/40) found P2 problems in what ships today, on the path a person
takes to hand an agent a workspace API key. The bot/runner P1s went into
`docs/design/agent-runner.md` on `design/agent-runner`; this task is the code
half.

## Plan

- [x] Tests first (frontend `workspace-settings.test.tsx`, CLI login):
      reveal dialog shows the CLI export lines and survives Escape; revoke
      asks before calling the API; section index links; invalid workspace
      number re-prompts
- [x] Reveal dialog: copyable `export WAFFLEBASE_API_KEY=… /
      WAFFLEBASE_WORKSPACE=<id>` (+ `WAFFLEBASE_SERVER` when not the CLI
      default); Escape and outside click no longer discard the key
- [x] Revoke API key: confirmation dialog naming the key and the consequence
- [x] Settings section index (Members · API keys · Data sources · Webhooks)
      with anchors; `…` instead of `...` after the key prefix
- [x] CLI `login`: re-prompt on an invalid workspace number instead of
      silently taking the first workspace
- [x] Plugin README + setup skill + docs page: `WAFFLEBASE_WORKSPACE` beside
      `WAFFLEBASE_API_KEY`
- [x] `pnpm verify:fast`; render check of the settings page

## Round 2 (re-critique 25 → 26/40)

- [x] Setup skill: branch on `status.auth`; an API-key user skips `ctx`,
      which reads only the browser session and threw NOT_LOGGED_IN on the
      very path the reveal dialog now advertises
- [x] `status`: new `auth` field (`session` / `api-key` / `none`) and a
      message when a key overrides or replaces the session; `loggedIn`
      keeps its meaning (tests first; two contract tests updated)
- [x] Reveal dialog: say to start Claude Code from that shell and where to
      keep the key
- [x] Revoke buttons labelled with the key name for screen readers
- [x] Login without a terminal (`!` inside Claude Code, CI): no prompt, take
      the first workspace and print the `ctx switch` hint (test first)
- [x] Rejected: "the plugin README opens with a 10-row safety table" — it is
      the third section, after Install and What you can ask

## Review

- Tests written first and seen failing: 3 frontend (CLI setup lines + Escape,
  section index, revoke confirmation) and 5 CLI (`chooseWorkspace`).
  One existing test queried `getByText("API keys")`, now ambiguous with the
  index link; it queries the heading instead.
- Render check: a second Vite from this tree on :5181 (the :5173 server
  belongs to another checkout) with every `localhost:3000` call fulfilled
  from fixtures by a Playwright route, so no session cookie was needed. The
  first shot showed the CLI setup block clipping the key and server at
  400px; it wraps now.
- `impeccable detect` on the page: clean. `pnpm verify:fast`: pass.
- Not done: the setup skill pointer to Settings → Bots waits for bots to
  ship; the session still saves with an empty workspace when there are none.
