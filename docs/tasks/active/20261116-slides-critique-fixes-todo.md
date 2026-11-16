# Slides critique fixes — todo

Source: `/impeccable critique` of the Slides editor (24/40), snapshot
`.impeccable/critique/2026-11-16T01-00-17Z__packages-frontend-src-app-slides.md`.
Scope agreed with the user: all five priority issues, menu bar = labels only,
one PR, parallel agents.

- [ ] P0 Placeholder hints ("Click to add …") are not painted in presentation
      mode, the filmstrip, or any export; only the editor canvas (and the layout
      picker previews) opt in. `packages/slides/src/view/canvas/element-renderer.ts`
- [ ] P1 A new deck seeds a Title slide (not Blank) and a fixed default theme
      instead of inheriting the creator's app light/dark preference.
      `packages/frontend/src/app/slides/slides-view.tsx`
- [ ] P1 Icon-only chrome gets text labels: Slideshow / Share buttons, labelled
      right-panel toggles (Format · Motion · Background · Theme).
- [ ] P2 The text-edit "Done" button stops being a primary syrup fill on desktop.
      `toolbar/text-edit-section.tsx`
- [ ] P2 Accessibility: desktop filmstrip gets listbox semantics + "Slide n of N"
      names + `aria-selected` + visible slide numbers; peer name labels choose
      text colour by background luminance (`overlay.ts`, 1.4:1 today).
- [ ] `pnpm verify:fast` green per commit; browser smoke; `/self-review`
- [ ] Open PR

## Review

(filled in at the end)
