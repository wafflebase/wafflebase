# Date display format setting + date column tooltips (#584)

## Goal

The documents list renders its **Modified** / **Created** columns as a
relative time only ("about 1 month ago"). That reads well at a glance but
hides the actual timestamp, and there is no way to ask for the real date.

Add a user preference with two display formats and always expose the full
timestamp on hover:

- **Relative** — today's behavior (`about 1 month ago`).
- **Exact date** — locale-formatted (`Jul 25, 2026` / `2026년 7월 25일`),
  with the year omitted when the date is in the current calendar year.
- **Tooltip** — regardless of format, the full localized date + time
  (`Jul 25, 2026, 3:30 PM`).

## Acceptance criteria (from the issue)

- [x] Settings tab gets a "Date Display Format" option: `Relative` /
      `Exact date`.
- [x] Exact date omits the year for dates inside the current calendar year.
- [x] Exact date is localized from the user's locale (`Intl.DateTimeFormat`
      with the runtime default locale — the app has no i18n language
      setting, so the browser locale *is* the user's locale).
- [x] Both columns carry a `title` tooltip with the full localized
      date + time in every format.
- [x] Fallback UI (`—`) for `null` / `undefined` / unparseable values,
      tooltip included.
- [x] Sorting still compares the raw absolute dates, independent of the
      display format.

## Plan

1. `packages/frontend/src/app/documents/document-list-utils.ts`
   - `formatExactDate(value, now?)` — `Intl.DateTimeFormat` (default
     locale), `{ month: "short", day: "numeric" }` plus `year` only when
     the date is not in the current calendar year. `—` on bad input.
   - `formatFullDateTime(value)` — full localized date + time for the
     tooltip. `—` on bad input.
   - `formatListDate(value, format)` — dispatch on the preference.
2. `packages/frontend/src/lib/date-format-preference.ts`
   - `DateDisplayFormat = "relative" | "exact"`, localStorage-backed
     (`wafflebase-date-format`), `useDateFormat()` via
     `useSyncExternalStore` so the list re-renders when Settings changes
     it. No new context provider / `App.tsx` plumbing needed.
3. `packages/frontend/src/app/documents/document-list.tsx`
   - `dateColumn`'s cell renders through a small `DateCell` that reads the
     preference and wraps the text in `title=`. `sortingFn` untouched
     (already `compareDates` over the accessor's raw ISO string).
4. `packages/frontend/src/app/settings/page.tsx`
   - New "Dates" section with a `Select` for the two formats.
5. Tests — extend
   `packages/frontend/tests/app/documents/document-list-utils.test.ts`
   (year omission, invalid input, tooltip string) and add
   `packages/frontend/tests/lib/date-format-preference.test.ts`.

## Out of scope

- Any other date rendering (comments, notifications, file view) keeps
  using `formatRelativeTime` — the issue is about the list's date column.
- Server-side persistence of the preference (localStorage only, like the
  theme).
