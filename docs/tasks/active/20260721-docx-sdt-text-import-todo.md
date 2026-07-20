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

## Verification

- [x] `parseParagraph` unit tests green (7/7)
- [x] End-to-end import of the real file: 85 non-empty text lines restored
      (was effectively none); "중간보고서", "개요", 멘티별 활동내역 all present
- [x] Full docs import suite green (82/82)
- [ ] `pnpm verify:fast`
- [ ] Self code review over the branch diff
- [ ] PR opened

## Note

Documents already imported with the buggy code keep the dropped text in their
stored CRDT — re-import is required to recover it. The fix only affects new
imports.
