---
title: listen-without-prompts
target-version: 0.6.21
---

# Listen Without Prompts — Task Tracking

Running `/wafflebase:listen` on wafflebase.io (v0.6.20) asked the owner to
approve every step of every task: `agent next` and `agent thread` fell to
Claude Code's default prompt, `agent complete` asked as a write, and
`agent reply … --body-file - <<'X'` — the form the listen skill mandates —
always asked, because the guard read the heredoc delimiter as a local file
name and treated any redirect as a composition. A bot that needs a click
per message is not a bot.

## Decision (maintainer, 2026-11-28)

While a session listens, nothing asks: the bot's task commands, reads and
ordinary document writes run, and what cannot be undone or leaves the
workspace is **denied** (the bot says so in the thread) instead of asked.

## Plan

- [x] Tests first (`packages/cli/test/plugin.test.ts`)
- [x] Guard: a single trailing **quoted** heredoc is literal stdin — strip
      it before splitting; unquoted heredocs stay complex
- [x] Guard: `agent next|thread|complete` and `agent reply` without a local
      file are allowed when exact, by default (bot-key, task-scoped)
- [x] Guard: listening state — `agent next <bot>` records
      `{sessionId, bot, at}` in `~/.wafflebase/agents/listening.json`; a
      session is listening for 10 minutes after its last `agent next`
- [x] Guard, listening: exact reads and writes allow; destructive, local
      file I/O, connection overrides, env prefixes, never-auto-approve,
      unknown and inexact commands **deny** with a reason the bot relays
- [x] Shell-state changes ask whenever the guard would otherwise grant
      without the user's opt-in (bot task commands, listening)
- [x] Listen skill, plugin README Safety table, docs page, design docs
- [ ] `pnpm verify:fast`; `/self-review`; PR (no merge)

## Review

- 20 tests written first and seen failing; one existing test pinned the
  old policy (replies and completions ask) and now states the new one.
- Hook checked end to end with a temp HOME: a write asks before
  listening, `agent next` records the session (file 0600, dir 0700), the
  same write then runs, a delete is denied with the relay reason, and
  another session still asks.
- Not changed: the guard's `MENTION` rule also matches a directory named
  `wafflebase` (`cd …/wafflebase/wafflebase` asks). It cannot tell that
  from `/usr/local/bin/wafflebase` by text, and loosening it would widen
  what slips past; see lessons.
