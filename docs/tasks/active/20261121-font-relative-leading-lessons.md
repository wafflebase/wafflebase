# Lessons: font-relative line spacing (Docs + Slides)

## Origin

A design review of the "Meeting Notes" template on wafflebase.io found body
text cramped compared with Google Docs. The named-style catalog already had
Google's values (Normal 1.15, H1 27/8 px), so the values were right and the
unit they were applied to was wrong: `multiplier × fontSize` is CSS leading,
while Word and Google Docs use `multiplier × the font's single line`.

## Pattern

`docs-named-styles.md` audited the size, colour and spacing values against
Google's own `styles.xml`, but its "line box (px)" column was computed with our
formula rather than measured in Google Docs. A value can match the other
product's value exactly and still render differently when the two products
read it with different semantics. Parity checks have to compare rendered
geometry, not only stored values.

## Correction from the user (2026-11-21)

The first plan scoped the change to Docs and deferred Slides to a follow-up to
avoid reflowing existing decks. The user asked for both. Rule: when a defect
lives in a shared engine (`computeLayout` is used by docs, slides and board),
plan the fix for every host that shows the defect, and handle each host's
migration risk inside the plan. Deferring a host is the user's call, not a
default way to shrink the risk.

## Step 0 measurements (2026-11-21, Chrome, 100% zoom, DPR 2)

Method: a new Google Docs document. Read the canvas pixels
(`.kix-canvas-tile-content`, `getImageData`) and take the top of the "L" that
starts every line, then compute the pitch over 4–5 lines. Google Slides
renders SVG, so there the method was `getScreenCTM()` of each line's `<text>`
over the screen font size.

### Google Docs

| Font | Size | Spacing | Pitch (CSS px) | Pitch / font px | Single ratio |
| --- | --- | --- | --- | --- | --- |
| Arial | 11 pt | 1.15 (default) | 19.25 | 1.3125 | 1.141 |
| Arial | 11 pt | Single | 16.625 | 1.1335 | 1.134 |
| Arial | 11 pt | Double | 33.5 | 2.284 | 1.142 |
| Arial | 72 pt | Single | 110.2 | 1.148 | **1.148** |
| Roboto | 72 pt | Single | 115.25 | 1.2005 | **1.2005** |
| Nanum Gothic | 72 pt | Single | 156.0 | 1.625 | **1.625** |
| Arial + Hangul (fallback glyphs) | 72 pt | Single | 110.2 | 1.148 | 1.148 |

The 11 pt rows carry ±1 device px of rounding; the 72 pt rows are the precise
ones. Font-file metrics (fontkit):

| Font | hhea asc/desc/gap | win asc/desc | hhea ratio | win ratio | typo ratio |
| --- | --- | --- | --- | --- | --- |
| Arial (macOS) | 1854/−434/67 | 1854/434 | 1.1499 | 1.1172 | 1.0884 |
| Roboto v48 | 1900/−500/0 | 1946/512 | 1.1719 | 1.2002 | 1.0498 |
| Nanum Gothic v26 | 844/−156/0 | 885/198 | 1.0000 | 1.0830 | 1.2500 |

- First hypothesis (two Latin fonts): `max(winAscent + winDescent, hhea
  asc − desc + gap) / upm`, GDI's `tmHeight + tmExternalLeading`. It fit
  Arial and Roboto **and was wrong**. See the second round below.
- **The line ratio follows the run's declared family, not the glyph that
  painted.** Hangul typed in an Arial run kept Arial's 1.148.
- **Glyph placement:** at 11 pt the first line's ink top did not move between
  Single, 1.15 and Double. The extra leading goes **below** the text.

### Google Docs, second round (same day, 72 pt Single)

| Font | Measured | hhea (+gap) | typo (+gap) | win | useTypo | Fits "normal" (×1.3 CJK) |
| --- | --- | --- | --- | --- | --- | --- |
| Open Sans | 1.3611 | 1.3618 | 1.3618 | 1.4419 | yes | ✓ (GDI max says 1.4419 ✗) |
| Georgia | 1.1372 | 1.1362 | 1.0698 | 1.1362 | no | ✓ |
| Montserrat | 1.2188 | 1.2190 | 1.2190 | 1.5620 | yes | ✓ |
| Merriweather | 1.2569 | 1.2570 | 1.2570 | 1.7320 | yes | ✓ |
| Noto Sans KR | 1.8837 | 1.4480 | 1.0000 | 1.4480 | no | ✓ 1.3 × 1.448 = 1.8824 |
| Gothic A1 | 1.625 | 1.25 | 1.25 | 1.5781 | yes | ✓ 1.3 × 1.25 |
| Nanum Myeongjo | 1.625 | 1.25 | 1.25 | 1.1514 | yes | ✓ 1.3 × 1.25 |
| Nanum Gothic | 1.625 | 1.00 | 1.25 | 1.0830 | yes | ✓ 1.3 × 1.25 |
| Arial | 1.148 | 1.1499 | 1.0884 | 1.1172 | no | ✓ |
| Roboto | 1.2005 | 1.1719 | 1.0498 | 1.2002 | no | ✗ (Docs serves its own build) |

