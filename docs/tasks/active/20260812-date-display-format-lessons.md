# Lessons — date display format setting (#584)

## Notes

- The frontend has **no i18n framework** (no `i18next`, no language
  setting). "Localize by the user's locale" therefore means passing
  `undefined` as the locale to `Intl.DateTimeFormat`, which resolves to the
  runtime/browser locale. If a language setting lands later, that single
  `undefined` is the one place to thread it through.
- `formatDistanceToNow` (date-fns) throws a `RangeError` on an invalid
  `Date`, which is why `formatRelativeTime` already guards. `Intl` does
  too (`RangeError: Invalid time value`), so the new formatters need the
  same guard — one bad row must not blank the list.
- The preference is read by both the Settings page and the documents list,
  which live in separate route trees. A `useSyncExternalStore` over
  `localStorage` + a custom event keeps them in sync without adding
  another context provider to `App.tsx`.

## Follow-ups

- (none yet)
