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

**Round 1 — correctness / tests** (`/review` over the PR diff). No blocking
findings. What was checked and why it holds:

- *Does a page boundary ever lose or duplicate an entry?* Front-insertion is
  the only way the server list moves (there is no delete RPC), so a window
  read at `offset = loaded.length` overlaps the loaded head by exactly the
  number of revisions created since — and `appendUnseen` drops precisely
  that overlap.
- *Can `isLoadingMore` stick?* Its `finally` clears unconditionally, and
  that is safe only because `loadMoreInFlight` means at most one `loadMore`
  owns the flag at a time. `isLoading` needs its generation guard because
  `refresh` has no such lock.
- *Does a superseded append survive?* The generation is read before the
  request and compared after, so a `refresh` that reset the timeline
  invalidates it. Covered by a test.

**Known limitation, accepted:** the next offset is the *deduped* length, so
if more than a full page (51) of revisions were created between two clicks,
a page could be entirely duplicates, nothing would append, and the button
would re-request the same offset — it would look dead until the panel is
reopened. Advancing by the raw fetched count instead would never stall, but
would silently *skip* entries if the list ever shrank. Stalling visibly beats
skipping silently, and reaching it needs 51 revisions (automatic ones come
one per 500 changes) inside one panel session.

**Non-blocking:** `loadMoreError` is not cleared by a `refresh`, so the
message can outlive the list it was about. It matches how `nameError` and
`restoreError` already behave in this panel; changing one without the others
would be the inconsistency.
