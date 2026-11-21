# Slide Lint: Density and Composition Rules — Lessons

## Seed templates set the warning threshold for `empty-region`

The first cut warned from 60% of the safe area empty. Over the 125 seed
slides that warned on 12 slides — every one a `title-two-columns`
skeleton whose short "—" placeholder lists end ~60% of the way up. Those
are sparse by design (a template waiting for content), so they stay
`info` and the warning starts at 70%: less than a third of the usable
height holding anything. Final seed counts: `empty-region` 14 info,
`token-wrap` 0, `inset-inconsistent` 0 — the seed lint gate needed no
baseline entries.

## Read wraps off the layout, not a second line breaker

The docs layout breaks after a space (the space stays on the earlier
line), at a style change between inlines even without a space, and
character by character for a word wider than the line. Joining each
line's runs gives back the block text with the line-start offsets, so
`token-wrap` only has to ask whether an offset falls strictly inside a
token. A line ending in `\n` is an explicit break and is skipped.

## Insets are only comparable where the layout pins the text

Middle- or bottom-anchored text moves with its amount and centered text
with its width, so their insets differ by design. `inset-inconsistent`
compares the top inset only for top-anchored text and the left inset only
for left-aligned text; with two cards the larger value is the reference,
so the cramped card is the one reported.

## Self review

Not run as a separate reviewer loop in this session (no review agent
available to this worker); the branch diff was re-read once by hand
against the rule docs and tests.
