# Lessons — Cmd+/ Shortcuts Help in Docs & Sheets

## Catalog lives next to the runtime, not in the frontend

Slides already established the pattern: `shortcuts-catalog.ts` sits in
the engine package (`packages/slides/src/view/`). Following that
convention rather than putting the lists inside the frontend means
the package README / design docs can link the catalog and any
future agent-driven help (e.g. Yorkie-attached "what does this
shortcut do?" lookup) can read it without pulling in React.

## Widen the dialog's category type, not the engine's

`ShortcutCategory` is a narrow union per engine (docs has
`'Editing' | 'Format' | …`, sheets has its own). The shared
`ShortcutsHelpDialog` accepts `category: string` so each engine can
keep its own union without leaking docs-only categories into sheets
or vice-versa. The thin wrapper component (`DocsShortcutsHelp`,
`SheetsShortcutsHelp`) supplies the engine-specific `CATEGORY_ORDER`.

## Window-level keydown is enough — the editors don't bind `/`

Both the docs `text-editor.ts` switch and the sheets worksheet
keyRules have no `/` binding, so a textarea-focused Cmd+/ bubbles
to the window listener registered in `docs-view.tsx` /
`sheet-view.tsx` and the dialog opens. No need to plumb a callback
through the editor option object (which is how Slides did it
because the slides keyboard layer specifically wanted to bypass the
"editable target" gate). Keeps the change confined to the frontend.

## Rebuild producer packages before verify:fast

Per `project_packages_consume_built_dist`: frontend's tsc/tests
read the built `dist/` of `@wafflebase/docs` and `@wafflebase/sheets`,
not the `src/`. After adding the new `SHORTCUTS` / `formatCombo`
exports to each package's `index.ts`, the docs+sheets packages must
be rebuilt before `pnpm verify:fast` so the frontend's import
resolves.

## Catalog drift: don't list shortcuts before the runtime binds them

The first sheets catalog draft included `F2`, `Mod+Home`, `Home/End`,
`Shift+Space`, `Mod+Space`, and `Mod+Shift+Arrow` because they are
"common spreadsheet shortcuts" — but `worksheet.ts` doesn't bind
any of them. The help modal would have taught lies on day one. The
review-driven rule: every entry in `SHORTCUTS` must have a one-line
grep proof in the engine's runtime (`worksheet.ts` keyRules /
`text-editor.ts` switch / frontend window-level handler). When
removing a claim is correct, the deeper fix is "add the missing
binding later, in its own PR" — not "lie now and apologize later."

## `formatCombo` only rewrites the modifier tokens — embed the glyphs

`formatCombo` splits a combo on `+` and rewrites `Mod`/`Shift`/`Alt`;
everything else passes through literally. So `'Mod+Arrow'` renders
as `⌘Arrow`, an ambiguous chip with no direction. The fix is to
embed the direction glyphs in the literal part:
`'Mod+Arrow ←/→/↑/↓'` → `⌘Arrow ←/→/↑/↓`. Same trick already used
for the bare-`Arrow` rows. Don't try to teach `formatCombo` about
arrow keys; the call sites are the right place for the per-shortcut
notation choice.

## Hotkeys: open-only, not toggle, and gate `e.repeat`

The first draft used `setShortcutsHelpOpen((prev) => !prev)`. Two
problems: (1) cross-app inconsistency — Slides' `onShowShortcutsHelp`
is open-only, so Cmd+/ behaves differently across the three
editors; (2) holding the chord on macOS auto-repeats the keydown,
which would flicker the dialog. Fix: open-only + early-return on
`e.repeat`. Esc closes via Radix, same as Slides.
