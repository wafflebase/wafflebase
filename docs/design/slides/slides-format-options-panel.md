---
title: slides-format-options-panel
target-version: 0.4.3
---

<!-- Append this document link to docs/design/README.md after merging. -->

# Slides Format Options Panel

## Summary

Add a right-side **Format options** panel to the slides editor, mirroring
Google Slides. The panel surfaces precise numeric inputs and section-level
toggles that do not fit the contextual top toolbar — Size & Position
(W/H/X/Y/Rotation), Text fitting (autofit), Image Adjustments (opacity),
and Alt text. The panel coexists with the existing `ThemePanel` in the
same right slot, mutually exclusive.

This spec covers v1 of the panel. Drop shadow, reflection, recolor,
brightness/contrast, text padding, and numeric shape adjustments are
explicitly deferred — they all require new data-model fields and
renderer/PPTX changes that are larger than the panel shell. The slides
v1 non-goal "Right-side Format options panel" in
[`slides.md`](./slides.md) is partially closed by this spec for the
properties already present in the data model.

### Goals

- Add a togglable right-side `FormatPanel` that surfaces precise numeric
  inputs and section toggles for the currently selected element(s).
- Cover the properties that already exist in the data model — Size &
  Position (`frame.x/y/w/h/rotation`), Text fitting (`text.autofit`),
  Image opacity (`image.opacity`), Alt text (`image.alt`) — with no new
  renderer or PPTX work.
- Match Google Slides multi-select semantics: empty input when values
  differ, single value when all selected elements match, write applies
  to every selected element.
- Display units toggleable between **inches** (default) and
  **centimeters**, stored on the presentation `Meta` so the ruler
  (separate spec) can pick up the same preference later.
- Coexist with the existing `ThemePanel` via a single
  `rightPanel: 'theme' | 'format' | null` slot — opening one closes the
  other.
- Ship in a single PR. Data-model change is a single optional field on
  `Meta`; all other work is additive UI.

### Non-Goals

- **Drop shadow**, **reflection**, **recolor** for shapes/text/images.
  Each requires a new `data` field, a paint-time pipeline change, and
  OOXML `<a:effectLst>` / `<a:duotone>` import-export mapping. Tracked
  as separate v1.1+ specs.
- **Image brightness / contrast**. Requires a canvas filter pipeline
  (`ctx.filter = '...'` or per-image offscreen pass) and PPTX
  `<a:lum>` / `<a:duotone>` round-trip. v1.1+.
- **Text padding** (`<a:bodyPr lIns="..." tIns="...">`). The data model
  has no padding field today; adding it touches the docs RichText
  layout reused by slides text boxes. v1.1.
- **Numeric inputs for shape adjustments** (`<a:avLst>`). The
  yellow-diamond drag UI from [`slides-shapes.md`](./slides-shapes.md)
  already edits these; numeric input is v1.1.
- **Image crop UI**. The data field `image.crop` is editable
  programmatically only; the dedicated crop UI is a separate spec.
- **Mobile**. Desktop-only (≥768px). Mobile keeps the existing
  bottom-sheet format controls described in
  [`slides-mobile-edit.md`](./slides-mobile-edit.md).
- **Read-only / sharing mode**. The panel and its toolbar toggle are
  hidden entirely, mirroring how `ThemePanel` behaves today.
- **Position-from-center mode**. Google Slides exposes a "Position
  from: Top left / Center" dropdown; v1 uses top-left corner only,
  matching the stored `frame.x/y` semantics. The dropdown is a v1.1
  candidate if user requests appear.
- **Persisting the panel open state across sessions**. Local React
  state only — closing the app forgets the panel state. Matches
  `ThemePanel`.
- **Locale-aware decimal separators**. Inputs use `.` as the decimal
  separator regardless of locale. Google Slides does the same.

## Proposal Details

### Architecture

The right-side slot in `slides-detail.tsx` currently mounts
`ThemePanel` behind a `themePanelOpen: boolean`. This is generalized
to a single union:

```ts
type RightPanel = 'theme' | 'format' | null;
const [rightPanel, setRightPanel] = useState<RightPanel>(null);
```

