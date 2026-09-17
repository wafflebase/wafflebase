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
type LinkBox = { line: number; x: number; width: number; url: string };
// GridCanvas, rebuilt each render():
private linkBoxes: Map<Sref, LinkBox[]>;
public linkAt(x: number, y: number): string | null;
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
charset is RFC 3986's, and trailing `.,;:!?)]}` is trimmed — which is also what stops a
Korean particle (`https://example.com를`) and a wrapping paren from being
swallowed, since neither is in the charset. `isSafeUrl`
(`@wafflebase/core/url`) remains the final gate.

**Schemeless hostnames are refused**, and this is a deliberate divergence from
Docs, which prepends `https://` to them
(`packages/docs/src/view/url-detect.ts:13-16`). `.sh`, `.io`, `.co`, `.me` and
`.ai` are real TLDs and also ordinary file extensions, so a hostname rule
turns `build.sh` into a link. The asymmetry is the point: in prose a stray
link is noise the reader routes around, but a cell is data, and a stray
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
| Ctrl/Cmd+click a span | open that span's URL |
| Plain click, read-only | open the span's URL |
| Plain click, editable | select the cell (unchanged) |

Read-only is available as `this.readOnly` inside the worksheet mouse handler
(precedent: the checkbox guard at `worksheet.ts:3521`). Giving viewers the
plain click and editors the modifier follows the conflict each one actually
has: an editor clicks cells to select them all day, a viewer does not.

`handleMouseMove` is bound raw, with no throttle or rAF (`worksheet.ts:3239`),
but `linkAt` is a synchronous scan over the boxes of one cell, so it needs
none of the async staleness dance `updateValidationTooltip` uses. The new
hover state must be cleared in `handleScrollContainerMouseLeave` (`:3404`)
alongside the existing flags.

### 5. The hover card

A new `SheetLinkPopover` under
`packages/frontend/src/app/spreadsheet/components/`, listing every link in the
hovered cell with Open and Copy.

It follows `CommentPopover` — a plain absolutely-positioned div with manual
outside-click and Escape dismissal — and reuses the flip/clamp measurement
pass at `sheet-view.tsx:1479-1550`, which composes `getGridViewportRect()`
with `getCellRect()` into **container-relative** coordinates.

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
forward, and it reads a bare address by expanding outwards from an `@` with the
local part bounded by RFC 5321's 64-character ceiling — which is what keeps the
work per `@` constant rather than linear. Hostname shape is checked with string
operations for the same reason: `(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}` reintroduces
the nested quantifier the scanner exists to avoid.

Scanning left to right also removes a defect the alternation had: in
`a.b@c.dhttps://real.example.com` the address branch matched `a.b@c.dhttps`,
inventing a `mailto:` to a domain nobody typed *and* eating the scheme of the
real link behind it. The scanner refuses an address followed by `://`.

`test/…/cell-links.test.ts` holds the adversarial inputs with a wall-clock
bound, so a future pattern-based rewrite fails the suite rather than the user.

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
taking a measure function — makes both directly testable without jsdom, which
matters because **no test anywhere exercises `worksheet.ts` mouse handling**.

`detectLinks` fixtures are taken from the real cells that motivated the work,
and from the false positives named in §3.

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
