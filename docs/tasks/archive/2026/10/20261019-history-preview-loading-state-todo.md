# History: show a loading state while a revision preview is fetched

Issue: #1093 (follow-up to #1010)

## Problem

Clicking **Preview** on a version renders nothing until `getRevision`
resolves. `revision-preview.tsx` renders its banner under `{meta && …}`, so
until the revision metadata arrives the overlay is an empty `bg-background`
rectangle covering the editor — no spinner, no "Back to current version", no
indication that anything is happening. Snapshots grow with the document, so
the gap is longest on exactly the documents where history matters most, and a
blank screen with no exit reads as "this version is empty" or "the app froze."

## Acceptance criteria (from the issue)

1. The banner renders **immediately** in a loading state: "Loading version…"
   with a spinner.
2. **Back to current version** enabled while loading.
3. **Restore this version** disabled until the snapshot has loaded.
4. The body shows a skeleton.
5. The clicked entry in the history panel is marked as loading.
6. The existing error path (`role="alert"`) stays as is.

## Plan

### 1. `revision-preview.tsx` — always render the banner

- Replace the `{meta && …}` gate with an always-rendered banner whose
  contents switch on `meta`. While `meta` is null and no `error` has been
  set, it shows `Loading version…` beside a `Loader2` spinner and carries
  `aria-busy="true"`.
- `Back to current version` is rendered in both states (it is the only exit).
- `Restore this version` is `disabled` while loading, in addition to the
  existing `isRestoring` reason.
- The slide prev/next control stays gated on `slideCount > 1`, which is 0
  while loading, so nothing extra is needed there.
- Body: while loading, render a `Skeleton` block in the content region
  (`aria-hidden`, since the banner already announces). The `error` branch and
  the per-type `MountErrorOverlay` paths are untouched.

A revision that fails to load must not stay "loading" forever: the loading
state is `!meta && !error`, so the error branch takes over the body and the
banner drops out of its busy state.

### 2. `preview-loading.ts` — publish which revision is being fetched

The panel and the overlay are **siblings** mounted by five different editors
(`notes-detail.tsx` and friends), each with its own `useRevisionHistory`
instance, and the panel has no knowledge of the overlay's fetch. Same shape
as the problem `restore-lock.ts` already solves, so same solution: a tiny
module-level store with a `useSyncExternalStore` hook, carrying the id of the
revision whose snapshot is in flight (or `null`).

- `RevisionPreview` publishes the id for the duration of its `getRevision`
  call and clears it on settle and on unmount.
- `HistoryPanel` reads it and marks the matching row: `aria-busy` on the
  `<li>`, a spinner in its Preview button, and that one button disabled (the
  other rows stay clickable — switching versions mid-load is allowed).

Carries the same single-document caveat `restore-lock.ts` documents.

### 3. Tests

`__tests__/revision-preview.test.tsx`:

- A deferred `getRevision` shows `Loading version…`, an enabled Back button
  and a disabled Restore button before it resolves.
- The loading state clears once the snapshot arrives.
- A rejected `getRevision` leaves the error alert, not a stuck spinner.

`__tests__/history-panel.test.tsx`:

- A row whose revision is loading renders `aria-busy` and a disabled Preview
  button, while the other rows stay enabled.

Existing tests in `revision-preview.test.tsx` / `restore-lock.test.tsx` use
`getByRole('status')` as a proxy for "the snapshot has loaded". That stops
being true once the banner renders immediately, so those waits are tightened
to the banner's loaded text (`/Viewing/`).

### 4. Docs

A paragraph in `docs/design/revision-history.md` §4 recording that the banner
is unconditional and why.

## Out of scope

- Any change to the error copy or the `role="alert"` treatment.
- Progress reporting for the fetch itself (Yorkie's RPC exposes none).
- A skeleton that imitates each engine's own layout.
