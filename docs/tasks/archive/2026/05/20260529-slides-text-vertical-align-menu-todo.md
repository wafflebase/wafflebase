# Slides Text Vertical-Align Context Menu Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Expose `TextElement.data.verticalAnchor` as a user-controllable property via three "Align text top / middle / bottom" items in the slides context menu — Stage 1 of the UI exposure tracked alongside the import work in `20260529-slides-pptx-text-vertical-anchor-todo.md`.

**Architecture:** Reuse the existing `Store.updateElementData(slideId, elementId, patch)` method (already present in `packages/slides/src/store/store.ts:66`) — no new store surface required. Inject items into `elementContextItems` in `packages/slides/src/view/editor/editor.ts` only when the selection is a single `TextElement` (or `TextElement`-bearing placeholder). The context menu module gains optional radio-mark support so the current value reads at a glance.

**Tech Stack:** TypeScript, vanilla-DOM context menu (`packages/slides/src/view/editor/context-menu.ts`), Vitest.

**Scope notes:**
- Three explicit items (top / middle / bottom) rather than a "Reset to default" item. Setting `'top'` writes the field; absent and `'top'` are visually identical (both produce originY = 0).
- No toolbar / Format-menu surface in this stage — stage 2 / 3 of the plan covers those.
- No keyboard shortcut yet — slides keyboard catalog (`slides-keyboard-shortcuts.md`) hasn't reserved one for this.
- Multi-selection deliberately disables the items (existing pattern: most context-menu actions short-circuit on multi-select).

---

## Task 1: Add `selected` indicator to `ContextMenuItem`

**Files:**
- Modify: `packages/slides/src/view/editor/context-menu.ts:9-77`
- Test: `packages/slides/test/view/editor/context-menu.test.ts` (existing file; append cases)

The existing `ContextMenuItem` has `label`, `run`, `disabled?`. Add an optional `selected?: boolean` so callers can mark "this is the currently active choice in a radio group" (e.g. the current `verticalAnchor`). The menu prefixes selected items with a check-mark glyph so they read distinctly without restructuring the menu into a submenu.

- [x] **Step 1: Write failing tests**

In `packages/slides/test/view/editor/context-menu.test.ts`, append:

```ts
describe('showContextMenu — selected indicator', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    dismiss();
    host.remove();
  });

  it('prefixes selected items with a check-mark glyph', () => {
    showContextMenu(host, [
      { label: 'Top',    run: () => undefined, selected: true },
      { label: 'Middle', run: () => undefined },
      { label: 'Bottom', run: () => undefined },
    ], 0, 0);
    const items = Array.from(host.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(items[0]).toMatch(/^✓\s/);
    expect(items[1]).not.toMatch(/^✓/);
    expect(items[2]).not.toMatch(/^✓/);
  });

  it('omits the check-mark glyph entirely when no item is selected', () => {
    showContextMenu(host, [
      { label: 'Top',    run: () => undefined },
      { label: 'Middle', run: () => undefined },
    ], 0, 0);
    for (const li of host.querySelectorAll('li')) {
      expect(li.textContent ?? '').not.toMatch(/^✓/);
    }
  });

  it('still fires run() when a selected item is clicked', () => {
    const handler = vi.fn();
    showContextMenu(host, [
      { label: 'Top', run: handler, selected: true },
    ], 0, 0);
    const li = host.querySelector('li')!;
    li.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledOnce();
  });
});
```

If the existing context-menu test file lacks the `dismiss` import, add it from `../../../src/view/editor/context-menu`.

- [x] **Step 2: Run and confirm failure**

```bash
pnpm --filter @wafflebase/slides test context-menu.test.ts
```

Expect failure: `selected` field unknown / no check-mark prefix on the rendered `<li>`.

- [x] **Step 3: Implement**

In `packages/slides/src/view/editor/context-menu.ts`, change the `ContextMenuItem` interface:

```ts
export interface ContextMenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
  /**
   * Mark this item as the current choice in a radio-group (e.g. the
   * active `verticalAnchor`). The menu prefixes selected items with a
   * check-mark glyph. Has no effect on `run()` semantics.
   */
  selected?: boolean;
  /** Use a horizontal divider when label is the literal string '---'. */
}
```

