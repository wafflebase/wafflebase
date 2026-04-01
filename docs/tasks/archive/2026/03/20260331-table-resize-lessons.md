# Table Resize — Lessons Learned

## 1. Yorkie SDK/React package version mismatch

`package.json` required `@yorkie-js/react@0.7.3-alpha` but `0.7.1` was installed.
`Tree` class was not exported in 0.7.1 but was in 0.7.3-alpha, causing
`Tree is not a constructor` at runtime.

**Rule:** After cloning or switching branches, always run `pnpm install` to
ensure installed versions match `package.json` specs. Version mismatches in
alpha packages are silent — no lockfile warning.

## 2. `@yorkie-js/react` bundles its own copy of SDK classes

`@yorkie-js/react` includes a bundled copy of `Tree`, `Text`, etc.
`doc.update()` internally does `value instanceof Tree` against the
**react bundle's** Tree class. Importing `Tree` from `@yorkie-js/sdk`
creates a different class identity, so `instanceof` fails silently —
the value is treated as a plain object instead of a CRDT.

**Rule:** Always import CRDT types (`Tree`, `Text`) from the same package
that provides the document context. If using `@yorkie-js/react`'s
`useDocument`, import `Tree` from `@yorkie-js/react`, not `@yorkie-js/sdk`.

## 3. Canvas element selection in multi-canvas container

The editor container holds 3 canvases: horizontal ruler, vertical ruler,
and the document canvas. `container.querySelector('canvas')` returns the
first (ruler) canvas, not the document canvas.

**Rule:** When a container has multiple canvases, use a data attribute
(`data-role="doc-canvas"`) to disambiguate. Don't rely on DOM order.

## 4. CSS cursor on canvas vs container

`editor.ts` sets `canvas.style.cursor = 'text'` directly on the document
canvas. Setting cursor on the parent container has no effect because the
canvas's own cursor style takes precedence (child styles override parent).

**Rule:** To change cursor over a canvas element, change the cursor on the
canvas element itself, not its parent container.

## 5. Store `refresh()` reloads from store

`Doc.refresh()` reloads the document from the store. If you modify
in-memory data (e.g., `td.rowHeights.splice(...)`) but don't persist via
`store.updateTableAttrs()` before `refresh()`, the changes are lost.

**Rule:** Always persist to the store before calling `refresh()`. The
in-memory model is not the source of truth after refresh.

## 6. Reuse existing infrastructure

The editor already had a `dragGuideline` variable and `renderPaintOnly()`
for the ruler's drag guideline. Instead of building a new rendering path
through DocCanvas, we reused the same mechanism via a callback
(`textEditor.onDragGuideline`). This saved a task's worth of work.

**Rule:** Before adding new rendering infrastructure, check if an existing
mechanism can be reused. The `editor.ts` orchestrator often has patterns
worth following.
