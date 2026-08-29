# Lessons — surfacing shipped Docs capabilities

## "The store setter already exists" is not the same as "the API already exists"

`DocStore.setPageSetup` has been complete since pagination landed, and it was
tempting to read that as "the dialog just calls the store". It cannot. A
page-setup write is five things, not one — `docStore.snapshot()` (or the
change is not undoable), the store write, `doc.refresh()`, dropping the
cached layout so `paginateLayout` reruns against the new paper box, and a
repaint. All five were already sitting inside the ruler's `onMarginChange`
handler, which is the only caller that ever wrote a page setup.

So the useful move was not "add an API method" but "notice there was already
exactly one correct sequence and give it a name". `writePageSetup` is now that
name; the ruler and `EditorAPI.setPageSetup` both go through it, and a future
third caller cannot get four of the five steps right.

The same shape appeared in the format painter: the buffer was written inline
in two `switch` cases in `handleKeyDown`, so a toolbar button could not touch
it without duplicating the logic. Lifting the two case bodies into
`copyFormat()` / `pasteFormat()` left the shortcuts calling the same methods
the toolbar does — the button is provably not a second implementation, and
the paste path kept its exact prior behaviour (including *not* clearing the
buffer) because it is literally the same code.

## Mirror engine state; do not shadow it

The toolbar toggle's lit state is read back with `hasCopiedFormat()` on every
`onCopiedFormatChange()` notification, never tracked in React state alongside
a "we clicked it" flag. That is what makes `Mod+Shift+C` light the button:
the keyboard writes the buffer, the buffer notifies, the button re-reads. A
locally-tracked boolean would have been simpler to write and silently wrong
the first time anyone used the shortcut. The shipped slides
`FormatPainterButton` had already solved this the same way — worth reading a
sibling before inventing.

`clearCopiedFormat()` deliberately does *not* notify when nothing was held.
Without that guard, the toggle's own "off" transition (which calls
`pasteFormat()` then `clearCopiedFormat()`) fires a redundant notification and
a second render; more importantly, a no-op release announcing a change is a
lie the next listener would have to work around.

## Units are a UI decision, not a model one

`PageSetup` stores CSS px at 96 dpi. Showing px in the dialog would have been
"honest" and useless — nobody sets a 96-pixel margin. Inches convert exactly
(×96), so the model is untouched and the conversion only rounds for display.
The one thing this genuinely costs: an imported DOCX with a 97 px margin
displays as 1.01 in and re-applies as 97 px, so the round-trip is stable at
the granularity the user can actually express.

The validation had to be measured against the *effective* page box —
orientation swaps width and height — or 5 in + 5 in margins would be rejected
on a landscape Letter that has 11 in of width. Checking against the stored
setup instead of the pending one is the easy version of this bug.

## Assert against the code, not against what the helper is named

Three assertions in the first draft of the export test were wrong because
`safeFilename` does less than its name suggests: it lowercases only for the
extension comparison, not the filename, and `"///"` collapses to `"_"` rather
than the `"document"` fallback (a single `_` is truthy). The tests were fixed
to describe the shipped behaviour — and the fallback case rewritten to use
the empty title, which is the input that actually reaches the fallback. Had
they been written to the guess, they would have been three false failures
attributed to this change.

## Where the frontend test idiom already is

`packages/frontend/tests/` carries two established styles and both are fine:
`@testing-library/react` `render`/`fireEvent` (see
`docs-formatting-toolbar-header-footer.test.tsx`) for plain buttons and
dialogs, and a hand-rolled `createRoot` + a full
`pointerdown → pointerup → click` sequence for Radix menus, which do **not**
open on a synthetic `.click()` in jsdom (documented in
`line-spacing-picker.test.ts`). Radix `Dialog` and `RadioGroup` need neither
dance; only the dropdown does. No `jest-dom` matchers are installed, so
`toBeDisabled()` is a Chai error — read `.disabled` instead.
