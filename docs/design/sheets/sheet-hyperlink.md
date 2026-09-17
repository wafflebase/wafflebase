---
title: sheet-hyperlink
target-version: 0.6.12
---

# Sheet Hyperlinks

## Summary

A Sheets cell becomes a link only when its **entire** value is a bare URL. The
detector was anchored and rejected interior whitespace (`url-detect.ts`, which
this change deletes in favour of `cell-links.ts`), so a labelled URL
(`- PR: https://…`) or a cell holding two of them stays plain text. On one
screen of a real sprint-planning sheet, 9 URLs produced 2 links.

This document widens detection from *the whole value* to *every URL span
inside the value*, keeps it render-time (no model, CRDT or schema change), and
adds the hover affordance the feature has never had. It also records why the
two obvious "real" designs — a `Cell.link` field, and Google's per-character
rich-text runs — are not what Sheets should build first.

## Goals / Non-Goals

**Goals**

- Link every URL inside a cell value, including multi-line values.
- Make links visible: pointer cursor, and a hover card with Open / Copy.
- Make links openable by a share-link viewer, who cannot be expected to guess
  a modifier key.
- Narrow Ctrl/Cmd+click from "the cell" to "the span under the pointer".
- Leave the Store model, the Yorkie schema and the xlsx paths untouched.