Toggling either panel sets the union to that panel's id; opening one
closes the other. Closing sets it back to `null`. Existing
`themePanelOpen` reads in `DesktopSlidesLayout` are replaced by
`rightPanel === 'theme'`; `MobileSlidesLayout` does not mount the
format panel at all.

The toolbar gains one button in the right global zone (next to
**Theme**):

```text
[Global L] | [Insert + Slide] | [Contextual] | (push-right) | [Theme] [Format] [Present]
```

`Format` is an `IconAdjustmentsAlt`-style icon button that toggles
`rightPanel` between `'format'` and `null`. The button is hidden in
read-only mode.

#### Component contract

```ts
interface FormatPanelProps {
  store: SlidesStore;
  editor: SlidesEditor;
  theme: Theme | null;
  onClose: () => void;
}

function FormatPanel(props: FormatPanelProps): JSX.Element;
```

The panel re-derives the active selection on every store change
(subscribe via `store.onChange`). Selection is normalized into:

```ts
type PanelSelection =
  | { kind: 'idle' }
  | {
      kind: 'object';
      selectionType: 'shape' | 'image' | 'text-element' | 'connector' | 'group' | 'mixed';
      elements: ReadonlyArray<Element>; // resolved Element objects
      slideId: string;
    };
```

Section routing is a pure function:

```ts
type SectionId =
  | 'size-position'
  | 'text-fitting'
  | 'image-adjustments'
  | 'alt-text';

function pickSections(selection: PanelSelection): readonly SectionId[];
```

Mapping:

| selectionType | sections |
|---|---|
| `shape` | `['size-position']` |
| `image` | `['size-position', 'image-adjustments', 'alt-text']` |
| `text-element` | `['size-position', 'text-fitting']` |
| `connector` | `['size-position']` (rotation hidden internally) |
| `group` | `['size-position']` |
| `mixed` | `['size-position']` (rotation/W/H hidden, X/Y only) |
| `idle` | `[]` — empty state with hint copy |

The panel shell maps `SectionId` → component and renders each in
order. `pickSections` lives in its own file with unit tests; the shell
file holds only the slot manager + header + empty-state hint.

### Size & Position section

```text
┌─ Size & Position ─────────────────┐
│ Size                              │
│  W: [ 240.00 ] in   🔒 Lock       │
│  H: [ 135.00 ] in                 │
│                                   │
│ Position                          │
│  X: [ 100.00 ] in                 │
│  Y: [  50.00 ] in                 │
│                                   │
│ Rotation                          │
│  Angle: [ 0.00 ]°   ↺   ↻         │
│                                   │
│ Units: (•) Inches  ( ) Centimeters│
└───────────────────────────────────┘
```

#### Coordinate system and unit conversion

- Storage: `frame.x/y/w/h` are canvas pixels (canvas is 1920×1080).
  `frame.rotation` is radians.
- Display: `meta.unit` selects `'in'` or `'cm'`. Renderer never reads
  this field; only the panel's input widgets convert.
- Conversion constants (`format-panel/units.ts`):
  ```ts
  const PX_PER_IN = 192;   // canvas 1920 px = 10 in
  const PX_PER_CM = 192 / 2.54;

  function pxToUnit(px: number, unit: 'in' | 'cm'): number;
  function unitToPx(value: number, unit: 'in' | 'cm'): number;
  function formatDisplay(px: number, unit: 'in' | 'cm'): string; // 2 dp
  ```
- Rotation: `radToDeg(rad)` / `degToRad(deg)`, 2 dp display, modulo 360.

#### Commit timing

- `onChange` updates a local React draft only — no store writes per
  keystroke.
- `onBlur` and `Enter` commit via `store.batch(() => ...)`. This keeps
  Yorkie traffic and undo stack proportional to user intent (matches
  the docs/sheets precise-input pattern).
- `Escape` reverts the draft to the displayed value and blurs.

#### Multi-select mixed-value handling

```ts
function getCommonValue<T>(
  elements: readonly Element[],
  accessor: (el: Element) => T,
  equals?: (a: T, b: T) => boolean,
): T | undefined;
```

- Returns the common value when every element matches; `undefined`
  otherwise.
