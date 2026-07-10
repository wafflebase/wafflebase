# Lessons — PPTX layout background & placeholder geometry

## The visible symptom was two layers away from the root cause

"Slide 1's bottom gradient is missing" looked like a background-parsing
bug. It was really: (1) the deck has **multiple slide masters** and the
importer loaded only one (picked by nondeterministic rels-iteration order),
so slide 1's whole layout (`slideLayout1`) was never imported; and (2) even
once loaded, layout-level `<p:bg>` and placeholder frames weren't extracted.

**Lesson:** when a fix "should work" but doesn't, instrument the *actual*
pipeline (I appended per-iteration logs to the real loop) instead of
re-reasoning. The loop dump — `slideLayout10–21, never slideLayout1` —
exposed the multi-master truth in one run. Direct-call unit reproduction
(calling `parseLayout` on the real file) confirmed the parser was fine and
the bug was upstream in *which* master got loaded.

## Don't trust a coincidental "correct" value

slide 1's `layoutId` resolved to `title-body` — which *looked* right — but
only because `slideLayout1` has no `type` token (→ `title-body` fallback)
AND wasn't in `layoutMap` at all. A plausible-looking field masked a total
layout-resolution miss. Verify the *path* was resolved, not just that the
final value looks sensible.

## Collapsed identities can't carry per-instance data

Imported layouts collapse onto 11 built-in ids (many OOXML layouts → one
id), so keying a background/frame by built-in id is ambiguous (a white-solid
`title-body` layout won over the gradient one). Resolve per **exact layout
part path** and **bake onto the slide** at import time instead.

## Related: verify:fast doesn't need Docker; e2e proof used a local file

The end-to-end proof imported the user's actual `.pptx` from `~/Downloads`
via a `describe.skipIf` test — great for proving the fix, but not committed
(references an uncommitted local file; would just skip in CI). Committed
coverage is synthetic-fixture unit tests in `layout.test.ts` / `slide.test.ts`.

See also [[project_packages_consume_built_dist]] — tests here run against
`src` directly, so no rebuild was needed between edits.
