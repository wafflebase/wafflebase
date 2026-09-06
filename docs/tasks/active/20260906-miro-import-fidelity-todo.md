# Miro import fidelity — review findings

Reviewed against a **real** Miro board (`o9J_kidjCtk=`, 8,888 items /
1,994 connectors) pulled straight from `GET /v2/boards/{id}/items` and
`/connectors`, then replayed through `mapMiroItems`. Every claim below is
measured on that payload, not inferred from reading.

The reported symptom — "layout is broadly right, but some shapes don't show
up" — is explained by findings 1 and 2 together, which cover 3,433 of the
board's shapes.

## Blocking

- [x] **1. Miro sends every numeric style field as a STRING; `num()` drops
      them all.** `borderWidth: "2.0"`, `strokeWidth: "1.0"`,
      `fillOpacity: "0.0"`, `fontSize: "21"` — all strings in the live API.
      `map-items.ts` reads them with `num = v => typeof v === 'number' ? v : undefined`,
      so the guard `borderWidth && borderWidth > 0` never fires.
      **4,383 shapes lose their outline entirely.** The unit fixture at
      `map-items.test.ts:38` passes `borderWidth: 3` as a number, which is
      exactly why this never showed up.
      *Fix:* a `num()` that also parses numeric strings (`Number(v)` +
      `Number.isFinite`), applied to `borderWidth`, `strokeWidth`,
      `fillOpacity`, `borderOpacity`, `fontSize`.

- [x] **2. A Miro-transparent shape is imported as opaque white.**
      `fillOpacity: "0.0"` appears on **7,242 of 8,888 items (81.5%)** — on
      this board transparent is the *norm*, not the exception. The mapper
      writes `fill: { kind:'srgb', value: fillColor ?? '#ffffff' }`
      unconditionally. Combined with finding 1, a transparent black-bordered
      rectangle becomes **a solid white box with no border**: invisible on a
      white canvas, and it paints over whatever was emitted before it.
      **3,433 shapes are affected.**
      *Fix:* `fillOpacity === 0` → omit `fill` (the model documents
      "absent ⇒ not painted"); `0 < opacity < 1` → `{ kind:'srgb', value, alpha }`,
      which `ThemeColor` already supports.

- [x] **3. `MAX_ITEMS = 5000` silently truncates 44% of this board.**
      8,888 items → 3,888 dropped, in arbitrary feed order. It cascades:
      229 connectors are dropped *solely* because an endpoint fell past the
      cap. A `truncated` note is emitted, but the number is easy to miss
      next to a "success" import.
      *Fix:* decide deliberately — raise the cap, or make truncation a
      first-class warning in the summary UI rather than one note among many.

## Fidelity (imported, but wrong)

- [x] **4. Text items get a 100px fallback height.** Miro omits
      `geometry.height` on text — **3,821 items (43% of the board)**.
      `miroFrame` falls back to `DEFAULT_SIZE.h = 100`, and since Miro
      positions by centre, every label lands ~50px above where it belongs
      (verified: a text at `y: 91` maps to `frame.y: 41`).
      *Fix:* estimate height from `fontSize` × line count, or set the text
      element to auto-height rather than the 100px default.

- [x] **5. All text styling is dropped** — `fontSize` (9–36px across 1,487+
      items at 14px alone), `color` (989 grey, 312 red, 34 white-on-colour),
      `textAlign`, `textAlignVertical`. White-on-dark labels become black on
      dark. Miro `fontSize` is px, docs `InlineStyle.fontSize` is pt → × 0.75.

- [x] **6. `borderStyle` / `strokeStyle` dashed & dotted dropped** — 157
      shapes, 246 connectors. `Stroke.dash` already models exactly this.

- [x] **7. Connector stroke colour and width dropped** (same string-typing
      cause as 1). All 1,994 connectors fall back to the renderer default.
      `connector-renderer.ts:27` supplies a default, so they stay visible —
      cosmetic, not missing.

- [x] **8. Connector arrowheads are approximated and asymmetric.** Miro has
      `stealth` / `rounded_stealth` / `arrow` / `filled_triangle` /
      `filled_oval` / `erd_many`; all collapse to `triangle`. Worse, the
      `start` branch requires the cap to be defined while the `end` branch
      does not — an absent `endStrokeCap` yields an arrowhead, an absent
      `startStrokeCap` does not (`map-items.ts:265-270`).

- [x] **9. 378 connector captions are dropped silently** — the text written
      on the line — and counted under no `skipped` or `approximated` key.

## Unsupported types (343 items, 3.9%)

