# Claude Code Plugin — Task Tracking

Design doc: [claude-plugin.md](../../design/claude-plugin.md)

Goal: ship a Claude Code plugin that lets developers and power users manage
Wafflebase documents from Claude Code on top of the existing `wafflebase`
CLI (approach A). One PR.

## Plan

- [x] 1. Design doc `docs/design/claude-plugin.md` + design README index row
- [x] 2. Marketplace `.claude-plugin/marketplace.json` + `plugins/wafflebase/.claude-plugin/plugin.json`
- [x] 3. Safety table generator: walk the real commander tree, join to the
      schema registry `safety`, emit `plugins/wafflebase/hooks/command-safety.json`
- [x] 4. PreToolUse guard hook (`guard.mjs`): classify `wafflebase …` Bash
      commands → allow read-only single commands, ask for write/destructive,
      fall through for everything else
- [x] 5. SessionStart hook (`session-start.mjs`): CLI presence + login state
      + web origin injected as context
- [x] 6. Skills: core `wafflebase` + `wafflebase-sheets` / `-docs` / `-slides`
      with `references/` copied from `packages/cli/skills/`
- [x] 7. Slash commands: `find`, `publish`, `setup` (as user-invoked skills)
- [x] 8. Drift tests in `packages/cli` (safety table + reference copies are
      in sync; every commander leaf is classified) + guard/session hook tests
- [x] 9. Plugin README + docs-site / cli.md pointer
- [ ] 10. `pnpm verify:fast` green; `claude plugin validate` if available
- [ ] 11. Self-review (max 3 rounds), log in lessons
- [ ] 12. Rebase, open PR

## Review

(filled in after self-review)
