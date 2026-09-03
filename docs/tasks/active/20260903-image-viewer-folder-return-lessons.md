# Lessons — image viewer returns to the workspace root, not its folder

## A route's state is not only its path

The bug was invisible in the code that caused it: `` `/w/${slug}` `` looks
like a complete documents-list destination and reads as one. It is not —
`workspace-documents.tsx` keys the folder off `?folder=<id>`, so a
destination built from the path alone silently means "the root" rather than
"unspecified". When computing a destination for a route somebody else owns,
read that route's own location parsing (`useParams` *and* `useSearchParams`)
before assuming the path is the whole address.

The same trap hit the test: `file-detail.test.tsx`'s location probe rendered
`useLocation().pathname` only, so it would have reported `/w/second` whether
the folder survived or not. A probe has to observe the part of the location
that carries the state under test.

## The design doc encoded the bug

`docs/design/image-viewer.md` said "prev/next across the workspace's images"
and described the back destination as "the document's own workspace list" —
an accurate description of the shipped behavior and of the defect. Nothing
about the folder feature (which landed later, in `workspace-folders.md`) went
back to revisit it. When a cross-cutting feature ships, the docs that
describe *destinations* and *lists* are the ones most likely to be quietly
falsified by it.

## One symptom, two defects

The reported symptom was the back button. Reading the surrounding file turned
up a second, unreported one with the same cause — prev/next collected
neighbours workspace-wide — which also *feeds* the first: stepping into
another folder's image changes where back then lands. Fixing only the
reported half would have left the user's complaint reproducible by a
different route.