Currently all counted as `skipped`, which is honest. Worth ranking:

| Miro type | count | note |
|---|---:|---|
| `table_text` | 250 | slides has a real `TableElement` — mappable |
| `frame` (as parent) | 145 | mapped ✓ |
| `mindmap_node` | 33 | Miro returns no `data`; `isSupported: false` upstream |
| `table` | 32 | see `table_text` |
| `paint` | 27 | freehand strokes; `freeform` ShapeKind could carry them |
| `preview` | 1 | link preview |

Also: **51 `shape` items carry no `data.shape`** (Miro flags them
`isSupported: false`) and degrade to `rect` — correctly counted under
`approximated['shape-kind']`.

## Not a bug — confirmed correct

- **915 connectors (46%) have a free endpoint** with *no* id. Verified: those
  ends carry no coordinates at all, so the mapper's refusal to invent a
  position is right. They should get their own `skipped` reason
  (`connector-free-end`) rather than sharing the `connector` counter with
  genuinely truncated ones, so the summary can say *why*.
- Parent/frame resolution: **0 items** were mispositioned by a truncated
  parent on this board.
- Rotation (18 items), frame z-ordering, and the `__id` → real-id remap all
  behave as documented.

## Test-gap root cause

Every fixture in `map-items.test.ts` is hand-written with idealised types
(numbers where the API sends strings, `height` always present). Add a fixture
captured verbatim from a real `GET /items` response so class-1 defects fail
loudly.

## Housekeeping

- [x] `tokens.txt` at the repo root holds a **live Miro access + refresh
      token**. Untracked, but one `git add -A` from being committed. Delete
      it and/or add to `.gitignore`; rotate if it was ever shared.

## Review

Landed as 17 commits on `fix/miro-import-fidelity`, one per finding, each with
`pnpm verify:fast` green.

**Blocking (1–3).** `num()` now parses numeric strings; a transparent Miro
shape omits its fill instead of painting opaque white; truncation leads the
import summary and carries the denominator Miro already sends on every feed
page (`only 5000 of 8888`). 1 and 2 together are the reported symptom, and
between them they cover 3,433 of the reference board's shapes.

**Fidelity (4–9).** Text height is estimated from the parsed blocks and the
frame resized about its centre, with a middle anchor so the estimate's
wrapping error stays symmetric; item-level typography (size in px → pt,
colour, both alignments) is carried; dashed/dotted and translucent strokes
survive through one shared `miroStroke`; arrowheads map by shape rather than
all collapsing to a filled triangle; connector captions become placed text
elements, counted as a degradation.

**Not fixed, deliberately.** `MAX_ITEMS` is still 5,000. Whether that is the
right ceiling costs backend memory, response size and CRDT document size to
answer, and none of it is measured — the reporting change makes the
consequence visible without pretending to settle the number. Font *family* is
still dropped (Miro's `open_sans` needs a mapping into the slides catalogue,
and a wrong guess falls back worse than the uniform default). `table` /
`table_text` (282 items) are still skipped though slides has a real
`TableElement`; `paint` (27) likewise against `freeform`. Both are follow-ups,
not regressions.

**Known limitation.** An imported caption sits *under* its connector, because
`applyBoardElements` writes every non-connector before every connector and
z-order is array order. Documented in `docs/design/board/board-miro-import.md`.

**Self-review rounds.** Three passes over the branch diff, each finding real
defects in the new code.

*Round 1* (`c57133683`) — captions placed on the centre-to-centre chord rather
than the real site-to-site line; captions ignoring the typography Miro puts on
the connector style; a style-less shape still becoming an opaque white box; an
ungrammatical "…their target was not imported skipped"; two comments the branch
had made false.

*Round 2* (`7e1eca4a4`, `e62a1b3a2`) — the corrected text height never reached the
`frames` table connectors resolve against, so anything meeting a text item from
above or below used the discarded 100-unit placeholder. And, following that
thread, a **pre-existing** defect the branch was about to import into new code:
`pickConnectorSite` returned a bare cardinal index, which is only correct for
the default four-site list. An `ellipse` has eight sites whose index 1 is NW —
so all 722 of the board's circles were attaching connectors to the wrong side
and bowing them along the wrong normal. Fixed by choosing a *direction* and
resolving it against the target's real site list, via two new
`@wafflebase/slides` exports rather than a local copy of the site geometry.

*Round 3* (`45866b38f`) — clean on the substance; closed the two gaps it named
(an explicit Miro offset can now reach an ellipse's diagonal sites, and the
board no longer keeps its own copy of the `DIR_*` angles).
