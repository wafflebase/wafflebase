# Lessons — slides text-box toolbar focus fix

## The bug class: toolbar steals focus from a commit-on-blur editor

The slides text box (docs `initializeTextBox`) commits + detaches on ANY
`blur` of its hidden `<textarea>`. Any UI control that takes focus on
click therefore ends the edit session *before* the control's `onClick`
runs. Docs is immune only because its main editor is always mounted and
never tears down on blur.

**Rule:** when an editor commits/tears-down on blur, every toolbar
control must either (a) not take focus (`onMouseDown` →
`preventDefault`), or (b) be exempted from the blur-commit by the editor.

## Two trigger classes need two mechanisms

- **Direct buttons/toggles** → `onMouseDown={(e) => e.preventDefault()}`.
  Focus never leaves the textarea — simplest, best UX (keep typing).
- **Radix dropdowns** → a trigger-level `preventDefault` is NOT enough:
  `@radix-ui/react-menu` focuses menu items on *pointer hover*
  (`MenuItemImpl.onPointerMove` → `item.focus()`), so the textarea blurs
  as soon as the pointer enters the open menu. Guard at the editor:
  skip the blur-commit when `e.relatedTarget` is inside a
  `data-text-edit-keepalive` element; the menu item's existing
  `editor.focus()` restores focus, and `onCloseAutoFocus` prevention
  stops the close from bouncing focus off the textarea.

Don't theorize about framework focus behavior — read the installed source
(`node_modules/.../@radix-ui/react-menu/dist/index.mjs`) to confirm.

## Frontend component tests ARE possible here

The package "convention" comment said JSX rendering isn't supported in the
Node runner, but the vitest `environment` is already `jsdom` and
`react-dom` 19 is a dependency. A render test works with
`react-dom/client` `createRoot` + `react`'s `act`, no `@testing-library`
needed. Two gotchas:

1. The runner glob is `tests/**/*.test.ts` — a `.test.tsx` file is
   silently **not collected**. Keep `.test.ts` and use
   `React.createElement` instead of JSX.
2. Set `globalThis.IS_REACT_ACT_ENVIRONMENT = true` or React floods
   stderr with "testing environment is not configured to support act()".

## Cross-package change hygiene (reinforced existing memory)

`initializeTextBox` lives in `@wafflebase/docs`; rebuild docs
(`pnpm --filter @wafflebase/docs build`) after editing its `src/` so the
slides/frontend consumers see the runtime change. See
`[[project_packages_consume_built_dist]]`.

## Verify before claiming

Ran `pnpm verify:fast` to EXIT=0 (1274 frontend tests incl. the new 14)
and the targeted suites individually before reporting done — not just the
tail of one log.