Inside `showContextMenu`, modify the `li.textContent = item.label;` line so selected items get the glyph. To keep alignment between selected and non-selected items, prefix non-selected with a spacer of equal visual width (two spaces is enough for the glyph's width). Change:

```ts
li.textContent = item.label;
```

to:

```ts
li.textContent = item.selected ? `✓ ${item.label}` : `   ${item.label}`;
```

(Three spaces is the simplest alignment trick that matches the glyph's width in most monospace-or-system fonts. Keep it; refining the alignment is a follow-up.)

If no item in the items array has `selected: true`, OMIT the leading spacer entirely so the menu reads like it does today. Implement by first computing `const anySelected = items.some((i) => i.label !== '---' && i.selected === true);` once at the top of `showContextMenu`, then choosing the prefix based on `anySelected`:

```ts
const anySelected = items.some((i) => i.label !== '---' && i.selected === true);
// ...
li.textContent = anySelected
  ? (item.selected ? `✓ ${item.label}` : `   ${item.label}`)
  : item.label;
```

- [x] **Step 4: Run tests to confirm pass**

```bash
pnpm --filter @wafflebase/slides test context-menu.test.ts
```

Expect 3 new specs pass; existing menu specs unchanged.

- [x] **Step 5: Commit**

```bash
git add packages/slides/src/view/editor/context-menu.ts packages/slides/test/view/editor/context-menu.test.ts
git commit -m "$(cat <<'EOF'
Add optional selected indicator to slides ContextMenuItem

Prefixes the active choice in radio-group-style menus with a
check-mark glyph (and a matching spacer on non-selected items so
labels stay column-aligned). No effect on menus that don't set
the new field. Used by the upcoming "Align text" items.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Inject "Align text top / middle / bottom" into the element context menu

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts:1342-1376` (`elementContextItems`)
- Test: `packages/slides/test/view/editor/context-menu.test.ts` or `packages/slides/test/view/editor/editor.test.ts` (whichever exercises `elementContextItems`)

The new items appear ONLY when the selection contains exactly one `TextElement`. Multi-select hides them.

- [x] **Step 1: Write failing test**

Find the existing slides editor test that exercises `elementContextItems` (or `showContextMenu` invoked by right-click). Look for tests under `packages/slides/test/view/editor/` that build a slide with a text element, right-click it, and assert menu items. If no such test exists, append to `context-menu.test.ts` an editor-facing test that goes through `editor.onContextMenu` directly.

Test cases to add:

```ts
import { createEditor } from '<wherever the test harness lives>';
// (or adapt to the existing harness pattern in the file)

describe('elementContextItems — text vertical align', () => {
  it('shows three text-align items for a single TextElement', async () => {
    const { editor, store, slideId } = await buildEditorWithText({
      blocks: [paragraph('Hello')],
      // verticalAnchor undefined ⇒ "Top" is the implicit current value
    });
    const text = store.read().slides[0].elements[0];
    editor.selection.set([text.id]);
    const items = editor.elementContextItemsForTest(slideId); // expose via private hook OR test-only helper

    const labels = items.map((it) => it.label.trim().replace(/^✓\s+/, ''));
    expect(labels).toContain('Align text top');
    expect(labels).toContain('Align text middle');
    expect(labels).toContain('Align text bottom');
    const top = items.find((it) => it.label.includes('Align text top'))!;
    expect(top.selected).toBe(true); // undefined ⇒ implicit 'top'
  });

  it('marks the configured anchor as selected', async () => {
    const { editor, store, slideId } = await buildEditorWithText({
      blocks: [paragraph('Hi')],
      verticalAnchor: 'bottom',
    });
    const text = store.read().slides[0].elements[0];
    editor.selection.set([text.id]);
    const items = editor.elementContextItemsForTest(slideId);

    const bottom = items.find((it) => it.label.includes('Align text bottom'))!;
    expect(bottom.selected).toBe(true);
    const top = items.find((it) => it.label.includes('Align text top'))!;
    expect(top.selected).toBeFalsy();
  });

  it('omits the items when more than one element is selected', async () => {
    const { editor, store, slideId } = await buildEditorWithText({
      blocks: [paragraph('Hi')],
      extraTextElement: { blocks: [paragraph('Bye')] },
    });
    const ids = store.read().slides[0].elements.map((el) => el.id);
    editor.selection.set(ids);
    const items = editor.elementContextItemsForTest(slideId);

    expect(items.find((it) => it.label.includes('Align text'))).toBeUndefined();
  });

  it('clicking an item calls store.updateElementData with the new anchor', async () => {
    const { editor, store, slideId } = await buildEditorWithText({
      blocks: [paragraph('Hi')],
    });
    const text = store.read().slides[0].elements[0];
    editor.selection.set([text.id]);
    const items = editor.elementContextItemsForTest(slideId);

    const middle = items.find((it) => it.label.includes('Align text middle'))!;
    middle.run();

    const updated = store.read().slides[0].elements[0];
    if (updated.type === 'text') {
      expect(updated.data.verticalAnchor).toBe('middle');
    }
  });
});
```

The exact harness API (`buildEditorWithText`, `elementContextItemsForTest`) depends on the existing test file's idiom. If `elementContextItems` is currently private, expose a test-only accessor either via:
- A `// @ts-expect-error` cast to `any`, OR
- A `private` → method renamed to `_internalElementContextItems` and exposed via `(editor as any)._internalElementContextItems(slideId)`, OR
- Add an `@internal` getter on the editor.

Pick whichever the existing test file uses. If nothing exists, prefer the `(editor as unknown as { elementContextItems(id: string): ContextMenuItem[] })` cast — least-invasive.

- [x] **Step 2: Run tests to confirm failure**

```bash
pnpm --filter @wafflebase/slides test -t "Align text"
```

Expect failure: items missing.

- [x] **Step 3: Implement in `elementContextItems`**

In `packages/slides/src/view/editor/editor.ts`, locate `elementContextItems` (around line 1342). After the existing `groupItem` / `ungroupItem` definitions but before the `return` array, add:

```ts
    // Vertical text alignment for single-text-element selections.
    // Sparse: undefined === 'top' (matches the renderer's fallback).
    // Skip for multi-selection or non-text elements to keep the menu
    // honest about what the action targets.
    const textAlignItems: ContextMenuItem[] = [];
    if (selectedIds.length === 1 && slide) {
      const el = slide.elements.find((e) => e.id === selectedIds[0]);
      if (el?.type === 'text') {
        const current = el.data.verticalAnchor ?? 'top';
        const elementId = el.id;
        textAlignItems.push(
          { label: '---', run: () => undefined },
          {
            label: 'Align text top',
            selected: current === 'top',
            run: () => {
              this.options.store.batch(() =>
                this.options.store.updateElementData(slideId, elementId, { verticalAnchor: 'top' }),
              );
            },
          },
          {
            label: 'Align text middle',
            selected: current === 'middle',
            run: () => {
              this.options.store.batch(() =>
                this.options.store.updateElementData(slideId, elementId, { verticalAnchor: 'middle' }),
              );
            },
          },
          {
            label: 'Align text bottom',
            selected: current === 'bottom',
            run: () => {
              this.options.store.batch(() =>
                this.options.store.updateElementData(slideId, elementId, { verticalAnchor: 'bottom' }),
              );
            },
          },
        );
      }
    }
```

Add `...textAlignItems,` to the returned array. The natural slot is BEFORE the "Bring forward / Send backward" z-order group (so the menu reads roughly: clipboard → duplicate/delete → group → text align → z-order). Insert right before the `{ label: '---', run: () => undefined },` that precedes "Bring forward".

If `selectedIds` or `slide` aren't already declared in `elementContextItems`'s body, re-use the existing locals — the function already does `const slide = this.options.store.read().slides.find((s) => s.id === slideId);` and `const selectedIds = [...this.selection.get()];`.

- [x] **Step 4: Run tests, confirm pass**

```bash
pnpm --filter @wafflebase/slides test -t "Align text"
```

Expect 4 new specs pass.

- [x] **Step 5: Run full slides + docs tests**

```bash
pnpm --filter @wafflebase/slides test --run
pnpm --filter @wafflebase/docs test --run
```

Expect no regressions.

- [x] **Step 6: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts packages/slides/test/view/editor/context-menu.test.ts
git commit -m "$(cat <<'EOF'
Add "Align text top/middle/bottom" to slides context menu

Exposes TextElement.data.verticalAnchor for user editing. Items
appear only when a single TextElement is selected; multi-select
hides them to keep the action target unambiguous. The current
value is marked with the new ContextMenuItem.selected indicator,
so "Top" reads as active for unset (default-top) text boxes.

Closes Stage 1 of the verticalAnchor UI rollout. Toolbar and side
panel surfaces are tracked separately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Manual smoke

**Files:** None (verification only).

- [x] **Step 1: Start dev server**

```bash
pnpm dev
```

- [x] **Step 2: Verify on imported PPTX**

Open or re-import the Yorkie deck. Right-click slide 1's title:
- Three "Align text" items appear after the group/ungroup section.
- "Align text bottom" has the check mark (the imported value).
- Clicking "Align text top" moves the title to the top of the placeholder; the menu reopens with "Align text top" checked.
- Refreshing the page preserves the new value (Yorkie persistence).

- [x] **Step 3: Verify on a new text box**

Create a fresh slide, insert a text box, type some text. Right-click:
- "Align text top" is checked (unset ⇒ implicit top).
- Switching to "Align text middle" / "bottom" moves the text accordingly.
- The visible position matches the committed render before AND after entering edit mode (no snap; covered by the editor parity work).

- [x] **Step 4: Verify multi-select hides the items**

Select two text boxes (shift-click). Right-click:
- No "Align text" items in the menu.

---

## Out of scope (follow-ups)

- **Toolbar toggle** (`slides-toolbar-redesign.md` Object-mode toolbar) — Stage 2.
- **Side panel** under text-box options alongside autofit / padding — Stage 3.
- **Keyboard shortcuts** — coordinate with `slides-keyboard-shortcuts.md` before reserving keys.
- **Apply to all text boxes inside a group** when a group is selected — current scope is single-element only.
- **Internationalization** (`Align text top` → 텍스트 상단 정렬) — slides UI strings are English-only today; revisit when i18n lands.