- `undefined` → input renders a placeholder `'—'` and blank value.
- Committing a value applies it to every selected element in a single
  `store.batch`.
- Committing a blank input is a no-op.

#### Lock aspect ratio

- Toggle button next to W. Locked state is **local React state**, not
  persisted (Google Slides parity).
- When locked and the user edits W, H is recomputed proportionally
  from each element's own current aspect ratio (per-element) and
  written along with W in the same batch. Same for H → W.
- Selection change resets the lock toggle to off (no carry-over).

#### 90° rotation buttons

- `↺` subtracts π/2, `↻` adds π/2, applied per element. Each element
  rotates around its own center.
- Wraps via `((rotation + delta) % (2π) + 2π) % (2π)`.

#### Selection-type variants

| Type | W/H | X/Y | Rotation | Notes |
|---|---|---|---|---|
| shape | yes | yes | yes | |
| image | yes | yes | yes | crop unchanged here |
| text-element | yes | yes | yes | when `autofit === 'grow'`, H input is disabled with tooltip "Height is auto-calculated. Switch autofit to 'None' or 'Shrink' to set manually." |
| connector | hidden | conditional | hidden | W/H are derived from endpoints, not editable. X/Y translate both endpoints by the same delta and require **both** endpoints to be `kind: 'free'`; if either is `kind: 'attached'`, the X/Y inputs are disabled with tooltip "Detach endpoints to set position." Rotation is endpoint-defined. |
| group | yes | yes | yes | applied to outer frame; children scale proportionally |
| mixed | hidden | yes | hidden | X/Y only, each element translates independently |

#### Unit toggle

The radio sits inside the Size & Position section, persisted to
`meta.unit`. Switching units only re-formats the displayed values —
no element data is touched. The same field is reserved for the
ruler (separate spec) to pick up later.

### Text fitting section

A new 3-mode radio group built for the panel — there is no reusable
selector today. The existing in-canvas bottom-left toggle from
[`slides-text-autofit.md`](./slides-text-autofit.md) stays as a
quick action; the panel is the precise control. Both write the same
`data.autofit` field.

Options:

- **Do not autofit** (`'none'`) — box fixed, text overflows.
- **Shrink text on overflow** (`'shrink'`) — box fixed, font auto-scales.
- **Resize shape to fit text** (`'grow'`) — font fixed, box height tracks
  content.

Commit on selection (single `store.batch`). Multi-select: blank
radio when values differ, common value selected when all match,
choosing applies to every selected text element.

The H input lock in Size & Position keys off the same value
(`autofit === 'grow'` ⇒ H disabled).

### Image Adjustments section

```text
┌─ Adjustments ──────────────────────┐
│ Transparency                       │
│  [────●─────────────────] 30%      │
└────────────────────────────────────┘
```

- Slider 0–100% mapped to `image.opacity` as `1 - value/100`.
  Internally stored as the existing `opacity` field (0..1).
- Commit on `pointerup` only, not during drag (one undo entry per
  adjustment session).
- Multi-select: shows blank slider thumb when values differ; dragging
  commits the new value to all.

### Alt text section

```text
┌─ Alt text ─────────────────────────┐
│ [textarea, 3 rows]                 │
│ "Describe this image for screen    │
│  readers"                          │
└────────────────────────────────────┘
```

- Maps to `image.alt`. `onBlur` commit.
- The existing Alt-text dropdown in the image toolbar
  (`image-controls.tsx`) is **removed**; the panel becomes the single
  source. Toolbar keeps Replace / Crop / Reset crop.

### Data model change

`packages/slides/src/model/presentation.ts`:

```diff
 export type Meta = {
   themeId: string;
+  /**
+   * Display unit for the Format options panel (and, when adopted,
+   * the ruler). Renderer never reads this field; it only switches
+   * what the panel's numeric inputs show. Absent ⇒ 'in'.
+   */
+  unit?: 'in' | 'cm';
   // existing fields...
 };
```

`migrate.ts` requires no change — absence means `'in'`.

No other model files change. `frame`, `text.autofit`, `image.opacity`,
`image.alt` are all already in place.

### File layout

