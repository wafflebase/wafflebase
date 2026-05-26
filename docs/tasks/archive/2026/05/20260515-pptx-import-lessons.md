# PPTX Import — Lessons

**Created**: 2026-05-15

Lessons captured while shipping PPTX best-effort import (PR2 of
`slides-themes-layouts-import.md`). Benchmark deck is the 36-slide
Yorkie 캐즘 file.

Filled in during implementation as patterns emerge. Headings below are
placeholders for the topics most likely to need notes — drop or rename
as the work plays out.

## Parser

## EMU and slide-size scaling

## Connector forward references

## `<a:normAutofit>` fidelity

## Image upload + concurrency

## Yorkie write of the parsed document

## Test fixtures (synthetic vs. real `.pptx`)

## CLI parity with `docs import`

The slides CLI orchestrator (`runSlidesImport`) is a near-clone of
`runDocsImport`, with two intentional shape changes worth calling out:

1. **Parser injection.** Docs uses the parser inline via `safeImportDocx`;
   tests round-trip a real `.docx` through `DocxExporter` to exercise it.
   Slides has no exporter, so committing a binary fixture or running a
   full `.pptx` builder in every orchestrator unit test bloats the file.
   `RunSlidesImportArgs.parser` is the cheap escape hatch — production
   defaults to `importPptx` from `./pptx-import.js`, tests pass a stub
   that returns a synthetic `SlidesDocument`.

2. **Report surfacing.** Docs has no equivalent of `ImportReport`, so the
   CLI prints `{ id, title }` and exits. Slides exposes the full report
   (`groupsFlattened`, `tablesFlattened`, etc.) as a `report` field on
   the success envelope. Agentic callers can parse counters without
   regex-matching the toast string.

## Backend content endpoint dispatch

`PUT /api/v1/workspaces/:wid/documents/:did/content` now serves both
docs and slides. The controller loads the persisted document type first
and routes to either `writeDocsRoot` (Yorkie Tree CRDT) or
`writeSlidesRoot` (plain JSON bulk-assign), with a body sniffer that
picks the validator arm: `Array.isArray(body.slides)` → slides,
`Array.isArray(body.blocks)` → docs. Mismatched shape/type combinations
return 400 before any Yorkie attach fires.

Renaming the controller would have made the dual responsibility more
visible, but the rename diff would have churned every import site for
no behavioural gain. Left the file name and added a docstring instead.

## Body shape sniffing vs DB type lookup

A naive design would require the client to pass a `?kind=slides` query
parameter, but the persisted document type is the source of truth — the
client already knows which deck they're writing to. The sniff is just a
defense against malformed payloads reaching either writer (which would
otherwise crash on dereference); it doesn't decide which arm runs. The
DB type check still throws BadRequest when the body's shape disagrees,
so the caller learns about the mismatch immediately.

## Shared OOXML library — follow-up candidates

Decision (2026-05-15): keep slides PPTX parsing self-contained for PR2;
revisit extraction after both DOCX (docs) and PPTX (slides) are in
production. YAGNI + we want to see the two implementations side-by-side
before committing to an interface.

Concrete extract candidates once PR2 ships:

- `parseRels` / `resolveRelsTarget` — slides version is ~1:1 with docs's
  `parseRelationships`. Move to `@wafflebase/ooxml` or a docs subpath.
- EMU constants (914400 / inch, 12700 / pt) — currently in `docs/units.ts`
  and (forthcoming) `slides/geometry.ts`.
- `<a:srgbClr>` / `<a:schemeClr>` / `<a:tint>` / `<a:shade>` parsing —
  pure DrawingML; identical across both formats.
- `<a:blip r:embed>` image upload glue.

## Scaffold deferred-utilities

Task 1's planned `geometry.ts` / `color.ts` / `font.ts` modules moved to
Task 2 (their first consumers — theme/master parsing). Writing them
eagerly in Task 1 would have produced empty stubs.

## Benchmark dry-run (2026-05-15, post-Task 4)

Ran the 36-slide Yorkie 캐즘 deck through `importPptx` once Tasks 1–4
landed. Output matched the static analysis to within 1–2 elements:

| Metric | Static analysis | Runtime |
|---|---|---|
| Slides | 36 | 36 |
| Images (`<p:pic>` refs) | 63 | 63 |
| Connectors (`<p:cxnSp>`) | 51 | 51 |
| Groups (`<p:grpSp>`, depth 1) | 48 | 48 flattened |
| Tables (`<p:graphicFrame>`) | 7 | 7 flattened |
| Unknown prsts (rightArrowCallout / leftBracket / homePlate) | 3 | 3 → rect fallback |
| Total elements imported | n/a | 480 (text 208, shape 158, connector 51, image 63) |
| Notes coverage | every slide | 36/36 |

Two small discrepancies for later investigation: `outerShdw` was counted
at 7 in static analysis but the runtime dropped only 5 (likely the
other 2 are nested in master/layout, not slide). The original
`<p:sldLayout type="body">` (5 slide refs) maps to `one-column-text`
but only 3 layout types showed up in `Set(slides[*].layoutId)`. Worth a
follow-up trace.

**Action item:** the dry-run was driven by an ad-hoc node script that
polyfilled `DOMParser` via `@xmldom/xmldom`. Once Task 6 lands, the CLI
runs the same code path natively — no need for a checked-in fixture
script.

## dist/ staleness when running scripts manually

`node /tmp/script.mjs` against `packages/slides/dist/node.js` returns
**old** behavior if you forgot to `pnpm slides build` after editing
sources. Symptom in our case: `report.groupsFlattened` stayed at 0
even though Task 4's group flattener was wired correctly — the dist
just hadn't been rebuilt. **Always `pnpm slides build` before invoking
the published entry from external scripts.** Test runs (vitest) read
sources directly and don't hit this trap.
