# Claude Code Hooks — Lessons

## Decisions Log

- Chose minimal defense set (2 hooks) over comprehensive (5+) to avoid
  over-engineering and false positives.
- ANTLR protection is highest-value because regeneration is the only valid
  edit path, and agents frequently try to "fix" type errors in generated code.
- Architecture boundary hook placed on PostToolUse(Write) only — running arch
  lint on every Edit would be too slow and noisy.
- Hooks go in settings.json (not settings.local.json) because they enforce
  team-wide harness policy, not personal preferences.
