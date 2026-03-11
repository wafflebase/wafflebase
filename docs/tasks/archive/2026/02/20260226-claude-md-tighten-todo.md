# TODO

- [x] Re-read Anthropic CLAUDE.md best-practice section and extract actionable criteria
- [x] Apply suggestion 1: trim file-by-file detail from `CLAUDE.md`
- [x] Apply suggestion 2: reduce duplicated document listings and keep concise pointers
- [x] Apply suggestion 3: simplify task-process directives so only stable project context remains
- [x] Apply suggestion 4: add operational pitfalls/troubleshooting notes that are hard for the model to infer
- [x] Update `tasks/README.md` table of contents with this task
- [x] Re-check `AGENTS.md`(symlink) rendering and review final diff

## Review

- Replaced the long `Key Files` section with a short `High-Signal Entry Points` list to keep navigation practical without a full file catalog.
- Collapsed duplicated documentation sections into a concise index-first list, centered on `design/README.md` and package READMEs.
- Simplified process-heavy `Task Notes` into a smaller `Task Documentation` section with stable naming/index rules.
- Added `Operational Pitfalls` covering ANTLR regeneration, generated-file handling, service prerequisites, and Store-layer discipline.
- Verified `AGENTS.md` remains a symlink to `CLAUDE.md`; edits are reflected through that link.
