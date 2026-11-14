# Polish the documents list

`/impeccable polish` on `/w/:workspaceId` (`app/documents/document-list.tsx`),
scoped by the user to defects and states — no behavior change, no visual
redesign. Evidence: Playwright captures at 1440 / 820 / 390, light + dark,
over a fixture workspace (folders, all doc types, long / Korean / punctuated
titles), plus search-empty, empty-folder, loading and error states.

## Findings → fixes

- [x] Titles render in Title Case: `capitalize` on the title span rewrites
      "Meeting notes" as "Meeting Notes" — the list disagrees with the editor
      header and with the folder rows beside it. Left over from the #11
      scaffold. Remove it.
- [x] A long title widens the table past the viewport: at 1440 the Created
      column is clipped; at 390 titles are cut mid-glyph with no ellipsis.
      Let the title column absorb the free width and truncate with an
      ellipsis, full title on hover.
- [x] A search or type filter with no matches says "No documents yet" and
      offers New — wrong: the documents exist. Say nothing matches, offer
      Clear filters. An empty folder says "This folder is empty".
- [x] Previous / Next render (disabled) when everything fits one page,
      including the empty state. Show them only when there is a second page.

## Out of scope (noted, not changed)

- Error state appears only after react-query's retries (~7s of skeleton).

## Review

- All four fixed; `__tests__/document-list.test.tsx` covers each and fails
  on the pre-change file (verified by swapping it back in).
- Side effect of the width fix: the row "⋯" menu column, which a long title
  had pushed off-screen at 1440, is visible again.
- Phones: the title cell keeps `min-w-64`, so it truncates with an ellipsis
  and Owner stays visible; Modified / Created scroll as before.
- Impeccable detector: clean on both changed files.

