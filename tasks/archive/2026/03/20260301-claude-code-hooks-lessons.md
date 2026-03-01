# Claude Code Hooks — Lessons

## What Went Well

- POSIX shell + `node -e` for JSON parsing works without external deps (no jq).
- Hook scripts are simple case-match patterns — easy to extend.
- Pre-commit hook (`verify:fast`) caught nothing because hooks are inert
  infrastructure — no risk of breaking existing behavior.

## Decisions

- `guard-generated-files.sh` uses exit 2 (block) vs exit 0 (allow).
  STDERR output is fed to Claude as context for self-correction.
- `check-arch-boundary.sh` is informational only (always exit 0).
  The file is already written by the time PostToolUse fires, so blocking
  would be pointless. Instead, violations appear in Claude's context.
- `.claude/settings.json` is git-tracked (team-shared config).
  `.claude/settings.local.json` remains for personal permissions only.

## Patterns for Future Hooks

- Read JSON from stdin, parse with `node -e`, match with `case`.
- Normalize paths relative to repo root for portable matching.
- PreToolUse for blocking, PostToolUse for informational feedback.
