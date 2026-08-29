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

## A safety gate must inspect the bytes it emits

The `href` gate looked right and was not: `isSafeUrl` runs `new URL()`, whose
first act is to strip every tab, LF and CR and trim leading/trailing
C0-or-space. Validating the normalized form and then writing the *raw* one is
a parser differential, and in a delimiter-based format like Markdown the
stripped characters are exactly the ones that break out of the delimiter.

Two ways to close it: emit the normalized string (validated == emitted by
construction), or refuse the characters that differ. The second was chosen —
normalizing percent-encodes every non-ASCII path, which would turn a readable
Korean URL into `%ED%95%9C…` in every export, and refusing also catches a
plain space, which `new URL()` percent-encodes rather than strips but which
still terminates a CommonMark link destination.

Generalization: whenever a validator parses and the writer does not, ask what
the parser silently changed. That gap is the vulnerability.

## A copy-semantics test that compares against the shared constant is vacuous

`expect(editor.getPageSetup()).toEqual(DEFAULT_PAGE_SETUP)` after mutating the
returned object passes *whether or not* the value is aliased — under aliasing
the mutation lands on the constant too, so both sides move together. The test
has to read a fresh value and compare it with literals, and separately assert
the module constant is intact. Verified by mutating `getPageSetup` to return
`doc.document.pageSetup ?? DEFAULT_PAGE_SETUP`: the old assertion survives it,
the new one dies.

## "One undo step" needs a floor beneath it

Asserting that one `undo()` reverts the change cannot distinguish one snapshot
from two — both capture the same pre-write state, so the first undo restores
it either way. The test needs a *preceding, distinguishable* edit and a second
`undo()` that must reach it. Mutation-checked by adding a second
`saveSnapshot()` to `pasteFormat`.

## Radix `Select` is testable in jsdom

Unlike `DropdownMenu` (which needs the full `pointerdown → pointerup → click`
sequence), `Select` opens on `fireEvent.keyDown(trigger, { key: 'ArrowDown' })`
and commits on a plain `fireEvent.click` of the `option`. The closed trigger
renders the selected item's label as its text content, so the seeded value is
readable without opening anything. No extra jsdom shim beyond the
`ResizeObserver` already in `tests/setup.ts`.

## State an invariant on the write path, not once per caller

The "margins must leave room for content" rule existed twice — in the ruler's
drag handler (20 px of slack) and in the Page Setup dialog (`>= pageWidth`) —
and nowhere on `writePageSetup`, the single function both go through. A public
`EditorAPI.setPageSetup` bypassed both. Two callers respecting a rule is not
the rule being enforced.

## A protocol allowlist cannot judge a URL that has no protocol

The round-2 `href`/`src` gate was `isSafeUrl`, which is `new URL(href)` with no
base — so it throws on every relative reference and answers `false`. The gate
did close the `javascript:` hole, and it also silently dropped `/uploads/x.png`
(what the app's own upload path writes) and `#anchor` (what HTML paste carries)
out of every export. A security control that rejects the safe majority is not a
stricter control, it is a functional regression with a security-shaped
justification.

The fix splits the question the way URL grammar already does: a reference that
matches RFC 3986's `scheme` rule must clear the allowlist; one that does not
carries no scheme and so cannot select a dangerous one. The one trap is that
"no scheme" is not the same as "no authority" — `//host/x` keeps the reader's
scheme and swaps the origin, and the WHATWG parser folds `\` into `/`, so
`\\host/x` and `/\host/x` mean the same thing. Those three spellings are the
only relative-looking references that must still be refused.

## Fix a field, then look at its siblings

`href` and `alt` reach the model from the same untrusted sources — clipboard
JSON paste, `insertImage`, DOCX/HTML import, a peer's CRDT write — and sit in
the same `![...](...)` construct. Round 2 hardened one and left the other
escaping `\` and `]` only, so a blank line in an `alt` still closed the image
and landed raw HTML in the export. When a gate is added to one field, the
question to ask immediately is which other fields share its provenance and its
delimiter.

Line breaks are the part no backslash escape reaches: `\n` cannot be escaped in
Markdown, only removed. Folding them to a space is safe here precisely because
the block joiner builds its own `\n` / `\n\n` separators from *rendered blocks*
and never from run text — so nothing structural depends on a newline surviving
inside a run.

## Validate where untrusted data enters, not only where your own API writes

`assertUsablePageSetup` guarded `writePageSetup`, the one path the team's own
UI uses. Hostile geometry does not use it: a `.docx` parses `<w:sectPr>` with
`parseInt` (`NaN` for garbage, negatives verbatim) and stores the result
through `setDocument`, and a collaborator's CRDT write reaches
`document.pageSetup` with no local check at all. The guard's own comment named
the stake — "persisted into the CRDT for every collaborator" — which is exactly
what import still did.

Two different answers were right for the two paths:

- **Import** is a parser, so it refuses at the boundary: a `<w:sectPr>` length
  that is not finite and positive is dropped in favour of the default, rather
  than carried into the model.
- **Read** is data we do not control, so it clamps. `resolvePageSetup` is the
  one function every consumer (editor, ruler, `MemDocStore`, `YorkieDocStore`,
  CLI pagination, PDF export) already calls, and throwing there would let a
  remote peer make a document un-openable on this replica. The deliberate write
  path still throws, so a caller that *can* be told it passed nonsense still is.

Margins that merely exceed the page are scaled proportionally rather than reset,
so a document whose author chose a ratio keeps it.

## A jest moduleNameMapper gap can hide behind a built `dist`

`packages/backend` maps `@wafflebase/docs` to the docs *source* entry, which now
transitively imports `@wafflebase/core/url` — a subpath with no mapping. The
suite still passed, because `packages/core/dist` happened to be built and
resolution fell through to it. Moving `dist` aside made the real failure appear
(`Cannot find module '@wafflebase/core/url'`), which is also what a clean CI
checkout ordering would have produced. Proving such a mapping is load-bearing
means removing the thing that was masking it, not just watching the suite stay
green.

## Gate the string the consumer resolves, not the bytes you wrote

The export URL gate was rewritten three times and the first two rewrites shared
one mistake: they reasoned about the *raw* `href` while the thing that resolves
it rewrites the string first. Round 3's rule — "a reference with no scheme
cannot select a dangerous protocol" — is true of the bytes and false of the
consumer, because a CommonMark renderer strips a `<…>` wrapper, decodes HTML
entity references, and resolves backslash escapes *before* any URL parser sees
the destination. So `<javascript:alert(1)>` and `&#106;avascript:alert(1)` both
carry "no scheme" right up to the moment they do.

