# Lessons — caret lineAffinity round-trip (#933)

## Two homes is why the field kept getting dropped

`Cursor` stored the affinity in a sibling field (`Cursor.lineAffinity`) while
every consumer downstream — presence, history, selection endpoints, peer
rendering — reads a `DocPosition`. Anything that passed `cursor.position`
along therefore lost the affinity *silently*, and three independent sites had
already done so. Collapsing the field into `position.lineAffinity` behind an
accessor pair kept all ~20 existing read/write sites compiling while making
the drop impossible: there is nothing left to forget to copy.

## A hardcoded default is invisible; a fallback is not

`resolvePositionPixel(pos, 'backward', …)` looks deliberate at every call
site, so nobody notices the position was already carrying a better answer.
Making the parameter optional with a `position.lineAffinity ?? 'backward'`
fallback means a call site that says nothing gets the right reading, and one
that hardcodes a literal is now visibly overriding the position.

## Materializing the default changes the observable shape

Once `Cursor.position` always carries an affinity, `_getCursorForTest()` and
`activeCursorPos` gain a `lineAffinity: 'backward'` key on positions that
previously had none — one existing `toEqual` assertion had to be updated.
That is the flip side of PR #930's lesson (an own `lineAffinity: undefined`
broke `deepStrictEqual`): resolve paths still *spread* the key so a
non-caret position round-trips to exactly its prior shape, and only the
caret itself materializes it.

## The test gap was structural

No docs test constructed a `TextEditor`, so keyboard-derived affinity had no
coverage at all and could not have. The jsdom canvas shim in
`editor-on-cursor-move.test.ts` already makes `initialize()` viable; from
there the hidden textarea is reachable via `container.querySelector` and
keydown events drive the real handlers. `getPeerCursorPixels()` exposes the
resolved peer caret pixels, which is what lets a test compare a peer's caret
against their own highlight instead of re-asserting the implementation.
