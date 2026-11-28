---
title: agent-runner-design
target-version: 0.7.0
---

# Agent Runner Design — Task Tracking

Turn "paste a Claude setup token into workspace settings so an agent helps the
team" into a design that the credential terms allow. Research (codebase,
Anthropic auth policy, prior art, runtime architecture) ran as four parallel
agents; the result is `docs/design/agent-runner.md`. Design only — no code in
this task. Related: issue #696 (Notes AI toolbar, BYOK seam).

## Plan

- [x] Research: codebase seams (bot members in chat.md P3, chat SSE bus,
      webhook lease worker, `runAsApiWriter`, plugin guard)
- [x] Research: `claude setup-token` and the credential terms — verified the
      Legal and compliance wording first-hand, not from a summary
- [x] Research: prior art (Linear, Claude Code Action, self-hosted runners,
      Zed ACP, Claude Tag, Liveblocks) and runtime patterns
- [x] Write `docs/design/agent-runner.md`: tasks, event stream + leases,
      runner, credential/invocation policy, authority narrowing, hop cap
- [x] Check each codebase claim in the doc against the source (no per-document
      ACL inside a workspace; no revision API in CLI or `/api/v1`; chat id
      types)
- [x] Index row in `docs/design/README.md`; cross-link from chat.md's push
      non-goal
- [x] `/impeccable critique` of the install → bot setup journey (25/40, 3 P1
      in the design); folded in: pairing codes + agent-only key file, bot
      creation asks *Who will mention this bot?*, connect step with host
      status, listen mode as the first host, runner start banner, docs page
      moved to the listen-mode phase, `wafflebase bots` CLI parity
- [x] Second critique (26/40) folded in: chat.md now defers bot keys to
      pairing; pairing generalised to people (`login --pair`); listen mode
      waits in bounded 240 s calls with a guard row for `--as-bot` of the
      listening bot only, and is labelled attended; runner Claude credential
      via `agent credential set` from stdin; § 11 task log, caps and *Pause
      all bots*, shipped together with *Any member* bots in phase 4
- [x] Third critique (25/40) folded in: people pairing moved to phase 2
      beside bot pairing (same endpoint), host status announced as text via
      aria-live, instance-wide gap named with an env-flag stopgap
- [x] Follow-up PR (separate branch): today's P2s — API key dialog next
      step + Done-only dismiss, revoke confirmation, README/setup
      `WAFFLEBASE_WORKSPACE`, settings section index, setup skill pointer,
      CLI login re-prompt on an invalid workspace number
- [ ] Maintainer review of the design and its three open questions
- [ ] Open a PR

## Review

Design-only change; verification is `pnpm verify:fast` (doc links, task
index) passing.
