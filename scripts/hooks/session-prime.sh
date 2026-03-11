#!/bin/sh
# Claude Code hook: SessionStart
# Primes the agent with workflow requirements at session start.
# This is more reliable than relying on CLAUDE.md being fully read.
#
# Exit 0 = success (SessionStart hooks are informational)
# STDOUT is injected into the agent's context.

cat <<'WORKFLOW'
=== WORKFLOW REQUIREMENTS ===
1. Non-trivial tasks → create docs/tasks/active/YYYYMMDD-<slug>-todo.md FIRST
2. Before commit → run pnpm verify:fast and confirm pass
3. Architecture changes → update the relevant docs/design/ doc
4. Commit messages → <70 char subject, blank line 2, body explains WHY
5. After task completion → pnpm tasks:archive && pnpm tasks:index
=== END ===
WORKFLOW
exit 0
