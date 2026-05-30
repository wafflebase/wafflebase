# Docs toolbar — group reorganization + trigger affordance polish

## Goal

Tighten the Docs body toolbar on two axes:

1. **Group order** — reorder action clusters so they flow naturally
   (Format → Insert → Paragraph → Spacing → Export) instead of
   interleaving Format and Insert.
2. **Trigger affordance** — make each toolbar trigger preview the
   current value (color swatch on Text/Highlight color, current
   paragraph alignment icon on the Alignment dropdown) so the toolbar
   reads the user's state at a glance, matching Google Docs.

Pull a few shared building blocks out of `slides/toolbar/` so docs and
slides share the same components instead of diverging.

## Scope shipped (final)

### Group order

- **Insert link** moved from `TextFormatGroup` to the Insert cluster
  beside Image/Table. Format group is now strictly inline formatting
  (B/I/U + colors + Clear); "insert something" actions cluster
  together (Link/Image/Table).
- **Toolbar widths** reduced where they had excess slack:
  - Styles dropdown trigger: `min-w-[110px]` → `min-w-[100px]`
  - Font family picker: `min-w-[130px]` → `min-w-[112px]`
  - Font size picker: dropped the explicit chevron-only trigger
    (~20 px) — clicking the numeric input now opens the preset
    dropdown.

### Trigger affordance

- **Color swatch buttons** unified across **docs, sheets, and
  slides**: pulled `ColorSwatchButton` out of `slides/toolbar/` into
  the shared `components/` directory. Docs Text color and Highlight
  triggers, and the sheets formatting toolbar's Text color / Fill
  color triggers, now render the same swatch (top-aligned icon + 3 px
  color stripe showing the current value). The sheets toolbar's
  previous hand-rolled `<span absolute mt-5>` stripe is gone.
- **Mode-aware default colors** — when the selection has no explicit
  color, the swatch falls back to a CSS variable so the stripe
  reflects the rendered default and flips between light/dark mode:
  - Docs Text color: `var(--wb-ink)` / Highlight: `var(--wb-paper)`
  - Sheets Text color: `var(--foreground)` / Fill color:
    `var(--background)` (replaces the previous hard-coded `#000000`
    / `transparent + #ccc outline` which were not mode-aware)
  - Slides text-box toolbar keeps the outlined-slot fallback
    (themed contexts shouldn't inherit docs paper / global
    foreground tokens).
- **Alignment trigger preview** — the Text alignment dropdown trigger
  in `TextParagraphGroup` now picks its icon from the current
  paragraph's `alignment` (`left` / `center` / `right` / `justify`)
  instead of always rendering `IconAlignLeft`. The docs header/footer
  slim toolbar gets the same treatment.

## Non-goals

- Slides text-edit toolbar layout — `TextFormatGroup` keeps Link
  inside the Format cluster via the default `showLink` prop; the
  Color swatch default-color fallback is *not* injected (slides
  text-boxes paint over theme colors, not docs paper tokens).
- Mobile overflow menu structure — already groups Link under
  "Insert"; no change required.
- Header/footer slim toolbar group order — only the affordances
  changed (color swatch, alignment preview).

## Current vs target layout (desktop body toolbar)

**Before**:

```
Undo/Redo | Styles | Family/Size | B I U Color Highlight Link Clear | Image Table | Paragraph(align/list/indent) | LineSpacing | Export
```

**After**:

```
Undo/Redo | Styles | Family/Size | B I U Color Highlight Clear | Link Image Table | Paragraph(align/list/indent) | LineSpacing | Export
```

## Approach

`TextFormatGroup` is shared by:

- `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`
- `packages/frontend/src/app/slides/toolbar/text-edit-section.tsx`
- `packages/frontend/src/app/slides/toolbar/mobile-toolbar.tsx`

To opt slides out of the docs-specific decisions, we extend the
existing `showStrikethrough` prop pattern with:

- `showLink?: boolean` (default `true`) — docs passes `false`; slides
  keeps default.
- `defaultTextColor?: string` / `defaultHighlightColor?: string` —
  docs passes `var(--wb-ink)` / `var(--wb-paper)`; slides omits.

The Insert link button is extracted into a small reusable
`InsertLinkButton` component (mirrors `ClearFormattingButton`) so
docs can render it standalone in the Insert cluster without
duplicating the trigger logic.

