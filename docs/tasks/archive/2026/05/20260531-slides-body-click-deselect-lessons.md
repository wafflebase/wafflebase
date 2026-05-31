# Slides Body-Click Deselect — Lessons

Companion to `20260531-slides-body-click-deselect-todo.md`. PR
[#319](https://github.com/wafflebase/wafflebase/pull/319), commit
`3b009e84`.

## What landed

- `SlidesEditorOptions.bodyHost?: HTMLElement` opt-in option, registered
  inside `attachInteractions` with a strict `e.target === bodyHost`
  filter so the canvas wrap, rulers, and corner keep their own handlers.
- `onBodyPointerDown` mirrors the empty-canvas branch's deselect path
  (`selection.click(null, {})` + `refitPoppedScope`), but skips the
  `startLasso` fall-through (no lasso on the gray gutter).
- Frontend passes `scrollHost` as `bodyHost` — the scroll container that
  already covers "canvas-area minus the ruler gutter", which is exactly
  the click-to-deselect region the user expects.
- 3 unit tests: direct body click clears, child click does NOT clear
  (proves the strict target filter), insert-mode body click is inert.

## Strict `target === bodyHost` is what makes this safe

The body handler sits on `scrollHost`, which contains `canvasWrap`
(canvas + overlay) as a child. Every pointerdown on the slide bubbles
through `scrollHost`, so the listener fires on those events too. The
single-line `if (e.target !== this.options.bodyHost) return;` is the
only thing keeping the body path from stealing canvas-level intents
(lasso start, hit-test, drag). Worth keeping that comment in place if
the handler grows.

This generalises: any time you bind a listener on a container that
already owns interactive children, decide up-front whether you want
*bubbled* events or only *direct* events. `===` on `target` is the
direct-only filter; `currentTarget` reads the listener's host. The two
diverge specifically when there's nested DOM with its own handlers.

## `attachInteractions` is the single binding seam

PR #282's lessons file already documented this: every pointer +
document-keydown listener lives in `attachInteractions`, gated by
`!options.readOnly`. The new body binding inherits both properties for
free — no separate read-only check, no separate cleanup wiring (because
`this.on()` registers in `this.listeners` for `detach()` to drain).

The temptation to add this binding "near where `scrollHost` lives" in
the frontend would have broken the gate: shared-link viewers mount the
editor with `readOnly: true` and expect no mutation. Routing through
the editor's binding seam is the institutional answer.

## Stale dist tripped pre-commit verify:fast

First `pnpm verify:fast` run failed with TypeScript errors in
`packages/slides/src/import/pptx/*` about `BlockMarker` and `marker` on
`Block`. Nothing the body-click change touched. The user's memory note
"Packages consume built dist, not src — rebuild a producer package
after cross-package API changes" predicted this exactly: `@wafflebase/docs`
had pending API changes in src that hadn't been rebuilt to dist, so
slides' typecheck (consuming `@wafflebase/docs` from dist) saw a stale
type surface.

Fix: `pnpm --filter @wafflebase/docs build` then re-run verify:fast.
Generalisable: a verify failure in a package you didn't touch, with
errors about another package's exports, is almost always a stale-dist
problem. Rebuild the named producer first before assuming a real
regression.

## Mobile shell deliberately unwired

`mobile-slides-view.tsx` doesn't expose a ruler-bracketed body region,
so it gets no `bodyHost`. This matches the existing pattern for ruler
options: opt-in shells that don't have the surface simply omit the
option. Documenting the omission in the JSDoc (`"Omit on shells that
don't expose a comparable body region (e.g., the mobile mount)"`)
prevents the next contributor from "fixing" the missing wiring.

## Verification evidence

- `pnpm verify:fast` exit 0 (after rebuilding `@wafflebase/docs`).
- 3 new tests in `packages/slides/test/view/editor/editor.test.ts`
  green via `pnpm exec vitest run test/view/editor/editor.test.ts -t
  "bodyHost click deselect"` — 3 passed, 91 skipped (the `-t` filter).
- Pre-push hook ran `verify:self`, exit 0.
- Manual smoke in `pnpm dev` confirmed: select a shape, click the gray
  area → deselects; ruler drag-out and canvas lasso unaffected.
