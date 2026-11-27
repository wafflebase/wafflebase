# Lessons — polish the documents list

- `max-w-0` on a `table-layout: auto` cell is what lets it shrink below its
  content, but on a phone it also lets the other `whitespace-nowrap`
  columns crush it to three characters. Pair it with a `min-w-*`; min
  wins over max for table cells.
- `networkidle` never settles on this app (the notifications SSE stream
  stays open); wait on `load` plus a fixed settle for screenshots.
- `node_modules` follows the last `pnpm install`, not the checked-out
  branch: after switching to a branch that still has a removed workspace
  package, re-run `pnpm install` before trusting the dev server.
