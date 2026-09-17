# Sheets: link every URL inside a cell, not just whole-cell URLs

## Problem

Sheets linkifies a cell only when its **entire** value is a bare URL
(`packages/sheets/src/view/url-detect.ts:18`, `/^https?:\/\/\S+$/i` — anchored,
interior whitespace rejected). Real sheets do not look like that.

Measured on a live document (a sprint-planning sheet shared for this task),
one screen of column H held **9 URLs and 2 of them were links**:

| Cell | URLs | Linked | Why not |
| ---- | ---- | ------ | ------- |
| H4   | 2    | 0      | a sentence precedes the URLs |
| H10  | 2    | 0      | `- 릴리즈노트:` / `- PR:` labels |
| H26  | 3    | 0      | `시제품 :` / `기획 필요사항 :` labels |
| H15  | 1    | 1      | value is the URL and nothing else |
| H17  | 1    | 1      | same |

The linked cells are the exception, not the rule.

Discoverability compounds it. The only way to open a link is Ctrl/Cmd+click
(`worksheet.ts:3509`); `handleMouseMove` (`worksheet.ts:3239-3403`) has no link
branch so the cursor never changes; and the shortcut is absent from
`shortcuts-catalog.ts`, so it never reaches the help sheet. The document above
is shared **view-only**, where a reader has no reason to guess a modifier.

## Approach

Render-time detection, widened from "the whole value" to "every URL span
inside the value". No model change, no CRDT change, no Yorkie schema change —
the same posture the current feature already took, extended to the shapes
people actually type.

`GridCanvas.render()` repaints the whole canvas every frame
(`gridcanvas.ts:181`), so the painter records each span's screen box into a
`Array<RenderedLink>` as it paints, and hover/click read that back
synchronously — `linkAt` scans it, `linksInCell` filters it by reference. Hit geometry is therefore *the same arithmetic that drew the
pixels*, not a reconstruction of it — the two cannot drift. It also deletes the
async `getCell` from the click path (`worksheet.ts:3505`): the map already
carries the URL.

Rejected alternatives are recorded in the design doc: a `Cell.link` field
(cannot express H10/H26, which is the actual complaint) and Google-style
per-character rich-text runs (needs an inline-run model inside every cell, and
the 10 MB Yorkie ceiling is counted in CRDT nodes).

## Scope

In:

- every URL span inside a cell value, including multi-line values
- `www.` and bare email addresses
- pointer cursor + hover card listing the cell's links (Open / Copy)
- plain click opens a link in read-only (share-link viewer) mode
- Ctrl/Cmd+click narrowed from the cell to the span under the pointer

