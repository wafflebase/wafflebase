# Slides Visual Builders — Task Tracking

Issue: #1112 (Deck authoring: a design-critic lane and richer visual
builders). This task covers the builder half only.

A 13-slide talk deck authored with the existing compositions
(`packages/backend/src/template/seed/compositions.ts`) came out clean but
read like a report: cards, tables and code only. The human-made deck it was
compared with used flow/architecture diagrams, icons and charts. The run
also found two bugs: `bigNumberCard("87건")` broke the number and its unit
onto two lines in cards narrower than ~600px, and `codeBlock` painted
Hangul in a monospace chain with no Hangul glyphs.

## Tasks

- [x] `flow(nodes, edges?, opts)` — native shapes + connectors attached to
      them, laid out on a step × lane grid inside `box`; labels shrink to
      fit or the builder throws
- [x] `chart(kind, categories, series, opts)` — bar / column / line; native
      shapes by default because the PPTX exporter drops `chart` elements;
      `native: true` emits the `ChartElement` (in-app + PDF only)
- [x] `icon(name, opts)` — 16 hand-drawn icons as stroked `freeform`
      shapes (custGeom in PPTX), coloured by theme role
- [x] `bigNumberCard`: size the figure from a px width estimate (font
      sizes are pt), so a figure + unit stays on one line; throw when it
      cannot fit at the minimum size
- [x] `codeBlock`: switch to `Nanum Gothic Coding` (catalogue web font,
      monospace with Hangul) when the code has Hangul; width check in px
      and counting wide glyphs
- [x] PPTX export: write `flipH`/`flipV` on `<p:cxnSp>` so a connector
      drawn right-to-left / bottom-to-top keeps its arrow direction, and
      export the unpadded path bounds so a level arrow stays level
- [x] Specs for every builder (safe area, validator, fit rules) + exporter
- [x] Compositions table + figures paragraph in
      `packages/cli/skills/deck-author.md` and the plugin mirror
- [x] Render a sample deck with `pnpm frontend render:slides`
- [x] `pnpm verify:fast`
