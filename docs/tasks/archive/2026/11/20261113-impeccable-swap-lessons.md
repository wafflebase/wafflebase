# Lessons — Impeccable swap

- `AGENTS.md` is a symlink to `CLAUDE.md`. Check `ls -l` before editing
  "both": a loop that edits each one writes the same line twice.
- `npx impeccable install` drops an 18 MB platform binary into
  `.claude/skills/impeccable/scripts/bin/`. Its launcher says it expects that
  directory to be gitignored and fetches + checksum-verifies on first run, so
  ignore it rather than committing it.

## Self review

- Round 1 (panel): did not run. `spec-to-pr.mjs review` builds the diff with
  `execFileSync` at Node's default 1 MB `maxBuffer`; a deletion-heavy branch
  (~75k removed + ~21k vendored lines) dies with `ENOBUFS`. Not a clean round.
  Substituted an independent reviewer subagent over the modified-files diff.
- Independent reviewer (substitute for round 1): no blocking findings. Fixed
  the CONTRIBUTING detect command (`npx` → the committed pinned launcher), the
  `.gitignore` (keep `.impeccable/live/config.json`, correct the engine-cache
  comment), added the upstream Apache-2.0 LICENSE, and noted live mode's
  `index.html` injection. Deferred: `EditorAPI.positionAtClientPoint` is now
  unused outside a test stub, but it is public engine API and out of scope.
  Loop stopped here: the panel cannot read this diff, and the substitute
  round was clean.
- Rebase onto #1133 (eval removal) conflicted in the same prose: the design
  README row, `agent-pipeline.md`'s timeline and §4.1, and the task index.
  Resolve by taking main's side and re-applying this branch's deletions,
  then regenerate `docs/tasks/README.md` with `pnpm tasks:index` rather than
  hand-merging a generated file.