Out (each is a follow-up, see the design doc's roadmap): a persisted
`Cell.link`, Ctrl+K and an insert dialog, editing/removing a link,
`HYPERLINK()`'s dropped URL, `<a href>` extraction on HTML paste,
xlsx `<hyperlink>` import.

## Decisions

- **Formula cells are linkified too.** Today they are excluded
  (`gridcanvas.ts:1604`, `cell?.f ? null`) to avoid mistaking a `HYPERLINK()`
  label for a URL — but a label that is not a URL never matches, so the guard
  buys nothing and costs `=A1&"/"&B1` and `=HYPERLINK("https://…")`.
- **Schemeless hostnames are NOT linkified**, unlike Docs
  (`packages/docs/src/view/url-detect.ts:13-16`, which prepends `https://`).
  `.sh` `.io` `.co` `.me` `.ai` are real TLDs *and* common file extensions, so
  `build.sh` would become a link. In prose a stray link is noise; in a cell the
  stray underline changes how the value reads.
- **Detection runs on the formatted string**, not the raw value. Today they
  disagree (`gridcanvas.ts:1596` formats, `:1604` detects on `rawData`), which
  is harmless for a whole-cell match and wrong the moment indices matter.

## Steps

- [x] `layout.ts`: extract `toLineStartX(align, textX, lineWidth)` — the
      alignment math is copy-pasted three times in `gridcanvas.ts`
      (`:1656-1666`, `:1688-1696`, `:1709-1717`)
- [x] `cell-links.ts`: `detectLinks(text)` (pure) + tests, fixtures taken from
      the H4/H10/H26 strings above and from the false positives named in
      Decisions
- [x] `cell-links.ts`: `layoutLinkBoxes(measure, …)` + tests against a fake
      measurer (precedent: `overlay-peer-labels.test.ts:4-17`)
- [x] `gridcanvas.ts`: paint per-span color + underline; build the box map;
      expose `linkAt(x, y)`
- [x] `worksheet.ts`: pointer cursor, span-precise Ctrl/Cmd+click, read-only
      plain click, `setOnLinkHover`; clear hover state in
      `handleScrollContainerMouseLeave` (`:3404`)
- [x] `spreadsheet.ts`: `onLinkHover` delegate
- [x] `SheetLinkPopover.tsx` + mount in `sheet-view.tsx` (follow
      `CommentPopover` + the flip/clamp pass at `sheet-view.tsx:1479-1550`;
      do **not** reuse `docs-link-popover.tsx` — client coords, and most of it
      is caret-based editing Sheets has no model for)
- [x] register the shortcut in `shortcuts-catalog.ts`
- [x] `pnpm verify:fast`
- [x] self review over the branch diff
- [x] design doc + `docs/design/README.md` index row

## Review

Shipped as designed, plus two blockers a review pass caught before the branch
left the machine. Both were in code the tests passed.

**The scan was quadratic.** The first implementation matched one alternation
whose address branch began `[A-Za-z0-9._%+-]+@`. On a long unbroken run of
those characters the engine consumed the run and backtracked one character per
position, at every start position: a 32 k-character cell took **~2.1 s per
pass**, measured. The cheap `includes('@') || includes('://')` reject does not
help — the pathological inputs contain both. Since detection runs per line, per
visible cell, per frame, one pasted token would have dropped every viewer of a
shared document to ~0.5 fps, read-only share links included. Replaced with a
linear index scanner (design §6); the four adversarial cases now run inside the
17 ms the whole suite takes, and they are asserted with a wall-clock bound so a
pattern-based rewrite fails the tests rather than the user.

**Hit boxes were clipped to the cell, not to what was painted.** With a freeze
the grid is drawn as four separately clipped quadrants, and without one the
headers are painted over the cells with no clip at all — so a link scrolled
behind a frozen pane or under a column header stayed hoverable and clickable
where nothing was drawn. The click guard does not cover the frozen pane, so in
read-only a plain click on a frozen cell could open a URL from a cell the
reader cannot see. The painter now records the region it clips to and every hit
box is intersected with it (design §7).

Smaller fixes from the same pass: the hover card outlived its engine on a tab
switch, survived a drag and a wheel scroll; keying the card on the span instead
of the cell made it strobe when crossing the text between two links in one
cell; `a.b@c.dhttps://…` invented a `mailto:` and ate the real link; a literal
`mailto:` was only half-underlined; a cell with both an explicit underline and
a link drew two strokes on the same pixels; a repeated URL produced duplicate
React keys; `lineWidth` was measured for every line whether or not anything
needed it; a read-only double-click opened two tabs.

**Verified in the browser**, not only in tests — the engine in the standalone
sheets playground, since it mounts the real `GridCanvas` with no auth:
labelled and multi-line URLs paint per span; `build.sh v0.2.3-rc.5
creators/26.09.1700` stays entirely plain; with two links in one cell, clicking
each opens that one and clicking the plain text between them opens nothing;
a bare address opens `mailto:`; the pointer turns only over a span, not over
the gap between two spans in the same cell. Glyphs are painted once — the
segment walk shows no double-drawn bolding.

### Second review round

A review of the *fixes* found that the linearity claim was still false and that
the bound introduced for it had changed behaviour:

- **The scanner was still quadratic, by its own route.** A scheme match
  consumes URL characters forward; when the result does not parse the scan
  resumes one character later and re-reads the same run, so
  `'https://['.repeat(4000)` measured **429 ms** — the original defect, reached
  differently. It survived because all four adversarial fixtures had been
  written against the *regex*, not against the scanner that replaced it.
  Bounded now by `MaxUrlLength`, with that shape added to the suite.
- **`MaxEmailLocal` truncated instead of rejecting.** `'x'.repeat(70) +
  '@b.com'` underlined from index 6 and opened a 64-character suffix of the
  local part. Both bounds now reject, because a truncated address and a
  truncated URL both still parse.
- **The email branch reintroduced the hazard §3 refuses for hostnames.**
  `image@2x.png`, `logo@3x.jpg` and `build@2.sh` all linkified, because
  `isHostname` accepts any two-letter alpha TLD and `.png`/`.sh` are both.
  Addresses now refuse a TLD that is a common file extension; `www.` is
  hostname-checked too (`www.x` was a link).
- **The hover card never appeared on merged or overflowing cells.** The
  pointer's cell and the painter's cell disagree there — a merged cell paints
  under its anchor's reference, overflowing text paints outside its own cell —
  so the cursor turned with no card behind it, on exactly the wide cells that
  hold several links. The card now takes its cell from the hit itself.
- **The clip threading had no test**, only the browser session below. Added
  `test/view/gridcanvas-links.test.ts`, driving `recordRenderedLink` and
  `linkAt` against a hand-built `this` the way `worksheet-mouse.test.ts` does.
  Mutation-checked: removing the `paintRegion` intersection fails 4 of its 10
  cases.

### CI round

`verify-self` failed on the linearity assertion itself: `expected 244.82 to be
less than 150`. Not a regression — the failing step is `Collect coverage
(sheets)`, so CI measures the scanner under v8 instrumentation on a slower
runner. Growth ratios at 4× input measured 1.0–3.9 locally (linear is ~4,
quadratic ~16), so the algorithm was fine and the assertion was wrong.

The wall-clock budget is replaced by a **growth-rate** assertion — measure at
*n* and *4n*, require the ratio to stay under 8 — which is what the test was
trying to say in the first place and survives instrumentation, because both
halves pay the same overhead. Mutation-checked: removing `MaxUrlLength` fails
it (388.8 ms against a 216.3 ms bound), and the whole suite passes under
`--coverage` locally.

### PR review round (CodeRabbit)

Six findings, all Minor; five applied, one declined.

- **Zoom-incorrect grid-boundary checks.** `x > RowHeaderWidth` compared CSS
  pixels against unzoomed constants, so at zoom 0.5 the leftmost 25 screen
  pixels of the grid — where column A is — failed the check, costing the
  hover fallback and the link-open branch. Extracted as `isInsideGrid`, which
  scales by zoom, with a test. (The checkbox branch below it has the same
  pre-existing flaw; left alone as out of scope.)
- **The card could show URLs that were gone.** `updateLinkHover` returned
  early when the cell reference was unchanged, so a collaborator editing the
  hovered cell left the old destinations on screen. Now compared by
  destination as well as by reference.
- **A refused clipboard write still showed the check mark.** `writeText` can
  reject — insecure origin, lost focus, cross-origin frame — and the `void`
  discarded it. The URL is deliberately not logged: it is cell content.
- **Two documents described a contract that did not ship** — the task doc
  still said `Map<Sref, LinkBox[]>`, and the design doc said `linkAt` scans
  one cell.
- **The design doc claimed "no test anywhere exercises `worksheet.ts` mouse
  handling".** False, and inherited from the subagent error this task's
  lessons file already records — the lesson was written and the sentence it
  came from was left standing. Replaced with the real remaining gap.

**Declined:** adding a keyboard command to open a link in the active cell.
It is a genuine gap and is listed below, but it needs a keybinding decision,
a catalog entry, host wiring and an answer to "which link, when the cell has
several" — a feature, not a review fix.

### Known limitations

- **Ctrl/Cmd+click no longer multi-selects a cell containing a URL.** The
  conflict predates this change but its reach grew: it used to cost only cells
  whose entire value was a URL, and now costs any cell with a URL substring —
  including the `- PR: https://…` columns this feature targets. Resolving it
  means moving the editor gesture (Google uses `Alt+Enter`), which is a
  separate decision.
- **Userinfo still reads as the host.** `https://good.com@evil.com` paints as
  written and opens `evil.com`. The hover card shows the real host, so the card
  is honest; the underline and the modifier-click are not. Pre-existing in
  kind, wider in reach.
- **The card is mouse-only.** There is no keyboard route to a link, and
  `role="dialog"` is not the right role for a non-modal hover card.
- **Nothing is persisted**, so a span stops being a link the moment the
  surrounding text changes, and nothing survives xlsx or CSV. That is the
  accepted cost of not touching the model; roadmap step 3 pays it off.
