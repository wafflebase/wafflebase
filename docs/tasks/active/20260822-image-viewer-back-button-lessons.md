# Lessons — image viewer back button + Esc

## What we learned

- The documents-list destination for a `/f/:id` route was already computed
  inside `FileShell` (for its not-found redirect) as
  `currentWorkspace.slug ?? workspaces[0].slug ?? "/documents"`. A back button
  in the header and an Esc handler inside `ImageViewer` both need that same
  path, and the two components are siblings rather than parent/child — so the
  logic had to move into a small hook rather than be threaded through props.
  The extra `["workspaces"]` query the hook issues is free: react-query
  dedupes it against the one `FileShell` already runs.
- `ImageViewer` is mounted twice: by `FileDetail` (authenticated) and by
  `SharedDocument` with a share `token`. Anonymous viewers have no documents
  list, so `onClose` is optional and the shared mount simply omits it — Esc
  then does nothing, which is the correct behavior rather than a missing one.
- `SiteHeader` had no slot left of the title, so a "back" affordance would
  otherwise have landed among the right-hand action icons. One optional
  `leading` prop keeps placement conventional and leaves all existing callers
  byte-identical in output.

## Follow-ups

- The pdf and generic-file layouts still have no back/close affordance. The
  `leading` slot means adding one is a one-liner if it's ever wanted.
