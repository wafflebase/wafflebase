# Generic file upload follow-ups — Lessons

## Two symptoms, one bug

The report was three items, and the natural reading was three fixes. Two of
them turned out to be one design decision seen from opposite ends: the title
dropped the extension, and the download filename recovered it from the storage
key. Each half looked defensible alone. Together they meant an extension
survived only if it passed `safeExtension`, so `.c++` — rejected for its `+` —
had no copy left anywhere.

Fixing them separately would have produced the obvious wrong fix: widen the
sanitizer to admit `+`. That loosens an untrusted-input-into-object-key
boundary to solve a display problem, and it only postpones the failure to the
next character not covered.

**Rule:** before fixing reported symptoms one by one, check whether they share
a cause. Two "bugs" that touch the same value from different ends usually are
one.

## A sanitizer's output is not a display name

`safeExtension` exists to keep untrusted filename input out of an S3 key. Its
result was then reused as the source of the user-visible download filename —
so a security filter silently became a display-layer dependency, and anything
it rejected disappeared from the UI.

**Rule:** a value narrowed for a security boundary is not a general-purpose
value. If the UI needs the original, keep the original somewhere the boundary
does not touch.

## The distinction the fix had to preserve

`upload-queue.ts` strips the extension in four places, and only one was wrong.
The three converted branches (`.xlsx` -> sheet, `.docx` -> doc, `.pptx` ->
slides) *should* strip: an imported spreadsheet is a native document named
"Budget", not "Budget.xlsx". Only the blob branch is the file itself. A
find-and-replace on `stripExt` would have broken three correct call sites.

**Rule:** when the same helper is called from several places, establish what
each call means before changing any of them. Identical code is not identical
intent.

## Production cannot verify a fix to production's own build

The instinct was to re-run the failing round trip where it failed. That is
impossible here: production runs v0.6.3, which *is* the build being changed.
The honest options were a local full stack or waiting for the next release.

A local stack was worth standing up rather than resting on unit tests —
`generic-file-upload` shipped with its manual round trip skipped for lack of a
database, and the defects fixed here are exactly what that skip hid. The unit
tests all passed against the old behavior too; only the real round trip showed
`wb063-test.c++` coming back as `wb063-test`.

**Rule:** "verify in production" is not available for a change to the
production build. Stand up the stack, or say plainly that it is unverified —
do not quietly substitute unit tests and call it end-to-end.

## Checklists do not tick themselves truthfully

A blanket `sed` marking every box done also marked "re-run the production round
trip" (it was local) and "self code review" (not run) as complete. Two releases
earlier in this same session, unticked and wrongly-ticked boxes had already
caused two separate errors.

**Rule:** bulk-tick only the items already verified, then read the rest back
one at a time. A checklist that is edited faster than it is checked is
decoration.

## Changing a value's shape means auditing everyone who reads it

Titles never carried an extension, so every consumer was written against that
assumption — and one of them had a *second*, guessing fallback the server side
does not: a MIME→extension map in `download-file.ts`. Harmless while titles were
bare; with an extension present it could disagree and double, turning
`photo.jpeg` into `photo.jpeg.jpg` because `image/jpeg` maps to `jpg`.

Every test still passed. It surfaced only from re-reading the diff and asking
who else consumes this value, then reproducing it as a failing test.

**Rule:** when you change what a field contains, grep its readers before
calling the change done. A green suite proves the readers were not tested for
the new shape, not that they handle it.

## The docs gap was bigger than the reported one

The ask was to document `--folder`. The docs site had no `files` section at
all — the namespace shipped in #703 without one, so the new flag would have
been documented into a page that never mentioned the command.

**Rule:** before adding a line to a doc, check the surrounding section exists
and is current. A feature-sized hole often sits next to the sentence you were
sent to write.