The general shape of the bug: **a validator and its consumer disagreeing about
what the string is.** Round 2 already hit it once at the URL-parser layer
(`new URL()` deletes tabs/CR/LF before reading the scheme) and closed it for
that one parser. The lesson only generalized on the third try — every layer
between the model and the click is another rewriter, and each one needs the
same question asked of it.

What finally worked was inverting the direction of the rule. Instead of
enumerating transforms to block, require the destination to be one that has no
transform to apply — an allowlist of RFC 3986 URI characters, which excludes
`<`, `>` and `\` *without naming them*, because none of the three was ever a
URI character. The one admitted character that still starts a decoder (`&`, which
a query string genuinely needs) gets a single context rule. Payload-by-payload
patching would have missed the next spelling; the allowlist has no "next
spelling".

Corollary worth keeping: an allowlist regex is easy to get catastrophically
wrong in a way that still looks right. Writing the non-ASCII tail as `%-￿`
made a *range* starting at `%` (U+0025) that silently re-admitted `<`, `>` and
`\` — i.e. the exact characters the class existed to exclude. The tests caught
it; reading the regex did not.

## "Single read path" is a claim about callers, and callers drift

`resolvePageSetup`'s docstring named itself the one read path "including PDF
export" while `PdfExporter` and `DocxExporter` both still read `doc.pageSetup`
raw. Combined with `YorkieDocStore.readPageSetup`'s `Number(undefined)` → `NaN`,
the Export menu could write `<w:pgSz w:w="NaN"/>` into a `.docx` (silently) and
hand NaN to pdf-lib's `addPage` (an opaque `TypeError`).

A docstring that lists its callers is a claim no compiler checks. When code and
doc disagree the fix is not to soften the doc — it is to decide which one is
right and make the other match. Here the doc was right about the design and
wrong about the world, so the exporters moved.

Related: an assert and a clamp guarding the same invariant must share the
number. `assertUsablePageSetup` refused a *closed* box while `resolvePageSetup`
clamped to a 1-px minimum, so geometry in the sub-pixel band passed the assert
and was then silently rescaled by the resolver the write path calls — precisely
the substitution the assert's comment promised never happened. One exported
`MIN_CONTENT_PX` now backs both.

## Check an invariant before writing a comment that asserts it

The Markdown serializer folds line separators to a space, justified by "the
model puts a paragraph break in a new block, never inside a run". That is false:
`\n` inside a run is this model's *soft line break*, implemented as a
first-class `MeasuredSegment.softBreak` in the layout engine and produced by
DOCX `<w:br/>`, PPTX `<a:br>`, and an HTML `<br>` pasted into a table cell.

The fold survived review anyway, because it is right for a reason the comment
had not found: a space is what GFM renders a soft break as, so the transform is
a faithful lossy mapping *and* a neutralization of the injection case. Being
accidentally correct is not the same as being justified, and the next person to
touch it would have inherited the false premise.
