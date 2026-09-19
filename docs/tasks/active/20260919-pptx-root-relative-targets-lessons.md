# Lessons: PPTX package-root-relative relationship targets

## Investigation

- PptxGenJS chart targets expose a shared resolver bug, not a chart XML defect.
- Missing ZIP entries return `undefined`; the chart fallback does not require an exception.
- Change only a relationship target in the existing chart fixture to isolate path handling.
- XLSX already solved this: `resolveWorkbookRelationshipTarget()`
  (`packages/sheets/src/import/xlsx-importer.ts:129`) strips a leading `/`
  the same way, so the fix follows a pattern the repo already has.

## Validation and review

- Red: all three new root-relative resolver cases and the root-relative chart
  import failed before the fix; existing relative-path behavior passed.
- Green: all 334 PPTX import tests passed after the resolver change.
- `VITEST_MAX_WORKERS=4 pnpm verify:fast` green (exit 0).

### Review round 1 — `/code-review medium` (Sonnet 5 sub-agents)

Verdict: the fix is correct. The leading empty segment is dropped by the
existing `seg === ''` skip, `.`/`..` normalization still applies, and the
result keeps the no-leading-slash archive-entry convention every caller
(`image.ts:78`, `chart.ts:258`, `slide.ts:158,222`, `index.ts:261,326,350,390`)
relies on. Sibling helpers `relsSiblingFor` (`index.ts:427`, `slide.ts:272`)
consume already-resolved paths and need no matching change.

Two low findings:

1. `docs/tasks/README.md` linked to task files that were still untracked —
   fixed by staging this pair with the README hunk.
2. Known limitation, not fixed here. `orderedMasterTargets`
   (`index.ts:287`) de-dupes on the **raw** rel target while
   `loadMasterAndLayouts` resolves it later (`index.ts:350`), so a deck whose
   `<p:sldMasterIdLst>` names the same master part under both spellings now
   imports it twice. Pre-existing, and `orderedSlidePaths` directly above it
   already resolves before pushing — the inconsistency predates this change.
   Closing it honestly needs a fixture deck that lists one master twice, which
   is more work than the case has ever been worth; filed as a limitation
   rather than widened into this diff.

## Same bug class elsewhere — not investigated further

`packages/docs/src/import/docx-importer.ts` builds part paths by plain string
concatenation, with no leading-`/` branch and no `.`/`..` normalization:

- `word/${rel.target}` (line 193) — header/footer parts
- `${baseDir}${rel.target}` (line 698) — image uploads

**Confirmed by reading:** neither site handles a root-relative target, and both
fail the way PPTX did — `zip.file(path)` returns null, the code `continue`s or
returns `undefined`, and the header or image is dropped with no error. DOCX is
the same OPC package format, so `/word/media/image1.png` is as legal there as
`/ppt/charts/chart1.xml` is in PPTX.

**Not confirmed:** whether any real-world DOCX writer actually emits root-relative
targets. Word itself uses relative ones. No repro file, no test, no fix — this
is a code reading, not a reproduced defect. Worth its own issue before anyone
claims it is broken in practice.