**Non-Goals** (each is a follow-up; see [Roadmap](#roadmap))

- A persisted link (`Cell.link`), and with it display text that differs from
  the URL.
- Ctrl+K, an insert-link dialog, editing or removing a link.
- Fixing `HYPERLINK()`, which discards its `url` argument and returns only the
  label (`packages/sheets/src/formula/functions-lookup.ts:930-937`).
- `<a href>` extraction on HTML paste (`grids.ts:177` reads `textContent`) and
  `<hyperlink>` on xlsx import.
- Smart chips.

## Proposal Details

### 1. Why render-time, and not a link model

Three designs were compared.

| | Storage | Two links in one cell | Display text ≠ URL | xlsx round-trip | Cost |
| --- | --- | --- | --- | --- | --- |
| **A. `Cell.link?: string`** (Excel) | one field | ✗ | ✓ | ✓ 1:1 with `<hyperlink>` | low |
| **B. rich-text runs** (Google `textFormatRuns`) | run array per cell | ✓ | ✓ | ✗ lossy | high |
| **C. render-time spans** (this doc) | none | ✓ | ✗ | n/a | low |

A cannot express the complaint. The cells that motivated this work — a
`- 릴리즈노트:` line and a `- PR:` line in one cell — hold two links, and a
single field holds one.

B can, and it is what Google does: `CellData.textFormatRuns[].format.link`,
confirmed by `CellData.hyperlink` being documented as empty when a cell has
several. Two things argue against it here. Sheets has no inline-run model —
a cell value is one string, and every renderer, the in-cell editor, autofit
and the clipboard assume that — so B means porting the Docs text engine into
the cell. And the Yorkie 10 MB ceiling is counted in **CRDT nodes**, not
bytes (the constraint that shaped xlsx style import); a run array per cell
pushes directly against it.

Note what B would not buy either: **XLSX cannot express it.** SpreadsheetML
has exactly one hyperlink mechanism, a worksheet-level `<hyperlink ref="A11">`
keyed by cell reference. Its rich-text runs (`<r><rPr>…`) carry no link
property — unlike WordprocessingML and DrawingML, where a run holds
`<a:hlinkClick>`. So per-run links are structurally inexpressible in xlsx, and
Google's own export drops all but the first link in a cell. "Several links per
cell" and "lossless xlsx" cannot both be had.

C gets the multi-link behaviour for free by not storing anything, and it
composes with A rather than blocking it: when a persisted link lands, span
detection stays as the fallback for cells that carry none — which is exactly
how Google layers auto-linkification under explicit links.

### 2. Geometry comes from the paint, not from a reconstruction of it

`GridCanvas.render()` resets `canvas.width` and repaints the whole grid every
frame (`gridcanvas.ts:181`); there is no partial or dirty-region path. So the
painter is already visiting every visible cell with the right font, alignment,
scroll offset, zoom, freeze split, merge span and overflow clip in hand.

It therefore records what it drew:

```ts
type RenderedLink = {
  sref: string;
  left: number; top: number; width: number; height: number;
  url: string;
};
// GridCanvas, rebuilt each render():
private renderedLinks: Array<RenderedLink>;
public linkAt(x: number, y: number): RenderedLink | null;
public linksInCell(sref: string): Array<RenderedLink>;
```

Hover and click read that map with a synchronous rect test. Two consequences:

- Hit geometry **is** the arithmetic that produced the pixels, so "the
  underline is here but the click lands there" is not a reachable state.
- The click path loses its async cell read (`worksheet.ts:3505`), because the
  map already carries the URL. The feature gets simpler, not more complex.

The alignment math the spans need is currently copy-pasted three times inside
`gridcanvas.ts` (text origin `:1656-1666`, underline `:1688-1696`,
strikethrough `:1709-1717`). It moves to `layout.ts` as
`toLineStartX(align, textX, lineWidth)` — beside `getTextBlockHeight`, its
vertical counterpart, in the dependency-free module both the painter and the
hit-tester already import.

### 3. What counts as a link

Detection runs on the **formatted** string (`formatValue()`'s output), not the
raw value. Today the two disagree — `gridcanvas.ts:1596` paints the formatted
string while `:1604` detects on `rawData`. For a whole-cell match that is
harmless; the moment character indices address a substring it is wrong.

Accepted: `http://`, `https://`, `mailto:`, a `www.` prefix (normalized to
`https://`), and bare email addresses (also normalized to `mailto:`). The span
charset is RFC 3986's, and trailing `.,;:!?'` is trimmed along with any
closing bracket the span did not open — so a Wikipedia path (`/wiki/Foo_(bar)`)
survives while a parenthesised link gives its paren back to the sentence. A
Korean particle (`https://example.com를`) needs no rule at all, being outside
the charset. `isSafeUrl` (`@wafflebase/core/url`) remains the final gate.

The ASCII charset has one exception, and it is deliberately asymmetric: once
the URL has reached its **path**, a letter, digit or combining mark outside
ASCII continues the span. Without it, `https://wiki.example.com/x/기획문서`
stopped at the first Hangul syllable and linked `https://wiki.example.com/x/` —
a different destination that parses and passes `isSafeUrl`, which is the
truncated link this section refuses everywhere else. The authority is still
ASCII-only, which is what keeps an IDN homograph host (`https://аpple.com`,
Cyrillic а) out of a span, and the class is letters/digits/marks only, so the
guarantee that a span is the same string to `new URL()` as it is on screen
(`hasUrlAlteringChars`) still holds.

**Userinfo is refused outright.** `https://accounts.example.com@evil.example/`
paints as a host the reader recognises and navigates to one they do not, and
the plain-click path deliberately skips the hover card that shows the real
host, so nothing else is in a position to be honest about it. Three places say
no: the authority prefilter refuses a host terminated by `@`, `toUrl` refuses
any URL whose parsed form carries a username or password, and the address
scanner refuses an address written straight after a `/` so the refused tail is
not handed back as a `mailto:`.

**The scan's cost is bounded by a prefilter, not only by `MaxUrlLength`.**
The authority is checked from indices — bounded by the longest legal hostname —
*before* a candidate is sliced, trimmed and parsed, and the forward walk is
memoized per contiguous URL-character run. Order matters here: a length cap
alone fixes the asymptotics and leaves a ~400x constant factor, because
`'/www.'.repeat(n)` restarts a 2048-character walk-slice-trim-parse every five
characters — enough to stall the render loop for every viewer without changing
the curve's shape. Every shape that now reaches the expensive path goes on to
emit a span, so the scan skips past it instead of re-reading it.

A dotted quad must be in the URL Standard's canonical form: `010.000.000.001`
is refused, because `Number('010')` is 10 while the URL parser reads the part
as octal and resolves the host to `8.0.0.1`. Painting one host and opening
another is the same defect the userinfo rule refuses, reached by arithmetic
instead of syntax.

Two shape rules keep the accepted forms honest. A `www.` prefix is the one
accepted form carrying no scheme, so its host is checked for shape — `www.x` is
not a destination. And an **address** additionally refuses a TLD that is a
common file extension, because `isHostname` cannot tell a host ending in
".sh" from a filename ending in the same two letters: the argument below
about hostnames applies verbatim to the `@` form, where a retina asset name
reading as mail to its own extension is the common case.

**Schemeless hostnames are refused**, and this is a deliberate divergence from
Docs, which prepends `https://` to them
(`packages/docs/src/view/url-detect.ts:13-16`). `.sh`, `.io`, `.co`, `.me` and
`.ai` are real TLDs and also ordinary file extensions, so a hostname rule
turns a shell script's filename into a link. The asymmetry is the point: in
prose a stray link is noise the reader routes around, but a cell is data, and a stray
underline changes how the value reads — next to `v0.2.3-rc.5` and
`creators/26.09.1700`, a false positive is a correctness bug, not a cosmetic
one.

**Formula cells are included.** They are excluded today (`gridcanvas.ts:1604`,
`cell?.f ? null`) on the reasoning that `cell.v` is a computed result and
might be a `HYPERLINK()` label. But a label that is not a URL never matches
the detector, so the guard prevents nothing and costs the cases that do work:
`=A1&"/"&B1` and single-argument `=HYPERLINK("https://…")`.

### 4. Interaction

| Gesture | Result |
| --- | --- |
| Hover a span | pointer cursor immediately; hover card after ~300 ms |
| Cross the text between two spans in one cell | card stays open |
| Ctrl/Cmd+click a span | open that span's URL |
| Plain click, read-only document view | open the span's URL |
| Plain click, editable | select the cell (unchanged) |
| `Alt+Enter` | open every link in the **active cell** |
| Plain click, read-only *result grid* | select the cell (unchanged) |

The card is keyed on the **cell**, not on the span: the gap between two links
in one cell resolves to no span, so keying it on the span would close and
reopen the card while crossing ` and ` in `https://a.com and https://b.com`.
The cell comes from the hit itself (`RenderedLink.sref`) rather than from the
pointer's coordinates, because the two disagree exactly where it matters — a
merged cell paints under its anchor's reference, and overflowing text paints
outside its own cell — and those are the wide cells that hold several links.

`Alt+Enter` is the keyboard route, and the only one a viewer has — the card is
reachable by pointer alone. It is what Google Sheets binds, and it is free in
the *grid* keymap: the `Alt+Enter` that inserts a line break belongs to the
cell-input keymap, which a focused grid does not use. It opens every link in
the cell, as Google's does, because a cell holding a release note and a PR link
offers the keyboard no one link it could mean.

Read-only is available as `this.readOnly` inside the worksheet mouse handler
(precedent: the checkbox guard at `worksheet.ts:3521`). Giving viewers the
plain click and editors the modifier follows the conflict each one actually
has: an editor clicks cells to select them all day, a viewer does not.

`readOnly` alone is *not* the condition, though, because read-only is not one
kind of surface. Three other frontend mounts pass it — the datasource result
grid (`datasource-view.tsx`), the lakehouse result grid
(`lakehouse-view.tsx`), and the revision preview (`revision-preview.tsx`) —
and in all three the click is how you select a cell to read or copy it. So the
plain-click rule is an opt-in `Options.openLinksOnClick`, set only by
`SheetView`, which is also the only mount that wires the hover card. The
modifier is unconditional, so a link in a result grid is still reachable.

`handleMouseMove` is bound raw, with no throttle or rAF (`worksheet.ts:3239`),
but `linkAt` is a synchronous scan over the boxes currently on screen, so it
needs none of the async staleness dance `updateValidationTooltip` uses. The new
hover state must be cleared in `handleScrollContainerMouseLeave` (`:3404`)
alongside the existing flags.

### 5. The hover card

A new `SheetLinkPopover` under
`packages/frontend/src/app/spreadsheet/components/`, listing every link in the
hovered cell with Open and Copy.

It follows `CommentPopover`'s shape — a plain absolutely-positioned div rather
than a Radix portal — and reuses the flip/clamp measurement
pass at `sheet-view.tsx:1479-1550`, which composes `getGridViewportRect()`
with `getCellRect()` into **container-relative** coordinates. It needs no
outside-click or Escape handler of its own: unlike the comment popover it is
not opened by a click and owns no focus, so pointer-leave is the whole
lifecycle — with the close deferred so the pointer can cross the gap into it.

It does not reuse `docs-link-popover.tsx`. That component emits
**client/fixed** coordinates and has no flip or clamp at all; and of its 286
lines, most are `EditorAPI` caret-based insert/edit/remove, for which Sheets
has no stored link to operate on.

The engine gains its first hover callback — there is none today — as
`Worksheet.setOnLinkHover`, matching the existing single-slot setter pattern
(`setOnValidationError`, `setOnNotice`, `setOnRender`), delegated by
`Spreadsheet.onLinkHover`.

### 6. The scan has to be linear

Detection runs per line, per visible cell, per **frame**, so its cost is not a
micro-optimisation — it is a correctness property of the render loop.

The obvious implementation, one alternation with an unbounded prefix
(`[A-Za-z0-9._%+-]+@…`), is quadratic: on a long unbroken run of local-part
characters the engine consumes the run and backtracks one character per
position, at every start position. Measured on a 32 k-character cell, one pass
took **~2 s** — and a cheap "does this string contain `@` or `://`" reject does
not help, because the pathological inputs contain both. That is a shared
document freezing at ~0.5 fps for everyone who has the cell on screen, a
read-only share-link viewer included, triggered by any collaborator pasting a
long token or importing a CSV column.

So `detectLinks` is an index scanner, not a pattern match. It walks the string
once; at each position it tests for a scheme prefix (gated on the first
character, so the common case allocates nothing) and consumes URL characters
forward, and it reads a bare address by expanding outwards from an `@`.
Hostname shape is checked with string operations for the same reason:
`(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}` reintroduces the nested quantifier the
scanner exists to avoid.

**Both of the scanner's walks are bounded, and neither bound is cosmetic.** A
scanner is only linear if the work it does at each position is constant, and
each walk had its own way of not being:

- Expanding backwards from every `@` is quadratic on `('a'.repeat(k) + '@')`
  repeated. Bounded by RFC 5321's 64-character local part.
- Consuming forwards from a scheme is quadratic when the result does not
  parse, because the scan then resumes one character later and re-reads the
  same run — `'https://['.repeat(4000)` measured **429 ms**, which is the
  original defect reached by a different route and was missed because every
  adversarial fixture had been written against the *regex*. Bounded by
  `MaxUrlLength` (2048; Google's own limit on a link destination is 2000).

In both cases hitting the bound **rejects** rather than truncates. Truncating
is not the conservative choice it looks like: a 64-character suffix of a local
part still parses as an address, and a 2048-character prefix of a URL still
parses as a URL, so the cell would underline from the middle of a word and
navigate somewhere nobody typed.

Scanning left to right also removes a defect the alternation had: in
`a.b@c.dhttps://real.example.com` the address branch matched `a.b@c.dhttps`,
inventing a `mailto:` to a domain nobody typed *and* eating the scheme of the
real link behind it. The scanner refuses an address followed by `://`.

`cell-links.test.ts` holds the adversarial inputs and asserts the **growth
rate** — measured at *n* and *4n*, the ratio must stay near 4 rather than near
16 — so a future pattern-based rewrite fails the suite rather than the user. It
deliberately does not assert a wall-clock budget: CI runs this suite under v8
coverage instrumentation, and a budget fails on a slow runner and passes on a
fast one regardless of the algorithm, while both halves of a ratio pay the same
overhead.

### 7. Hit targets are bounded by what was painted, not by the cell

A cell's own rect is not the whole truth about where its text lands. With a
freeze the grid is drawn as four separately clipped quadrants; without one the
headers are painted **over** the cells afterwards, with no clip at all. A hit
box derived from the cell rect alone is therefore reachable where the text is
not: a column scrolled behind a frozen pane still has a rect inside the frozen
region, and row 1 scrolled half-way up still has a rect under the column
header.

That is worse than a cosmetic bug, because the click guard
(`x > RowHeaderWidth && y > DefaultCellHeight`) does not cover the frozen pane:
a read-only viewer plain-clicking a frozen cell would open a URL belonging to a
different cell they cannot see. So the painter records the region it is
clipping to (`clipToPaintRegion`) and every hit box is intersected with it as
well as with the cell.

### 8. Testing

Sheets view tests run in Vitest's default **node** environment
(`packages/sheets/vite.config.ts` sets no `environment`), and
`overlay-peer-labels.test.ts:4-17` establishes the pattern: a hand-rolled
canvas mock whose `measureText` returns `{ width: text.length * 7 }`. Keeping
`detectLinks` and `layoutLinkBoxes` pure — one taking a string, the other
taking a measure function — makes both directly testable without jsdom.

The same trick reaches the view classes: `worksheet-mouse.test.ts` already
drove `handleMouseMove` and `handleScrollContainerMouseLeave` against a
hand-built `this`, and `gridcanvas-links.test.ts` extends that to
`recordRenderedLink` and `linkAt`. What stays untested is the wiring between
them — that `render()` sets `paintRegion` correctly at each of its five call
sites, and the React popover's placement — because both need a DOM the suite
does not have.

`detectLinks` fixtures reproduce the shapes of the real cells that motivated
the work, with reserved hostnames, and the false positives named in §3.

### Roadmap

1. **This document** — span detection, hover card, viewer click.
2. `HYPERLINK()` stops discarding its URL. Independent of any model change,
   and the cheapest route to display text that differs from the URL.
3. `Cell.link?: string` + Ctrl+K + an insert/edit popover, reusing
   `insert-link-button.tsx` and the popover shipped in 1. Carries `<a href>`
   extraction on HTML paste and `<hyperlink>` on xlsx import, which become
   expressible only once a link is stored.

## Risks and Mitigation

- **False positives change how data reads.** Mitigated by requiring a scheme
  (§3) and by fixture tests over version strings, paths and filenames drawn
  from a real engineering sheet.
- **Per-frame cost.** Detection now scans for substrings on every visible
  cell's text each frame instead of failing fast on a `\s` test. Mitigated by
  a `includes('://') || includes('www.') || includes('@')` pre-check before
  the scan, so cells without links cost one substring search.
- **Links are still not persisted.** A span stops being a link the moment the
  text around it changes, nothing survives xlsx or CSV, and there is no
  display text. This is the accepted cost of not touching the model; step 3 of
  the roadmap is where it is paid off.
- **Hover on a dense cell.** A cell with several links yields several small
  targets. The card is what makes them reachable without precise aiming, which
  is why it is in this step rather than deferred.
