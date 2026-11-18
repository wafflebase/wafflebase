# Board sticky + stamp polish

Stickies read as rounded buttons (30px corner radius on a 180px note, ~23px
side text margin from the `roundRect` text rect + default shape padding), and
stamps are bare OS emoji that look different per platform and say nothing
about who stamped.

## Sticky

- [x] `STICKY_CORNER_ADJ` (~4px at 180px) + `STICKY_TEXT_INSET` (~12px total
      per side) in `@wafflebase/board` `model/sticky.ts`
- [x] `buildStickyInit` and the Miro importer write both explicitly
- [x] `withStickyDefaults(data)` fills them on read for stickies that lack
      them (existing boards), wired in `YorkieBoardStore.readElement`
- [x] Tests

## Stamps (render-only, no CRDT change)

- [x] Per-kind sticker art: coloured disc + white lucide icon, white rim
- [x] Stamper badge: initial on the stamper's colour (`getPeerCursorColor`
      keyed on the stable user key), shown when the stamp is big enough
- [x] Pop-in animation for freshly placed stamps (skipped under
      `prefers-reduced-motion`)
- [x] Toolbar menu uses the same art instead of emoji
- [x] Selection frame + handles draw over stamps (editor overlay `z-index: 2`,
      above the unstacked ritual layer, under laser 3 / chrome 5)
- [x] Tests

## Dark-mode plane

- [x] App dark mode dims the plane to `#BBBCB8` (half the light of white,
      default text 9.1:1); content, grid and peers keep the light theme, PNG/PDF
      export stays white. Minimap panel follows via `setPlaneBackground`.
- [x] Menu/toolbar stamp badges carry the canvas sticker's white rim; solid
      glyphs are filled without a stroke and sized per kind (`StampArt.scale`)
      so the disc's colour edge stays visible at 16px.

## Icon critique follow-up (P1 + P2, three parallel agents)

Critique: 22/36 — split buttons built three ways, Grid/Section both "#",
coloured stamp disc breaking the One Accent Rule, facilitation tools
scattered, floating chrome small and low-contrast.

- [x] One `SplitToolChevron` for Sticky / Marker / Stamp; corner caret on
      Shape / Line; Undo/Redo 32px; Grid `IconGridDots`, Section
      `IconLayoutNavbar`; Image is a command button; More keeps separators
- [x] Dock Stamp is a monochrome glyph idle, the coloured sticker armed;
      `StampBadge` sized by style (a host svg rule forced it to 16px) with a
      small-badge boost so menu glyphs do not shrink to dots
- [x] Facilitate group (Timer, Vote, Spotlight, Laser) in the top bar; Start
      voting and the laser leave the stamp / marker menus; phone fold
- [x] Export button and Map toggle share the dock surface, 32px / 44px coarse;
      empty-board hint ink ≥4.5:1 on both planes
- [x] Kept: the minimap's syrup viewport frame along the panel edge — it is
      the "you are here" indicator, not a passive border

## Verify

- [x] `pnpm verify:fast`
- [x] Visual check in `pnpm dev`

## Review

- Sticky: radius 30px → ~4px, side text margin ~23px → ~12.8px (preset text
  rect 8.8px + 4px). Existing stickies pick both up on read
  (`withStickyDefaults` in `YorkieBoardStore.readElement`); values a sticky
  carries win, and the radius is only filled on a `roundRect` (adjustment 0
  means something else on other kinds).
- Stamps: CRDT unchanged. Stickers are coloured discs with lucide icons, a
  stamper initial badge coloured by `getPeerCursorColor('light', by)`, hidden
  under 22px; base size 28 → 32. A node pops in when its stamp is within 2s of
  now, so loading a board does not animate every stamp. Hover card uses labels
  instead of emoji.
- Verified in `pnpm dev`: new sticky + +1/Heart/Star stamps render as above.
- Known limit: the author tag can still touch long shrink text at the bottom
  edge (it could before too, at 16px).
