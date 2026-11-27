# Notification unread paging

The bell badge on wafflebase.io read 18 while the dropdown showed 20 rows, all
read, and no "Mark all read". The badge counts every unread row
(`unreadCount`), the dropdown fetches only the newest `LIST_PAGE_SIZE` (20),
and "Mark all read" was shown only when the *loaded page* held an unread row.
A burst of `template_needs_review` notifications pushed the unread ones past
page 1, so nothing in the UI could reach or clear them.

## Plan

- [x] Reproduce in the browser: badge `18 unread`, 20 rows, 0 unread dots, no
      "Mark all read".
- [x] Fix 1 — "Mark all read" keys on the badge count (`unreadCount > 0`), not
      on the loaded page.
- [x] Fix 2 — "Load more" in the dropdown: `useInfiniteQuery` over the
      existing `(before, beforeId)` cursor; `fetchNotifications` takes the
      composite cursor; `useMarkRead` stamps reads across every loaded page.
- [x] Tests: list shows "Mark all read" when the page is all read but the
      badge is not; "Load more" fetches the next page with the last row's
      cursor and disappears on a short page; mark-read stamps rows on page 2.
- [x] `pnpm verify:fast`
- [x] Browser check of the dropdown (local dev, this branch on :3001/:5175,
      seeded 20 read over 18 unread)
- [x] Header `shrink-0`: measured 29px (21px once "Mark all read" left)
      instead of `h-11`'s 44px when the list overflows; now 44px both ways.

## Review

- Reproduced locally with prod's shape: "Mark all read" now shows over an
  all-read first page, and clicking it took the DB from 18 unread to 0 and
  cleared the badge. "Load more" fetched the next page with the
  `(createdAt, id)` cursor and showed the unread rows.
- Stream invalidation refetches an infinite query page by page from the
  refreshed first page (React Query v5 recomputes each cursor), so a new
  notification arriving with page 2 loaded neither drops nor duplicates rows.
- Impeccable detector: no findings. `pnpm verify:fast` green.
