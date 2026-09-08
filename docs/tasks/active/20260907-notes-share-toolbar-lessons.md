# Lessons — notes share-link toolbar (issue #1044)

## A "deliberate scope cut" comment is a dependency, not a decision

`SharedNotesLayout` kept a cramped 50/50 split on phones and the code said why:
demoting it would leave no preview, because the route mounts no toolbar. That
reasoning was correct and still produced the wrong surface — the fix was to
remove the premise (mount the toolbar), not to argue with the conclusion. Worth
reading recorded rationale as "what this depends on" rather than "what was
decided".

## The 7px divider was never 7px

The issue described the split divider as "7px wide … keeping the 7px visual".
The engine sets `width: 7px` with `padding: 0 3px` and
`background-clip: content-box`, and Tailwind's preflight puts
`box-sizing: border-box` on everything in the app — so the content box, and
with it the painted band, is **1px**. 7px was the hit area all along. The fix
therefore widens the box to 25px and keeps the 1px hairline, rather than
growing a band to 7px as the issue's wording implies. Inline styles in an
engine that renders inside a Tailwind app inherit preflight; the engine's own
numbers do not tell you what ships.

## Extraction was the cheapest route to a test

The verification asked for `SharedNotesLayout` coverage, but
`shared-document.tsx` statically imports `SheetView`, `DocsView`, `NotesView`,
the pdf viewer and three `setImageUrlResolver` seams — importing it into a
jsdom test pulls all four engines. Moving the one layout that grew real state
into its own module made the test a normal component test with a single
`vi.mock` of `notes-view`. Single-importer modules fold into the importing
chunk, so the extraction costs nothing at the chunk gate.

## Session-local means "read, never write"

An anonymous share-link visitor should still get their own vim keymap and blame
gutter, so the layout seeds state from `notes-settings`' readers and never
calls the writers. "Don't touch the user's preferences" is not the same as
"ignore them" — the workspace route makes the same distinction for a mode
picked on a phone.

## Raising a gate cap is not free — it costs auto-promotion

The chunk-count cap was bumped 228 -> 231 as unmeasured headroom, with the
reason string honestly saying so and pointing at CI as the measurement. CI then
measured **225** — under the 228 that was already there, so no bump was ever
needed.

The bump was not merely redundant. `harness.config.json` is on
`CI_DEFINING_PATHS` (`scripts/agent/checks.mjs`), so gate 1b of the ready gate
refused to promote the PR: with the branch supplying part of the CI definition,
a green CI run is evidence about the *branch's* gate rather than main's. Three
of four gates passed and the PR sat as a draft with a green panel and nobody
watching, because the one loosened knob was the gate that had to stay honest.

Rule: never widen a budget in the same change that has not measured it. Push
without the bump and let CI report the real number — if it genuinely does not
fit, bump it then, with the measurement in hand and the knowledge that a human
now has to promote the PR by hand.