- **Rule:** single line = the browser's *normal* line height (typo metrics
  when `USE_TYPO_METRICS` is set, else hhea, both including the line gap),
  ×1.3 for CJK fonts. Nine of ten match within 0.003 em. Roboto is a measured
  override.
- **Baseline:** `above = lineGap + ascent + (single − normal) / 2`, so a CJK
  font's extra is split evenly. Fitted from the cap tops against each font's
  cap height: Latin within 0.003 em, CJK within 0.004 em. Nanum Gothic is off
  by 0.043 em, because its `OS/2` cap height disagrees with its glyphs.
- Google Docs loads its own `docs-<Family>` FontFace builds. CSS `line-height:
  normal` of those builds in the page equals the measured pitch for Arial and
  Open Sans but not for Roboto, which is why one override is needed.

### Pattern: two data points fit a wrong formula

The GDI formula matched both fonts in round one and was then contradicted by
Open Sans. A rule taken from another product needs a data point chosen to
*break* it (a font whose metric families disagree) before it is built on.

### Google Slides

| Font | Spacing | Pitch / font px | Single ratio |
| --- | --- | --- | --- |
| Arial | Custom 0.8 (Simple Light subtitle default) | 0.9600 | **1.2000** |
| Arial | Double | 2.4000 | **1.2000** |
| Roboto | Double | 2.4000 | **1.2000** |

Google Slides' single line is **1.2 × font size whatever the font**, which is
PowerPoint's rule too (our PPTX importer already hardcodes
`PPTX_SINGLE_LINE_HEIGHT = 1.2` for that reason). Nanum Gothic was not
re-measured in Slides because the font menu reordered under the click.

### Artifacts

Two scratch files were created in the user's Google Drive: "Untitled
document" and "Untitled presentation" (2026-11-21). They can be deleted.

## Self-review (PR 1)

- Round 1 — 6 blocking (correctness ×2, security, test-adequacy,
  blast-radius ×2), all fixed: the metrics table moved into a `Map`
  (a `constructor`/`__proto__` family resolved through `Object.prototype`
  and threw on every layout pass); spacing under 1.0 now squeezes the
  baseline with the text box (a CJK `above` exceeds the 1.0 em floor);
  cell banding drops a non-finite or out-of-box `baseline`; a PDF test
  pins the font-relative baseline; and decorations hang from a new
  `LayoutLine.textHeight` (carried on `LineRect`) instead of the line-box
  bottom. Selection and find highlights still cover the whole line.
  Lesson: a new per-line field inherits every invariant the old one had
  (here the banding of untrusted geometry). Grep for the old field's
  guards before adding a sibling.
- Round 2 — panel: 2 blocking (correctness: the metrics lookup skipped the
  painter's alias/suffix resolution, so `'Gothic A1 Bold'` and `'맑은 고딕'`
  sized as Arial; blast-radius: the second, sum-overflow pass of cell
  banding reset heights but kept baselines). Both fixed: a shared
  `fontFamilyCandidates` in `fonts.ts` (no injected Korean fallback, so an
  unknown Latin family still takes Arial) behind a bounded memo, and the
  second pass clears baseline/text box. The independent code review
  (`requesting-code-review`) found two more the panel did not: inline
  images were still bottom-aligned to the line box, so they sank into the
  spacing below the text, and carets spanned the spacing too. Fixed with
  `lineContentBottom` at every image/caret site, and an image taller than
  the text keeps the spacing below it. Also fixed from that review: the
  layout cache key covers the metrics function's identity (PR 2 swaps
  functions on one cache), and a zero-height line from a host is guarded.
  Lesson: "every painter honours the new baseline" was checked; "every
  consumer of the line box bottom" was not. A geometry change needs both
  greps.
- Round 3 — did not run: four lenses hit `USAGE_LIMIT` (HTTP 429), and the
  correctness verifier errored on the one carried-forward finding (the
  alias lookup, already fixed in 00b9e0475). Not a clean round. A fourth
  round needs `--force` once quota returns.

## Browser lanes (PR 1)

`verify:browser:docker` visual lane: all goldens match after regeneration. The
hunt-oracles lane then failed intermittently, mostly on `slides drag` (badge
centre at (700, 718) instead of (700, 800)) and sometimes on board/slides
mount. Running only that lane three times on each side of the change:
branch 1 pass / 2 fail, `main` 1 pass / 2 fail, both with the identical
(700, 718). A pre-existing local flake (the image runs as linux/amd64 under
emulation on this arm64 host), not this change. Lesson: before attributing a
browser-lane failure to a branch, run the same lane repeatedly on `main`. One
green `main` run proves nothing about a flaky lane.
