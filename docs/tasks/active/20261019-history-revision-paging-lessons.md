# Lessons — History revision paging (#1092)

## Notes

- `useRevisions().listRevisions` in `@yorkie-js/react@0.7.25` takes
  `{ pageSize, offset, isForward }`. There is no total count and no
  "has more" flag, which is why the `pageSize + 1` probe is needed at all.
- `groupRevisions` already sorts defensively by `createdAt`, so an appended
  older page needs no special handling to land below the newer ones.
- Offsets are computed against the server's *current* list, so a revision
  created between two page loads shifts every later offset by one and the
  same entry comes back twice. Deduping by id is what makes the second page
  correct; it also means a page can append fewer than `pageSize` entries
  without meaning "the end".

## Self-review rounds

(filled in during `/code-review`)