`ColorSwatchButton` moves to `packages/frontend/src/components/`
alongside `color-picker-grid.tsx` and `formatting-colors.ts`. Slides
call sites (4 files) get their imports updated to the new path.

## Files

| File | Change |
| ---- | ------ |
| `components/color-swatch-button.tsx` | **moved** from `app/slides/toolbar/` |
| `components/text-formatting/insert-link-button.tsx` | **new** — reusable Link button |
| `components/text-formatting/index.ts` | export `InsertLinkButton` |
| `components/text-formatting/text-format-group.tsx` | `showLink` / `defaultTextColor` / `defaultHighlightColor` props; Link block replaced by `InsertLinkButton`; color buttons replaced by `ColorSwatchButton` |
| `components/text-formatting/text-style-group.tsx` | trigger `min-w-[110px]` → `min-w-[100px]` |
| `components/text-formatting/font-family-picker.tsx` | trigger `min-w-[130px]` → `min-w-[112px]` |
| `components/text-formatting/font-size-picker.tsx` | drop chevron trigger; input becomes `DropdownMenuTrigger asChild`; `onOpenAutoFocus`/`onCloseAutoFocus` prevent focus theft so typing still works |
| `components/text-formatting/text-paragraph-group.tsx` | alignment trigger icon derived from `editor.getBlockStyle()?.alignment` |
| `app/docs/docs-formatting-toolbar.tsx` | body toolbar Insert cluster gets `InsertLinkButton`; header/footer slim toolbar gets the color-swatch + alignment-preview treatment; passes `var(--wb-ink)` / `var(--wb-paper)` defaults |
| `app/slides/toolbar/{shape,global,border,text-element}-controls.tsx` (and `border-picker.tsx`) | import path update for moved `ColorSwatchButton` (no behavioural change) |
| `components/formatting-toolbar.tsx` | sheets Text / Fill color triggers swap hand-rolled stripe span for `ColorSwatchButton`; fallback colors become `var(--foreground)` / `var(--background)` |

## Tasks

- [x] Extract Link button into `InsertLinkButton`
- [x] Add `showLink` prop to `TextFormatGroup`
- [x] Place `InsertLinkButton` at the head of the Insert cluster in
      the docs body toolbar
- [x] Reduce Styles / Font family trigger widths
- [x] Compact the Font size picker (input-click opens dropdown)
- [x] Move `ColorSwatchButton` to `components/`; update 4 slides
      import paths
- [x] Swap docs Text color / Highlight triggers to `ColorSwatchButton`
      (body + header/footer slim toolbar)
- [x] Add `defaultTextColor` / `defaultHighlightColor` props to
      `TextFormatGroup`; pass `var(--wb-ink)` / `var(--wb-paper)`
      from docs (body + slim)
- [x] Make the Alignment trigger preview the current paragraph's
      alignment (body via `TextParagraphGroup`; slim toolbar inline)
- [x] Sheets formatting toolbar adopts `ColorSwatchButton` for
      Text / Fill color with `var(--foreground)` / `var(--background)`
      fallbacks
- [x] `pnpm verify:fast` green
- [ ] Self code-review via `superpowers:requesting-code-review`
- [ ] Open PR; address review; merge
- [ ] Capture lessons; archive

## Risks

- **Slides text-edit Link button** — slides keeps `showLink=true` so
  Link stays inside the Format cluster. Visual smoke required to
  confirm no shift.
- **Font size keyboard nav** — Radix `DropdownMenuTrigger` normally
  consumes ArrowUp/Down to open the menu. Input's existing
  `onKeyDown` calls `preventDefault()` for ArrowUp/Down so Radix's
  merged handler (via `composeEventHandlers`) sees a
  default-prevented event and does not open the menu. Stepper
  behavior preserved.
- **Highlight reset stripe vs. paper** — `var(--wb-paper)` IS the
  paper background, so the "reset" swatch is intentionally low
  contrast. If this reads as confusing in dev smoke, drop the
  Highlight fallback (keep Text color one) so Highlight reset
  shows the outlined slot.
- **Mobile overflow menu** — Link already lives under "Insert" in
  the mobile dropdown (`docs-formatting-toolbar.tsx:681-685`).
  Verified — no change needed.

## Out of scope (follow-ups)

- Slides text-edit `ColorSwatchButton` — would need theme-resolved
  default colors instead of docs paper tokens.
- Further font-size compactness (e.g. hiding the steppers behind
  hover) — current shape already saves ~20 px.
- Toolbar overflow strategy at narrow viewports.
