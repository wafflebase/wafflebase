# Table CRDT Phase A — Lessons

## What Went Well

- **Single-commit approach**: All changes compiled and tested together,
  avoiding intermediate broken states with `--no-verify` commits.
- **Comprehensive grep**: Running `cell\.inlines` grep across the entire
  `packages/` directory caught a reference in `selection.ts` that wasn't
  in the original task plan's file map.

## Patterns to Remember

- When changing a data model interface, grep the entire monorepo for the
  old field name — files outside the planned scope often reference it.
- Table cell content is now accessed via `cell.blocks[0].inlines` (first
  block) or `cell.blocks.flatMap(b => b.inlines)` (all blocks).
- YorkieDocStore table serialization uses tree node children
  (`row → cell → block → inline → text`) instead of JSON attributes.
