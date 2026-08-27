# Lessons — bounding axis-ID coverage

## A "dense index" hides inside a sparse model

The sheet model is sparse everywhere else: cells live in a map keyed by sref,
so an empty sheet with a cursor at row 1,000,000 costs nothing. `rowOrder` is
the exception — it is a positional array, so referencing row N costs N entries.
Any code that feeds a **visual coordinate** into a dense structure inherits the
grid's 1,000,000 × 18,278 size instead of the data's size.

When reviewing, the question is not "is this loop O(n)?" but "n of what — the
data, or the coordinate space?".

## A fix aimed at one caller leaves the other one open

#180 fixed exactly this freeze for `activeCell` and documented the mitigation as
"only ranges drive axis-order extension". That sentence *is* the remaining bug:
ranges reach the same boundary through `Shift+Arrow` and row-header clicks. When
a mitigation is phrased as "only X does the dangerous thing", check what X does.

## Measure the primitive, not the app

Reproducing this through the app needs Postgres, Yorkie, a login and a
1,000,000-row scroll. Driving the CRDT primitive directly in a throwaway script
— a local unattached `yorkie.Document`, push N ids, time it — gave the real
number (433 s at 1M, superlinear from 110 ms at 10k) in minutes, and the same
local-document trick then became a server-free regression test for the store.

## Verify a regression test by deleting the fix

The first version of the early-out test asserted "no local-change event fired"
and passed **before** the fix too: an update that mutates nothing emits no
event. Restoring the original file (`git checkout HEAD -- <path>`, after
copying the fixed one aside) turned a vacuous test into a real one — it now
counts `doc.update` calls, and fails 2 ≠ 0 without the fix.

## Stale anchors are the same bug wearing a different coat

While bounding coverage, the anchor had to be *cleared* rather than left stale,
or a remote sync would resolve the old anchor and drag the cursor back. The
pre-existing `if (freshAnchor)` guard kept anchors that no longer described the
selection — a latent cursor-jump after Cmd+Down, fixed by the same change.
