# Slides critique fixes — todo

Source: `/impeccable critique` of the Slides editor (24/40), snapshot
`.impeccable/critique/2026-11-16T01-00-17Z__packages-frontend-src-app-slides.md`.
Scope agreed with the user: all five priority issues, menu bar = labels only,
one PR, parallel agents.

- [x] P0 Placeholder hints ("Click to add …") are not painted in presentation
      mode, the filmstrip, or any export; only the editor canvas (and the layout
      picker previews) opt in. `packages/slides/src/view/canvas/element-renderer.ts`
- [x] P1 A new deck seeds a Title slide (not Blank) and a fixed default theme
      instead of inheriting the creator's app light/dark preference.
      `packages/frontend/src/app/slides/slides-view.tsx`
- [x] P1 Icon-only chrome gets text labels: Slideshow / Share buttons, labelled
      right-panel toggles (Format · Motion · Background · Theme).
- [x] P2 The text-edit "Done" button stops being a primary syrup fill on desktop.
      `toolbar/text-edit-section.tsx`
- [x] P2 Accessibility: desktop filmstrip gets listbox semantics + "Slide n of N"
      names + `aria-selected` + visible slide numbers; peer name labels choose
      text colour by background luminance (`overlay.ts`, 1.4:1 today).
- [x] `pnpm verify:fast` green per commit; browser smoke; `/self-review`
- [x] Open PR

## Review

Implemented by four parallel agents in isolated worktrees, cherry-picked onto
one branch without conflicts, then hardened by one follow-up agent.

- P0: `showPlaceholderHints` render option, default off; the editable editor
  canvas and the layout picker opt in. Presenter, filmstrip, read-only mounts
  and every export paint no hint. PDF export no longer strips `placeholderRef`.
- P1 seed: `seedEmptyDeck()` adds a `title-slide` in `default-light` on desktop
  and mobile edit mounts; the app-theme coupling (`initialThemePreference`) is
  gone. Opening the Themes panel on creation was skipped (no reliable
  "just created by me" signal).
- P1 labels: "Slideshow" and "Share" (suite-wide `ShareDialog`) carry words;
  Format · Motion · Background · Theme become words behind a toolbar
  container query (idle ≥800px, object/text ≥1300px), icons below.
- P2 Done: plain toolbar text button (board shares it).
- P2 a11y: filmstrip listbox/option semantics, "Slide n of N: title",
  `aria-activedescendant`, visible slide numbers; peer name tags in slides,
  docs and sheets pick text colour with the shared `readableTextColor`
  (`@wafflebase/core/tokens`).

Verified: `pnpm verify:fast` green on the integrated branch; browser smoke on
a branch-built backend (:3001) + frontend (:5199): labels, slide number, ARIA
names, dark peer-label text, no hint in present mode, nudge + undo after a
thumbnail click.