```
packages/frontend/src/app/slides/
├── slides-detail.tsx                # rightPanel union, FormatPanel mount
├── toolbar/global-controls.tsx      # Format options toggle button
└── format-panel/                    # new directory
    ├── index.tsx                    # FormatPanel shell + section routing
    ├── pick-sections.ts             # pure: selection → SectionId[]
    ├── pick-sections.test.ts
    ├── units.ts                     # pxToUnit / unitToPx / formatDisplay / getCommonValue / radToDeg / degToRad
    ├── units.test.ts
    ├── size-position-section.tsx
    ├── text-fitting-section.tsx     # 3-mode radio, writes data.autofit
    ├── image-adjustments-section.tsx
    └── alt-text-section.tsx
```

The `image-controls.tsx` toolbar file is edited to drop its
`AltTextDropdown` and stop importing `IconAccessible`.

### Testing strategy

| Layer | Tool | Coverage |
|---|---|---|
| `units.ts` pure functions | vitest | px↔in/cm round-trip, 2 dp formatting, rad↔deg, modulo wrap, `getCommonValue` (common / mixed / empty) |
| `pick-sections.ts` | vitest | Every `selectionType` returns the expected section list |
| Section components | vitest + React Testing Library | `onBlur` commits via `store.batch`, `Enter` commits, `Escape` reverts, mixed-value `'—'` placeholder, lock-aspect proportional update, autofit=grow disables H |
| Integration | vitest + RTL | Theme↔Format mutual exclusion, multi-select batch write, unit toggle writes `meta.unit` |
| Browser smoke | `pnpm verify:browser:docker` | Open panel, edit W with lock, rotate 90°, switch units, multi-select translate |

### Rollout

Single PR. Verification gates:

- `pnpm verify:fast` — lint + unit tests.
- `pnpm verify:browser:docker` — one smoke scenario covering the
  flow listed above.
- Manual checks before merge:
  - Theme↔Format mutual exclusion.
  - Multi-select W/H batch write produces a single undo entry.
  - `autofit === 'grow'` disables H input with tooltip.
  - Read-only viewer never sees the toolbar Format button.

No feature flag — the panel is additive UI and the model change is a
single optional field.

### Risks and Mitigation

**Theme ↔ Format slot competition.** Both panels mount in the same
right slot. Mitigation: consolidate to a single `rightPanel` union
in `slides-detail.tsx`. Theme open/close call sites are updated in
the same PR (limited to one file). Browser smoke covers mutual
exclusion explicitly.

**Numeric input UX (IME, locale, paste).** Inputs use
`inputMode="decimal"` and `parseFloat`. Non-numeric paste is rejected
on commit (reverts to the displayed value). Locale decimal commas
are not handled in v1 — Google Slides exhibits the same behavior and
no user complaints have surfaced internally.

**Multi-select lock-aspect semantics.** Each element scales by its
own aspect ratio when the user edits W or H, not by the bounding-box
ratio. Documented explicitly and locked in by a unit test on
`size-position-section.tsx`.

**Round-trip precision.** With `PX_PER_IN = 192` integer constant,
0.01-inch granularity is lossless. Smaller inputs round to two
decimal places, matching the display precision — no surprise.

**`autofit === 'grow'` and the H input.** Disabling the H input could
surprise users who don't notice the autofit setting. Mitigation:
tooltip on the disabled input names the autofit mode and the value
that needs to change.

**`Meta.unit` and future ruler integration.** The ruler design
(separate spec) may want its own field eventually. Starting with a
single shared field keeps the data minimal; if the ruler needs to
diverge, that spec can introduce a second field then. No migration
debt.

**Removing `AltTextDropdown` from the toolbar.** Users who had
learned the toolbar location for Alt text will need to discover the
panel. Mitigation: image toolbar shows no Alt button; the panel auto-
opens hint can be added later if support tickets surface (not in v1).

**Toolbar real estate for the Format button.** The right global zone
already holds Theme + Present. Adding Format brings it to three
icons. Verified against the toolbar redesign zones in
[`slides-toolbar-redesign.md`](./slides-toolbar-redesign.md); fits
without reflow at desktop widths.
