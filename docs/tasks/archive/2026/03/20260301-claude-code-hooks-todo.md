# Claude Code Hooks — Minimal Defense Set

## Goal

Add Claude Code hooks that mechanically prevent high-cost agent mistakes,
following the harness engineering principle "Constraints Over Documentation."

## Design Decisions

- **Approach**: Minimal defense set (2 hooks) — block the most costly mistakes
- **Blocking method**: STDERR message with exit 2 (injects remediation into context)
- **Script location**: `scripts/hooks/` (consistent with existing harness scripts)
- **Config location**: `.claude/settings.json` (team-shared, git-tracked)
- **Existing `settings.local.json`**: untouched (personal permissions)

## Hooks

### Hook 1: guard-generated-files.sh (PreToolUse — Edit|Write)

Blocks direct editing of ANTLR-generated files in `packages/sheet/antlr/`.
Allows editing `Formula.g4` (the grammar source).

Detection: path match on `packages/sheet/antlr/` excluding `.g4` files.

STDERR output guides the agent to the correct workflow:
edit `.g4` → run `pnpm sheet build:formula` → commit generated files.

### Hook 2: check-arch-boundary.sh (PostToolUse — Write)

After a new file is created in `packages/frontend/` or `packages/backend/`,
runs the relevant architecture lint (`lint:arch`).

This is informational (exit 0), not blocking — the file is already created.
STDERR output shows any boundary violations found.

Only triggers for `Write` (new files), not `Edit` (existing files).

## Files to Create/Modify

- [x] `scripts/hooks/guard-generated-files.sh` — new
- [x] `scripts/hooks/check-arch-boundary.sh` — new
- [x] `.claude/settings.json` — new (hooks config)
- [x] `design/harness-engineering.md` — update with hooks section
- [x] Run `pnpm verify:fast` to confirm no regressions

## Out of Scope

- Productive hooks (auto-lint, test hints) — future iteration
- File naming enforcement — already caught by verify:fast
- `.env` protection — already in .gitignore
