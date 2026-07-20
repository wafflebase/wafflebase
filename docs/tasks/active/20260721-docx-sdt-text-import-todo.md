# DOCX import drops text wrapped in inline `<w:sdt>`

## Problem

A Google-Docs-exported `.docx` (2020 오픈소스 컨트리뷰톤 중간보고서) imported
into Docs showed no body text — only table borders. Root cause: Google Docs
wraps most exported body runs in inline content controls
(`<w:p><w:sdt><w:sdtContent><w:r><w:t>…`). The paragraph parser's run guard
only kept runs whose direct parent was the paragraph or a `<w:hyperlink>`, so
every run nested inside `<w:sdt>` was dropped. In the sample file 65 of 103
text runs (63%) live under `<w:sdt>`, so the visible text vanished.

## Fix

- [x] Replace the parent-restriction guard in `parseParagraph` with
      `runBelongsToParagraph(r, pEl)`: walk ancestors, include the run when the
      first block ancestor reached is the paragraph itself; inline wrappers
      (`w:sdt`, `w:sdtContent`, `w:hyperlink`, `w:smartTag`, fields…) are
      transparent, a nested block (`w:p`/`w:tbl`) reached first excludes it.
      Document order is preserved because `getElementsByTagNameNS` returns
      descendants in order.
- [x] Replace the wrong "should skip runs nested inside w:sdt" test with tests
      asserting inline-sdt runs are included in document order, plus a
      hyperlink-inside-sdt case.

## Review follow-ups (self code review, high effort)

The broadened guard was a regression surface; the review surfaced adjacent
correctness gaps addressed in the same PR:

- [x] Exclude removed/alternate run wrappers so they no longer leak or
      duplicate: tracked deletion (`w:del`), tracked-move source
      (`w:moveFrom`), ruby phonetic guide (`w:rt`). Live counterparts
      (`w:ins`/`w:moveTo`/`w:rubyBase`) stay visible.
- [x] Fix the `pPr`/`rPr` property lookups from a descendant `[0]` match to a
      direct-child scan, so a paragraph/run with no own properties no longer
      adopts a nested drawing-textbox paragraph's style.
- [x] Enumerate block-level `<w:sdt>`: a shared `blockChildElements` generator
      unwraps `w:sdt`/`w:sdtContent` in the body, table-cell, and header/footer
      walks so block-wrapped paragraphs/tables are no longer skipped.
- [x] Clarify that the nested-block floor is load-bearing (drawing textboxes
      legitimately nest paragraphs), not merely defensive.

## Verification

- [x] `parseParagraph` unit tests green (11/11)
- [x] Full docs import suite green (88/88)
- [x] End-to-end import of the real file: 85 non-empty text lines restored
      (was effectively none); title, overview, and per-mentee activity
      sections all present. Count unchanged after the review follow-ups (no
      legitimate content dropped).
- [x] `pnpm verify:fast`
- [x] Self code review over the branch diff (findings addressed above)
- [ ] PR opened

## Note

Documents already imported with the buggy code keep the dropped text in their
stored CRDT — re-import is required to recover it. The fix only affects new
imports.
