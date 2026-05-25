# Slides text-box toolbar steals editor focus → edit mode collapses

## Problem

In the slides text-box edit mode, clicking a toolbar control (reported:
the bullet-list icon) does **not** apply the action and instead drops out
of text editing entirely.

## Root cause

The slides text-box reuses the docs `initializeTextBox`. Its hidden
`<textarea>` commits on **any** blur:

- `packages/docs/src/view/text-box-editor.ts` `handleBlur` → fires
  `opts.onCommit(...)` unconditionally (no `relatedTarget` guard).
- The slides `onCommit` (`packages/slides/src/view/editor/editor.ts`
  ~L1628) persists then calls `finishEditMode()` → detaches the text box,
  `activeTextEditor = null`.

Event order on a toolbar click:

1. `mousedown` on the button → focus leaves the textarea → `blur`.
2. `handleBlur` → `onCommit` → `finishEditMode()` → **edit mode ends,
   editor detached**.
3. `click` → React `onClick` runs `editor.toggleList(...)` on the
   already-detached editor → no-op; `editor.focus()` targets a removed
   textarea.

So the toggle never applies and editing collapses. Docs is immune: its
main editor is always mounted, so blur never tears it down.

Two distinct trigger classes:

- **Direct buttons / toggles** (bullet, numbered, indent/outdent, link,
  bold/italic/underline/strike): a plain `mousedown` moves focus.
- **Dropdowns** (block style, alignment, text/highlight color): Radix
  focuses menu items on hover (`item.focus()` —
  `@radix-ui/react-menu` `MenuItemImpl.onPointerMove`), so the textarea
  blurs as soon as the pointer enters the menu — a trigger-level
  `preventDefault` can't stop it.

## Fix

Shared components in `packages/frontend/src/components/text-formatting/`
(used by docs + slides; changes are inert/beneficial for docs):

- [x] **Direct buttons/toggles** — add `onMouseDown={(e) =>
  e.preventDefault()}` so the textarea never blurs (no commit, no
  detach, focus retained for continued typing).
  - [x] `text-paragraph-group.tsx`: numbered, bulleted, outdent, indent
  - [x] `text-format-group.tsx`: bold, italic, underline, strike, link

- [x] **Dropdowns** — Radix hover-focus is unavoidable, so guard at the
  editor instead:
  - [x] `packages/docs/src/view/text-box-editor.ts` `handleBlur(e)`:
    skip commit when `relatedTarget` is inside
    `[data-text-edit-keepalive]` (keep the text box mounted; the menu
    item handler re-focuses via its existing `editor.focus()`).
  - [x] Tag each dropdown **trigger** + **content** with
    `data-text-edit-keepalive`; add `onCloseAutoFocus={(e) =>
    e.preventDefault()}` to content so closing the menu doesn't bounce
    focus off the just-refocused textarea.
  - [x] `text-style-group.tsx` (block style), `text-paragraph-group.tsx`
    (alignment), `text-format-group.tsx` (text + highlight color)

## Verify

- [x] `pnpm verify:fast` — green (797 tests).
- [x] Regression test (editor-side guard):
  `packages/docs/test/view/text-box-editor.test.ts` — blur into a
  `[data-text-edit-keepalive]` control (button + menu-item descendant)
  does NOT commit; a genuine outside blur still commits.
- [x] Regression test (React layer):
  `packages/frontend/tests/components/text-formatting/toolbar-focus.test.ts`
  — renders the three groups in jsdom; asserts the 9 direct
  buttons/toggles `preventDefault` mousedown, the bullet click still
  calls `toggleList('unordered')`, and the 3 dropdown triggers carry
  `data-text-edit-keepalive`.
- [ ] Manual smoke in `pnpm dev` (desktop + one touch check): enter a
  slides text box, click bullet → applies, stays in edit mode; repeat
  for numbered/indent/bold/link and the style/alignment/color dropdowns.

## Review

Two mechanisms, each the canonical fix for its trigger class:

- **Direct buttons/toggles** → `preventDefault` on `mousedown`. The
  textarea never blurs, so there is no commit/detach and focus is kept
  for continued typing. Simplest and most robust for click-only controls
  (this is the exact case the user reported with the bullet icon).
- **Dropdowns** → editor-side `relatedTarget` guard keyed on a
  `data-text-edit-keepalive` marker. Needed because Radix focuses menu
  items on pointer hover (`@radix-ui/react-menu` `MenuItemImpl`), which a
  trigger-level `preventDefault` cannot stop. `onCloseAutoFocus`
  prevention keeps focus in the text box after a selection.

Scope: the `handleBlur` change lives in `initializeTextBox`, which is
slides-only (docs' main editor uses `text-editor.ts` directly), so docs
behavior is unaffected. The `data-text-edit-keepalive` attributes and
`onCloseAutoFocus` are inert/beneficial in the docs toolbar (its editor
never tore down on blur to begin with).

Not done: live browser smoke (needs `pnpm dev`).

### Code review outcome (general-purpose reviewer, verdict "With fixes")

- **Important — headline `preventDefault` path untested** → fixed: added
  `toolbar-focus.test.ts` (React-layer render test) covering both
  mechanisms. The frontend had no component-render tests, but its vitest
  env is already `jsdom`, so `react-dom/client` + `react.act` renders
  cleanly with no new dependency; kept `.test.ts` + `React.createElement`
  to match the package's `tests/**/*.test.ts` runner convention.
- **Minor — `data-text-edit-keepalive` magic string duplicated across
  packages (no shared const)** → not extracted. Both sides are now pinned
  by independent tests (docs guard test + frontend attribute test), so a
  one-sided typo is caught by CI; a cross-package const would add
  coupling for little additional safety. Left as an optional follow-up.
- **Minor — `relatedTarget instanceof HTMLElement` fails open for
  SVG/other targets** → no change. Theoretical only: focusable target is
  the button, icons are `pointer-events: none` and non-focusable.
- **Minor — touch/mobile unverified** → no code change. `preventDefault`
  on mousedown does not cancel the synthesized click after `touchend`;
  added a touch check to the manual smoke list.

Reviewer confirmed (verified against source, not assumed): the
blur→commit→detach race, scope isolation (`initializeTextBox` is
slides-only; docs editor uses `text-editor.ts`), Radix Toggle dispatching
`onPressedChange` from click (so mousedown `preventDefault` is safe),
prop forwarding through `Toggle`/`DropdownMenuContent`, and selection
preservation across the keepalive blur.
