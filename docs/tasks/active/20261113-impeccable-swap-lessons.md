# Lessons — Impeccable swap

- `AGENTS.md` is a symlink to `CLAUDE.md`. Check `ls -l` before editing
  "both": a loop that edits each one writes the same line twice.
- `npx impeccable install` drops an 18 MB platform binary into
  `.claude/skills/impeccable/scripts/bin/`. Its launcher says it expects that
  directory to be gitignored and fetches + checksum-verifies on first run, so
  ignore it rather than committing it.
