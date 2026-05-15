# Slides Toolbar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/design/slides/slides-toolbar-redesign.md`

**Goal:** Replace the current always-on Slides toolbar with a single morphing toolbar (Idle / Object-selected / Text-editing states), consolidate align/distribute into an Arrange dropdown, and fill commonly-missing affordances (Undo/Redo, Image insert, Background, Shape Border, Image Replace/Crop, text formatting in text-edit mode).

**Architecture:** New `slides/toolbar/` directory with one component per state and per element type. `SlidesEditor` gains `isTextEditing()` / `getActiveTextEditor()` / `onTextEditingChange()` getters. Text formatting controls extracted from `docs-formatting-toolbar.tsx` into `components/text-formatting/` and shared with the docs toolbar. New optional model fields `ShapeElement.data.stroke.dash` and `TextElement.data.stroke`.

**Tech Stack:** TypeScript, React 19, Radix UI primitives, Tabler icons, Vitest (unit + interaction), Playwright/Puppeteer visual harness via `pnpm verify:browser:docker`.

**Delivery:** Single PR; ~13 task-sized commits in dependency order. Each commit must be independently green on `pnpm verify:fast`.

**Read first:**
- `docs/design/slides/slides-toolbar-redesign.md` — the spec
- `docs/design/slides/slides.md` § Editor UI — current toolbar contract
- `packages/frontend/src/app/slides/slides-formatting-toolbar.tsx` — what's being replaced
- `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` — source of extraction (PR 3)
- `packages/slides/src/view/editor/editor.ts` — `editingElementId` lives at line 243; `getEditingElementId()` at line 558

---

## Task 1: Add `stroke.dash` to ShapeElement and `stroke` to TextElement

**Files:**
- Modify: `packages/slides/src/model/element.ts`
- Test: `packages/slides/src/model/element.test.ts`

The redesign needs Border weight/dash for shapes and a stroke field on text elements (for box-level border in object-selected text state). Both are optional, so existing Yorkie documents stay valid.

- [ ] **Step 1: Write the failing tests**

Append to `element.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ShapeElement, TextElement } from './element';

describe('ShapeElement.data.stroke.dash', () => {
  it('accepts solid/dashed/dotted', () => {
    const shape: ShapeElement = {
      id: 's1',
      type: 'shape',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { kind: 'rect', stroke: { color: '#000', width: 1, dash: 'dashed' } },
    };
    expect(shape.data.stroke?.dash).toBe('dashed');
  });
});

describe('TextElement.data.stroke', () => {
  it('is optional and accepts the same shape as ShapeElement.stroke', () => {
    const text: TextElement = {
      id: 't1',
      type: 'text',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { blocks: [], stroke: { color: '#000', width: 2, dash: 'solid' } },
    };
    expect(text.data.stroke?.width).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
pnpm --filter @wafflebase/slides test element
```

Expected: type errors / test failures referencing `dash` and missing `stroke`.

- [ ] **Step 3: Add the optional fields**

In `element.ts`, extend the existing types. Find `ShapeElement` and update its `stroke`:

```ts
type Stroke = {
  color: string;
  width: number;
  dash?: 'solid' | 'dashed' | 'dotted';
};

type ShapeElement = ElementBase & {
  type: 'shape';
  data: {
    kind: ShapeKind;
    fill?: string;
    stroke?: Stroke;
    adjustments?: number[];
  };
};

type TextElement = ElementBase & {
  type: 'text';
  data: {
    blocks: docs.Block[];
    stroke?: Stroke;            // NEW: optional box-level border
  };
};
```

Export the `Stroke` type alias.

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm --filter @wafflebase/slides test element
```

Expected: PASS.

- [ ] **Step 5: Verify no broken consumers**

```bash
pnpm verify:fast
```

Expected: PASS. Optional fields should not break any existing code paths.

- [ ] **Step 6: Commit**

```bash
git add packages/slides/src/model/element.ts packages/slides/src/model/element.test.ts
git commit -m "$(cat <<'EOF'
Add optional stroke.dash and TextElement.stroke for toolbar redesign

The Slides toolbar redesign needs Border dash for shapes and a
stroke field on text elements for the box-level border control.
Both fields are optional so existing Yorkie documents remain valid
without migration.
EOF
)"
```

---

## Task 2: Add text-editing event + EditorAPI getter to SlidesEditor

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`
- Test: `packages/slides/src/view/editor/editor.test.ts` (create if missing) or extend `text-box-editor.test.ts`

The toolbar state machine needs `isTextEditing()`, `onTextEditingChange(cb)`, and `getActiveTextEditor()` to switch into State 3. `editingElementId` already exists; we expose it as a higher-level API + event.

- [ ] **Step 1: Locate where `editingElementId` is set/cleared**

```bash
grep -n "this.editingElementId" packages/slides/src/view/editor/editor.ts
```

Expected: lines ~832 (set on enter) and ~905 (clear on exit). Note the line numbers — both call sites need to fire the new event.

- [ ] **Step 2: Write the failing test**

Add to `text-box-editor.test.ts` (or new editor test):

```ts
import { describe, expect, it } from 'vitest';
import { SlidesEditor } from './editor';
import { MemSlidesStore } from '../../store/memory';

describe('SlidesEditor text-editing API', () => {
  it('isTextEditing reflects editingElementId', async () => {
    const store = new MemSlidesStore();
    const slideId = store.addSlide('blank');
    const elementId = store.addElement(slideId, {
      type: 'text',
      frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
      data: { blocks: [] },
    });
    const editor = makeTestEditor(store, slideId);
    expect(editor.isTextEditing()).toBe(false);

    let calls = 0;
    const off = editor.onTextEditingChange(() => calls++);

    editor.enterTextEditing(elementId);
    expect(editor.isTextEditing()).toBe(true);
    expect(editor.getActiveTextEditor()).not.toBeNull();
    expect(calls).toBe(1);

    editor.exitTextEditing();
    expect(editor.isTextEditing()).toBe(false);
    expect(editor.getActiveTextEditor()).toBeNull();
    expect(calls).toBe(2);
    off();
  });
});

// helper if not already present in the test file
function makeTestEditor(store: MemSlidesStore, slideId: string): SlidesEditor { /* ... */ }
```

If `makeTestEditor` doesn't exist, copy the canvas/overlay setup from another existing editor test (e.g. `select.test.ts`).

- [ ] **Step 3: Run test to verify failure**

```bash
pnpm --filter @wafflebase/slides test editor
```

Expected: FAIL — `isTextEditing` / `onTextEditingChange` / `getActiveTextEditor` not on SlidesEditor.

- [ ] **Step 4: Implement on SlidesEditor**

In `editor.ts`:

a) Add to the interface declaration block (near line 145 where `getEditingElementId` is declared):

```ts
isTextEditing(): boolean;
onTextEditingChange(cb: () => void): () => void;
getActiveTextEditor(): EditorAPI | null;   // EditorAPI from @wafflebase/docs
```

b) Add private listener array (near where other listener fields are declared):

```ts
private textEditingListeners: Array<() => void> = [];
```

c) Add method implementations (next to `getEditingElementId`):

```ts
isTextEditing(): boolean {
  return this.editingElementId !== null;
}

onTextEditingChange(cb: () => void): () => void {
  this.textEditingListeners.push(cb);
  return () => {
    this.textEditingListeners = this.textEditingListeners.filter((c) => c !== cb);
  };
}

getActiveTextEditor(): EditorAPI | null {
  return this.activeTextEditor ?? null;
}
```

d) Where text-editing is entered (~line 832, after `this.editingElementId = elementId;`), capture the docs `EditorAPI` reference (the `text-box-editor.ts` module already creates one — surface it back to SlidesEditor via the existing wiring). Then fire:

```ts
for (const cb of this.textEditingListeners) cb();
```

e) Where text-editing is exited (~line 905, after `this.editingElementId = null;`), clear `this.activeTextEditor = null` and fire the same listeners.

- [ ] **Step 5: Run test to verify pass**

```bash
pnpm --filter @wafflebase/slides test editor
```

Expected: PASS.

- [ ] **Step 6: Run all slides tests**

```bash
pnpm --filter @wafflebase/slides test
```

Expected: PASS (no regressions in existing editor tests).

- [ ] **Step 7: Commit**

```bash
git add packages/slides/src/view/editor/editor.ts packages/slides/src/view/editor/text-box-editor.test.ts
git commit -m "$(cat <<'EOF'
Expose text-editing state and active EditorAPI on SlidesEditor

The toolbar redesign uses these to switch into the text-editing
state and bind shared text formatting controls to the docs editor
that owns the active text box.
EOF
)"
```

---

## Task 3: Extract shared text-formatting components from docs toolbar

**Files:**
- Create: `packages/frontend/src/components/text-formatting/text-style-group.tsx`
- Create: `packages/frontend/src/components/text-formatting/text-format-group.tsx`
- Create: `packages/frontend/src/components/text-formatting/text-paragraph-group.tsx`
- Create: `packages/frontend/src/components/text-formatting/index.ts`
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx`

Pure refactor: pull the B/I/U/Color/Highlight/Link group, the Font/Size group, and the Align/List/Indent group out of `docs-formatting-toolbar.tsx` into reusable components. The docs toolbar then composes them. **Visual + interaction tests must pass with no snapshot diffs after this task.**

- [ ] **Step 1: Identify the three groups in docs toolbar**

```bash
grep -n "IconBold\|IconItalic\|IconUnderline\|IconAlignLeft\|IconList\|IconLink\|IconTypography\|IconHighlight" packages/frontend/src/app/docs/docs-formatting-toolbar.tsx
```

Note the line ranges for each group to plan the extraction.

- [ ] **Step 2: Create `text-format-group.tsx`**

Each component takes `{ editor: EditorAPI | null; disabled?: boolean }`. Move the JSX + handlers for Bold/Italic/Underline/Strike/Color/Highlight/Link from docs toolbar into this file unchanged. The `EditorAPI` type comes from `@wafflebase/docs`. Use the existing `useState`/`useEffect` hooks for marks state if present in docs toolbar; if those hooks live elsewhere, leave them in docs and pass derived props in.

```ts
import type { EditorAPI } from '@wafflebase/docs';
// ... copy imports, helper components (e.g. ColorPickerGrid), constants

export interface TextFormatGroupProps {
  editor: EditorAPI | null;
  disabled?: boolean;
}

export function TextFormatGroup({ editor, disabled }: TextFormatGroupProps) {
  // Bold/Italic/Underline/Strike Toggles + Color/Highlight DropdownMenus + Link button
  // exact JSX copied from docs-formatting-toolbar.tsx
}
```

- [ ] **Step 3: Create `text-style-group.tsx`** — Font family / Size dropdowns. Same pattern.

- [ ] **Step 4: Create `text-paragraph-group.tsx`** — Align ▾, List ▾, Indent in/out. Same pattern. Re-export `AlignmentDropdown` from inside this file.

- [ ] **Step 5: Create `index.ts` barrel**

```ts
export { TextStyleGroup } from './text-style-group';
export { TextFormatGroup } from './text-format-group';
export { TextParagraphGroup } from './text-paragraph-group';
export type { TextFormatGroupProps } from './text-format-group';
// etc.
```

- [ ] **Step 6: Replace inline JSX in `docs-formatting-toolbar.tsx`**

Remove the now-extracted JSX blocks; replace with:

```tsx
import { TextStyleGroup, TextFormatGroup, TextParagraphGroup } from '@/components/text-formatting';
// ...
<TextStyleGroup editor={editor} />
<TextFormatGroup editor={editor} />
<TextParagraphGroup editor={editor} />
```

Keep all docs-specific items (block-type dropdown, Table picker, Image insert, DOCX/PDF export, overflow menu) in the docs toolbar — they don't move.

- [ ] **Step 7: Run docs unit + interaction tests**

```bash
pnpm --filter @wafflebase/frontend test docs
```

Expected: PASS.

- [ ] **Step 8: Run docs visual harness**

```bash
pnpm verify:browser:docker -- --grep docs
```

Expected: PASS with **no snapshot updates required**. If snapshots diff, the extraction changed behavior — investigate before continuing.

- [ ] **Step 9: Manual smoke**

Start `pnpm dev`. Open a docs document. Verify B/I/U/S, color, highlight, link, font, size, alignment, list, indent all work. (5 minutes.)

- [ ] **Step 10: Commit**

```bash
git add packages/frontend/src/components/text-formatting/ packages/frontend/src/app/docs/docs-formatting-toolbar.tsx
git commit -m "$(cat <<'EOF'
Extract docs text-formatting controls into shared components

Slides toolbar redesign needs the same B/I/U/Color/Align widgets
inside its text-edit state. Extract them into
components/text-formatting/ so docs and slides share one
implementation. Pure refactor; docs visual + interaction tests
unchanged.
EOF
)"
```

---

## Task 4: Toolbar scaffold — directory, state derivation, global zones

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/index.tsx`
- Create: `packages/frontend/src/app/slides/toolbar/state.ts`
- Create: `packages/frontend/src/app/slides/toolbar/state.test.ts`
- Create: `packages/frontend/src/app/slides/toolbar/slide-group.tsx`
- Create: `packages/frontend/src/app/slides/toolbar/global-controls.tsx`

This task lays down the `slides/toolbar/` directory with the morphing shell, but the contextual middle is a placeholder. Old `slides-formatting-toolbar.tsx` stays mounted in `slides-detail.tsx` until Task 12. The new toolbar is tested in isolation.

- [ ] **Step 1: Write the failing state-derivation test**

`state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getToolbarState } from './state';
// Use mocks for SlidesEditor + SlidesStore — only the methods we read.

describe('getToolbarState', () => {
  it('returns idle when no selection and not editing', () => {
    const editor = mockEditor({ selection: [], textEditing: false });
    expect(getToolbarState(editor, mockStore())).toEqual({ kind: 'idle' });
  });
  it('returns text-edit when isTextEditing', () => {
    const editor = mockEditor({ selection: ['e1'], textEditing: true, editingId: 'e1' });
    const s = getToolbarState(editor, mockStore({ elements: [{ id: 'e1', type: 'text' }] }));
    expect(s.kind).toBe('text-edit');
  });
  it('classifies single-shape selection', () => {
    const editor = mockEditor({ selection: ['e1'] });
    const s = getToolbarState(editor, mockStore({ elements: [{ id: 'e1', type: 'shape' }] }));
    expect(s).toMatchObject({ kind: 'object', selectionType: 'shape' });
  });
  it('classifies mixed selection', () => {
    const editor = mockEditor({ selection: ['e1', 'e2'] });
    const s = getToolbarState(editor, mockStore({
      elements: [{ id: 'e1', type: 'shape' }, { id: 'e2', type: 'image' }],
    }));
    expect(s).toMatchObject({ kind: 'object', selectionType: 'mixed' });
  });
  // helpers inline
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @wafflebase/frontend test toolbar/state
```

Expected: FAIL — `getToolbarState` not defined.

- [ ] **Step 3: Implement `state.ts`**

```ts
import type { SlidesEditor, SlidesStore, Element } from '@wafflebase/slides';
import type { EditorAPI } from '@wafflebase/docs';

export type ToolbarState =
  | { kind: 'idle' }
  | { kind: 'object'; selectionType: 'shape' | 'image' | 'text-element' | 'mixed'; ids: readonly string[] }
  | { kind: 'text-edit'; elementId: string; textEditor: EditorAPI };

export function getToolbarState(
  editor: SlidesEditor | null,
  store: SlidesStore | null,
): ToolbarState {
  if (!editor) return { kind: 'idle' };
  if (editor.isTextEditing()) {
    const elementId = editor.getEditingElementId();
    const textEditor = editor.getActiveTextEditor();
    if (elementId && textEditor) return { kind: 'text-edit', elementId, textEditor };
    return { kind: 'idle' };
  }
  const selection = editor.getSelection();
  if (selection.length === 0) return { kind: 'idle' };

  const slideId = editor.getCurrentSlideId();
  const slide = store && slideId
    ? store.read().slides.find((s) => s.id === slideId)
    : undefined;
  if (!slide) return { kind: 'idle' };
  const types = new Set<Element['type']>();
  for (const el of slide.elements) {
    if (selection.includes(el.id)) types.add(el.type);
  }
  if (types.size === 0) return { kind: 'idle' };
  const single = types.size === 1 ? types.values().next().value as Element['type'] : null;
  const selectionType = single
    ? (single === 'text' ? 'text-element' : single)
    : 'mixed';
  return { kind: 'object', selectionType, ids: selection };
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm --filter @wafflebase/frontend test toolbar/state
```

Expected: PASS.

- [ ] **Step 5: Implement `slide-group.tsx`**

Lift the `+ Slide ▾` split-button JSX from `slides-formatting-toolbar.tsx` lines ~263–294 into this new file. Same `onAddBlankSlide` + `onOpenLayoutPicker` props/logic. No behavior change.

- [ ] **Step 6: Implement `global-controls.tsx`**

Two exports: `<UndoRedoGroup store={store} />` and `<RightGlobals store={store} editor={editor} onToggleThemePanel={...} themePanelOpen={...} />`.

```tsx
export function UndoRedoGroup({ store }: { store: SlidesStore | null }) {
  const [undoable, setUndoable] = useState(false);
  const [redoable, setRedoable] = useState(false);
  useEffect(() => {
    if (!store) return;
    const refresh = () => {
      setUndoable(store.canUndo());
      setRedoable(store.canRedo());
    };
    refresh();
    return store.onChange?.(refresh);
  }, [store]);
  return (
    <>
      <Tooltip>{/* ↶ Undo button → store?.undo() */}</Tooltip>
      <Tooltip>{/* ↷ Redo button → store?.redo() */}</Tooltip>
    </>
  );
}
```

`RightGlobals` keeps the existing Theme toggle and adds the Present button (lift the JSX from `slides-present-button.tsx` if it's a thin wrapper, otherwise import the existing component).

- [ ] **Step 7: Implement `index.tsx` (the morphing shell)**

```tsx
export function SlidesToolbar(props: SlidesToolbarProps) {
  const { editor, store, theme, onToggleThemePanel, themePanelOpen } = props;
  const [state, setState] = useState<ToolbarState>(() => getToolbarState(editor, store));

  useEffect(() => {
    if (!editor) return;
    const refresh = () => setState(getToolbarState(editor, store));
    refresh();
    const offs = [
      editor.onSelectionChange(refresh),
      editor.onCurrentSlideChange(refresh),
      editor.onTextEditingChange(refresh),
      store?.onChange?.(refresh) ?? (() => {}),
    ];
    return () => offs.forEach((off) => off());
  }, [editor, store]);

  return (
    <Toolbar className="flex h-10 items-center gap-1 border-b px-2">
      <UndoRedoGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      <SlideGroup store={store} />
      <ToolbarSeparator className="mx-1" />
      {/* contextual middle — placeholder until later tasks */}
      <div data-testid="toolbar-contextual" className="flex flex-1 items-center gap-1">
        {state.kind === 'idle' && null /* idle-section in Task 6 */}
        {state.kind === 'object' && null /* object-section in Tasks 8–10 */}
        {state.kind === 'text-edit' && null /* text-edit-section in Task 11 */}
      </div>
      <RightGlobals editor={editor} store={store} onToggleThemePanel={onToggleThemePanel} themePanelOpen={themePanelOpen} />
    </Toolbar>
  );
}
```

- [ ] **Step 8: Verify imports compile**

```bash
pnpm --filter @wafflebase/frontend typecheck
```

Expected: PASS. The component is unused so no runtime impact yet.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/
git commit -m "$(cat <<'EOF'
Scaffold morphing slides toolbar with state derivation

New slides/toolbar/ directory holds the redesigned toolbar shell.
Old slides-formatting-toolbar.tsx remains mounted; the new toolbar
is built up in isolation across the next several commits, then
swapped in at the end.
EOF
)"
```

---

## Task 5: Insert group with new Image button

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/insert-group.tsx`
- Create: `packages/frontend/src/app/slides/insert-image.ts`
- Test: `packages/frontend/src/app/slides/toolbar/insert-group.test.tsx`

The Insert group (Select / Text / Image / Shape ▾ / Line ▾) is shared by Idle and Object states. Image is new. The insert helper is centralised so the toolbar button, drag-drop, and clipboard paste paths all funnel through it (per spec risk row).

- [ ] **Step 1: Write the failing helper test**

`insert-image.test.ts`:

```ts
describe('insertImageOnSlide', () => {
  it('uploads then adds an image element centered on the slide', async () => {
    const store = new MemSlidesStore();
    const slideId = store.addSlide('blank');
    const file = new File(['fake-bytes'], 'a.png', { type: 'image/png' });
    const upload = vi.fn().mockResolvedValue({ url: 'https://cdn/test/a.png', w: 200, h: 100 });

    const elementId = await insertImageOnSlide({ store, slideId, file, upload });

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const el = slide.elements.find((e) => e.id === elementId)!;
    expect(el.type).toBe('image');
    expect((el as ImageElement).data.src).toBe('https://cdn/test/a.png');
    // centered on the 1920×1080 logical canvas
    expect(el.frame.x).toBeCloseTo((1920 - 200) / 2);
    expect(el.frame.y).toBeCloseTo((1080 - 100) / 2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm --filter @wafflebase/frontend test insert-image
```

- [ ] **Step 3: Implement `insert-image.ts`**

```ts
export interface InsertImageArgs {
  store: SlidesStore;
  slideId: string;
  file: File;
  upload: (file: File) => Promise<{ url: string; w: number; h: number }>;
}

export async function insertImageOnSlide(args: InsertImageArgs): Promise<string> {
  const { url, w, h } = await args.upload(args.file);
  let elementId = '';
  args.store.batch(() => {
    elementId = args.store.addElement(args.slideId, {
      type: 'image',
      frame: {
        x: (1920 - w) / 2,
        y: (1080 - h) / 2,
        w, h, rotation: 0,
      },
      data: { src: url },
    });
  });
  return elementId;
}
```

The default `upload` for the toolbar button uses the existing workspace image API used by drag-drop today — find it in the codebase and pass it in from the toolbar's parent.

- [ ] **Step 4: Verify helper test passes**

```bash
pnpm --filter @wafflebase/frontend test insert-image
```

- [ ] **Step 5: Implement `insert-group.tsx`**

Five toggles in order: Select, Text, Image (new), Shape (existing `<ShapePicker>`), Line (existing `<LinePicker>`). Take `editor`, `onImagePick: () => void`, and `disabled` props.

```tsx
export function InsertGroup({ editor, onImagePick, disabled }: InsertGroupProps) {
  const insertMode = useInsertMode(editor);   // small hook lifting current logic
  return (
    <>
      <Toggle pressed={insertMode === null} onClick={() => editor?.setInsertMode(null)} aria-label="Select"><IconPointer size={16} /></Toggle>
      <Toggle pressed={insertMode === 'text'} onPressedChange={(p) => editor?.setInsertMode(p ? 'text' : null)} aria-label="Text box"><IconLetterT size={16} /></Toggle>
      <button type="button" onClick={onImagePick} aria-label="Insert image" disabled={disabled}><IconPhoto size={16} /></button>
      <ShapePicker activeKind={...} onSelect={(k) => editor?.setInsertMode(k)} disabled={disabled} />
      <LinePicker activeKind={...} onSelect={(k) => editor?.setInsertMode(k)} disabled={disabled} />
    </>
  );
}
```

- [ ] **Step 6: Add interaction test**

`insert-group.test.tsx`:

```tsx
it('clicking the Image button calls onImagePick', async () => {
  const onImagePick = vi.fn();
  render(<InsertGroup editor={mockEditor()} onImagePick={onImagePick} />);
  await userEvent.click(screen.getByRole('button', { name: /Insert image/ }));
  expect(onImagePick).toHaveBeenCalledOnce();
});
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @wafflebase/frontend test toolbar/insert-group insert-image
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/insert-group.tsx packages/frontend/src/app/slides/toolbar/insert-group.test.tsx packages/frontend/src/app/slides/insert-image.ts packages/frontend/src/app/slides/insert-image.test.ts
git commit -m "$(cat <<'EOF'
Add Insert group with new Image button + shared insert-image helper

Centralises the upload→insert path so the toolbar button, drag-drop,
and clipboard paste can all funnel through one helper, preventing
divergence flagged in the spec.
EOF
)"
```

---

## Task 6: Idle section with Background button

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/idle-section.tsx`
- Modify: `packages/frontend/src/app/slides/toolbar/index.tsx`

Idle state: Insert group + Background button. Background opens the themed color picker; on change, `store.batch(() => store.updateSlideBackground(slideId, { fill }))`.

- [ ] **Step 1: Implement `idle-section.tsx`**

```tsx
export function IdleSection({ editor, store, theme, onImagePick }: IdleSectionProps) {
  const slideId = editor?.getCurrentSlideId();
  const onBackgroundChange = useCallback(
    (color: ThemeColor) => {
      if (!store || !slideId) return;
      const fill = resolveThemeColor(color, theme);  // existing helper
      store.batch(() => store.updateSlideBackground(slideId, { fill }));
    },
    [store, slideId, theme],
  );
  return (
    <>
      <InsertGroup editor={editor} onImagePick={onImagePick} disabled={!editor} />
      <ToolbarSeparator className="mx-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button aria-label="Slide background"><IconColorSwatch size={16} /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {theme && <ThemedColorPicker value={undefined} theme={theme} onChange={onBackgroundChange} />}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
```

- [ ] **Step 2: Wire into the shell**

In `toolbar/index.tsx`, replace the idle placeholder:

```tsx
{state.kind === 'idle' && (
  <IdleSection editor={editor} store={store} theme={theme} onImagePick={onImagePick} />
)}
```

The `onImagePick` prop bubbles up from the `<SlidesToolbar>` consumer (set in Task 12).

- [ ] **Step 3: Add a test for background change**

```ts
it('background change calls store.updateSlideBackground in a batch', async () => {
  const store = new MemSlidesStore();
  const slideId = store.addSlide('blank');
  // ... render IdleSection with mock editor pointing at slideId, click background, pick color
  expect(store.read().slides[0].background.fill).toBe('#ffeeaa');
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @wafflebase/frontend test toolbar/idle
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/idle-section.tsx packages/frontend/src/app/slides/toolbar/idle-section.test.tsx packages/frontend/src/app/slides/toolbar/index.tsx
git commit -m "Add Idle section with Slide background button"
```

---

## Task 7: Arrange dropdown — Order / Align / Distribute / Rotate

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/arrange-menu.tsx`
- Test: `packages/frontend/src/app/slides/toolbar/arrange-menu.test.tsx`
- Modify: `packages/slides/src/view/editor/editor.ts` (add `rotateBy(rad)` and `bringForward()`/`sendBackward()`/`bringToFront()`/`sendToBack()` if missing)

One dropdown with sub-menus for Order, Align, Distribute, Rotate. Replaces the eight always-on align/distribute buttons.

- [ ] **Step 1: Verify which Arrange-target methods exist on SlidesEditor**

```bash
grep -n "bringForward\|sendBackward\|bringToFront\|sendToBack\|rotateBy" packages/slides/src/view/editor/editor.ts
```

- [ ] **Step 2: For any missing methods, add them on SlidesEditor**

Each is a thin wrapper around `store.reorderElement` (for z-order) or `store.updateElementFrame` (for rotate). All wrap in `store.batch`. Add unit tests next to existing align/distribute tests in `editor.test.ts` covering: bringForward moves the element one slot toward the end; sendToBack moves to index 0; rotateBy(π/2) increments by 90°; rotateBy is no-op on empty selection.

- [ ] **Step 3: Implement `arrange-menu.tsx`**

```tsx
export function ArrangeMenu({ editor, selectionSize }: ArrangeMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Arrange">Arrange <IconChevronDown size={12} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Order</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => editor?.bringToFront()}>Bring to front <Shortcut>⌘⇧↑</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor?.bringForward()}>Bring forward <Shortcut>⌘↑</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor?.sendBackward()}>Send backward <Shortcut>⌘↓</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor?.sendToBack()}>Send to back <Shortcut>⌘⇧↓</Shortcut></DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Align</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {/* 6 align directions */}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Distribute</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem disabled={selectionSize < 3} onClick={() => editor?.distribute('horizontal')}>Horizontally</DropdownMenuItem>
            <DropdownMenuItem disabled={selectionSize < 3} onClick={() => editor?.distribute('vertical')}>Vertically</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => editor?.rotateBy(Math.PI / 2)}>Rotate 90° clockwise</DropdownMenuItem>
        <DropdownMenuItem onClick={() => editor?.rotateBy(-Math.PI / 2)}>Rotate 90° counter-clockwise</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Test enable/disable predicates**

```tsx
it('distribute items are disabled when selectionSize < 3', () => {
  render(<ArrangeMenu editor={mockEditor()} selectionSize={2} />);
  // open dropdown → expand Distribute → assert items have aria-disabled
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @wafflebase/frontend test toolbar/arrange
pnpm --filter @wafflebase/slides test editor
```

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/arrange-menu.tsx packages/frontend/src/app/slides/toolbar/arrange-menu.test.tsx packages/slides/src/view/editor/editor.ts packages/slides/src/view/editor/editor.test.ts
git commit -m "$(cat <<'EOF'
Add Arrange dropdown collapsing align/distribute/order/rotate

Replaces the eight always-on align/distribute buttons. Adds
rotateBy and z-order convenience methods to SlidesEditor where
missing.
EOF
)"
```

---

## Task 8: Object section router + Shape controls

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/object-section.tsx`
- Create: `packages/frontend/src/app/slides/toolbar/shape-controls.tsx`
- Create: `packages/frontend/src/app/slides/toolbar/border-picker.tsx` (Border color + weight + dash trio)
- Modify: `packages/frontend/src/app/slides/toolbar/index.tsx`

Object section is a router on `selectionType`. Ships shape controls in this task (Fill + Border ▾ + Weight ▾ + Dash ▾) plus the Arrange menu at the end.

- [ ] **Step 1: Write the router test**

```tsx
it('renders shape controls for shape selection', () => {
  render(<ObjectSection state={{ kind: 'object', selectionType: 'shape', ids: ['e1'] }} {...} />);
  expect(screen.getByLabelText('Border weight')).toBeInTheDocument();
});
it('renders mixed-controls for mixed selection', () => {
  render(<ObjectSection state={{ kind: 'object', selectionType: 'mixed', ids: ['e1', 'e2'] }} {...} />);
  expect(screen.queryByLabelText('Border weight')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Arrange')).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement `object-section.tsx`**

```tsx
export function ObjectSection({ state, editor, store, theme, onImagePick }: Props) {
  if (state.kind !== 'object') return null;
  return (
    <>
      <InsertGroup editor={editor} onImagePick={onImagePick} disabled={false} />
      <ToolbarSeparator className="mx-1" />
      {state.selectionType === 'shape' && <ShapeControls editor={editor} store={store} theme={theme} ids={state.ids} />}
      {state.selectionType === 'image' && <ImageControls editor={editor} store={store} ids={state.ids} />}
      {state.selectionType === 'text-element' && <TextElementControls editor={editor} store={store} theme={theme} ids={state.ids} />}
      {/* mixed: nothing */}
      <ToolbarSeparator className="mx-1" />
      <ArrangeMenu editor={editor} selectionSize={state.ids.length} />
    </>
  );
}
```

- [ ] **Step 3: Implement `shape-controls.tsx`** with Fill (existing pattern from old toolbar) + `<BorderPicker>`. Border weight options `[0, 1, 2, 4, 8, 16]`; dash options `solid/dashed/dotted`. All writes go through `store.batch(() => store.updateElementData(slideId, elementId, { stroke: { color, width, dash } }))`.

- [ ] **Step 4: Wire into `toolbar/index.tsx`**

Replace the object placeholder:

```tsx
{state.kind === 'object' && (
  <ObjectSection state={state} editor={editor} store={store} theme={theme} onImagePick={onImagePick} />
)}
```

- [ ] **Step 5: Test border updates**

```ts
it('changing border weight writes stroke.width', async () => {
  // render shape-controls with a shape selected
  // open weight dropdown, click "4"
  // expect store.read().slides[0].elements[0].data.stroke.width === 4
});
```

- [ ] **Step 6: Run tests + verify gate**

```bash
pnpm --filter @wafflebase/frontend test toolbar
pnpm verify:fast
```

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/object-section.tsx packages/frontend/src/app/slides/toolbar/shape-controls.tsx packages/frontend/src/app/slides/toolbar/border-picker.tsx packages/frontend/src/app/slides/toolbar/object-section.test.tsx packages/frontend/src/app/slides/toolbar/index.tsx
git commit -m "Add object-section router with shape Fill + Border controls"
```

---

## Task 9: Image controls — Replace / Crop / Reset crop / Alt

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/image-controls.tsx`
- Test: `packages/frontend/src/app/slides/toolbar/image-controls.test.tsx`

**Scope decision (made upfront): ship Replace + Reset crop + Alt only. Crop button is a disabled placeholder with a TODO comment + entry in the lessons file.** Full crop UI (overlay handle behavior, editor `enterCropMode/exitCropMode`) is deferred to its own spec — too much editor surface to fold into this PR.

- [ ] **Step 1: Confirm there is no existing crop API**

```bash
grep -rn "enterCropMode\|exitCropMode\|cropMode" packages/slides/src/view/editor/ | head
```

Expected: no matches. (If matches exist, escalate — the plan's assumption was wrong.)

- [ ] **Step 2: Implement `image-controls.tsx`**

```tsx
export function ImageControls({ editor, store, ids }: Props) {
  const elementId = ids[0];
  const slideId = editor?.getCurrentSlideId();
  const image = useElement(store, slideId, elementId) as ImageElement | undefined;
  const onReplace = useCallback(async () => {
    const file = await pickImageFile();
    if (!file || !slideId) return;
    await replaceImage({ store, slideId, elementId, file, upload: defaultUpload });
  }, [store, slideId, elementId]);
  const onResetCrop = useCallback(() => {
    if (!store || !slideId) return;
    store.batch(() => store.updateElementData(slideId, elementId, { crop: undefined }));
  }, [store, slideId, elementId]);

  return (
    <>
      <button onClick={onReplace} aria-label="Replace image"><IconRefresh size={16} /></button>
      {/* TODO(slides-toolbar v1.1): wire to editor.enterCropMode when crop UI ships in its own spec. */}
      <button disabled aria-label="Crop image (coming soon)" title="Coming soon"><IconCrop size={16} /></button>
      <button onClick={onResetCrop} disabled={!image?.data.crop} aria-label="Reset crop"><IconRotate size={16} /></button>
      <Popover>
        <PopoverTrigger asChild><button aria-label="Alt text"><IconAccessible size={16} /></button></PopoverTrigger>
        <PopoverContent>
          <textarea defaultValue={image?.data.alt ?? ''} onBlur={(e) => /* save alt */ } />
        </PopoverContent>
      </Popover>
    </>
  );
}
```

`replaceImage` is `insert-image.ts`'s sibling — same upload step, but writes via `updateElementData` instead of `addElement`.

- [ ] **Step 3: Test Replace, Reset crop, Alt**

Crop button is asserted as disabled (placeholder). Add a follow-up entry in the lessons file under "Follow-ups deferred to v1.1+".

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @wafflebase/frontend test toolbar/image-controls
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/image-controls.tsx packages/frontend/src/app/slides/toolbar/image-controls.test.tsx packages/frontend/src/app/slides/replace-image.ts
git commit -m "Add Image controls: Replace / Crop / Reset crop / Alt text"
```

---

## Task 10: Text-element controls (box level)

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/text-element-controls.tsx`
- Test: `packages/frontend/src/app/slides/toolbar/text-element-controls.test.tsx`

Box-level controls when a text element is selected (not editing inside): Background fill, Border ▾, Font ▾, Size ▾. Font/Size apply to **all inlines** in the box at once via `store.withTextElement`.

- [ ] **Step 1: Implement the component**

```tsx
export function TextElementControls({ editor, store, theme, ids }: Props) {
  const elementId = ids[0];
  const slideId = editor?.getCurrentSlideId();
  const element = useElement(store, slideId, elementId) as TextElement | undefined;
  const onBackgroundFill = (color: ThemeColor) => {
    if (!store || !slideId) return;
    store.batch(() => store.updateElementData(slideId, elementId, { fill: resolveThemeColor(color, theme) }));
  };
  const onFontFamily = (family: string) => {
    if (!store || !slideId) return;
    store.batch(() => {
      store.withTextElement(slideId, elementId, (blocks) =>
        blocks.map((b) => ({ ...b, inlines: b.inlines.map((r) => ({ ...r, style: { ...r.style, fontFamily: family } })) })),
      );
    });
  };
  const onSize = (size: number) => {
    /* same shape as onFontFamily but writes fontSize */
  };
  return (
    <>
      <BackgroundFillPicker value={element?.data.fill} theme={theme} onChange={onBackgroundFill} />
      <BorderPicker value={element?.data.stroke} onChange={(stroke) => store?.batch(() => store.updateElementData(slideId!, elementId, { stroke }))} />
      <FontFamilyDropdown theme={theme} onChange={onFontFamily} />
      <FontSizeDropdown onChange={onSize} />
    </>
  );
}
```

`BorderPicker` was created in Task 8 — reuse it.

- [ ] **Step 2: Tests**

Verify Font family change writes `fontFamily` to all inlines in all blocks of the selected text element.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @wafflebase/frontend test toolbar/text-element
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/text-element-controls.tsx packages/frontend/src/app/slides/toolbar/text-element-controls.test.tsx
git commit -m "Add box-level controls for text element selection"
```

---

## Task 11: Text-edit section + Done button

**Files:**
- Create: `packages/frontend/src/app/slides/toolbar/text-edit-section.tsx`
- Test: `packages/frontend/src/app/slides/toolbar/text-edit-section.test.tsx`
- Modify: `packages/frontend/src/app/slides/toolbar/index.tsx`

Compose the shared text-formatting groups and add a Done button that exits text editing.

- [ ] **Step 1: Implement `text-edit-section.tsx`**

```tsx
export function TextEditSection({ state, editor }: { state: Extract<ToolbarState, { kind: 'text-edit' }>; editor: SlidesEditor | null }) {
  return (
    <>
      <TextStyleGroup editor={state.textEditor} />
      <ToolbarSeparator className="mx-1" />
      <TextFormatGroup editor={state.textEditor} />
      <ToolbarSeparator className="mx-1" />
      <TextParagraphGroup editor={state.textEditor} />
    </>
  );
}
```

The Insert group is **not** rendered in this state — confirm that `toolbar/index.tsx`'s rendering branch for `text-edit` doesn't include `<InsertGroup>`.

- [ ] **Step 2: Add Done button to `RightGlobals`**

In `global-controls.tsx`'s `RightGlobals`, render a Done button when `editor?.isTextEditing()` is true (or pass an `isTextEditing` flag down). The button calls the existing Esc-equivalent — `editor.exitTextEditing?.()` or whatever the codebase calls it (grep).

- [ ] **Step 3: Wire into the shell**

```tsx
{state.kind === 'text-edit' && (
  <TextEditSection state={state} editor={editor} />
)}
```

- [ ] **Step 4: State-transition test**

```ts
it('entering text edit swaps the contextual section', async () => {
  // mount SlidesToolbar with editor + store backed by a slide containing one text element
  // assert IdleSection is present
  // call editor.enterTextEditing(elementId)
  // assert TextStyleGroup is present, IdleSection gone
  // call editor.exitTextEditing()
  // assert IdleSection back
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @wafflebase/frontend test toolbar
```

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/slides/toolbar/text-edit-section.tsx packages/frontend/src/app/slides/toolbar/text-edit-section.test.tsx packages/frontend/src/app/slides/toolbar/global-controls.tsx packages/frontend/src/app/slides/toolbar/index.tsx
git commit -m "Add text-edit section composing shared formatting groups + Done button"
```

---

## Task 12: Wire new toolbar into slides-detail; remove old toolbar

**Files:**
- Modify: `packages/frontend/src/app/slides/slides-detail.tsx`
- Delete: `packages/frontend/src/app/slides/slides-formatting-toolbar.tsx`

Swap the import. Old file is deleted in the same commit so no dead code lingers.

- [ ] **Step 1: Find the import + render of the old toolbar**

```bash
grep -n "SlidesFormattingToolbar\|slides-formatting-toolbar" packages/frontend/src/app/slides/slides-detail.tsx
```

- [ ] **Step 2: Replace the import**

```tsx
import { SlidesToolbar } from "./toolbar";
```

Update the JSX to pass through the same props plus `onImagePick` (a function that opens the file picker and calls `insertImageOnSlide`):

```tsx
<SlidesToolbar
  editor={editor}
  store={store}
  theme={theme}
  onToggleThemePanel={() => setThemePanelOpen((v) => !v)}
  themePanelOpen={themePanelOpen}
  onImagePick={handleImagePick}
/>
```

`handleImagePick` opens a hidden `<input type="file" accept="image/*">` (use the existing pattern from docs's `image-insert.ts` if applicable).

- [ ] **Step 3: Verify the Present button location**

If Present moved into `RightGlobals`, remove the standalone `<SlidesPresentButton>` mount from `slides-detail.tsx` (or wherever it lives). If Present was passed as a slot/prop into the toolbar, ensure it's not duplicated.

- [ ] **Step 4: Delete old toolbar file**

```bash
git rm packages/frontend/src/app/slides/slides-formatting-toolbar.tsx
```

- [ ] **Step 5: Run all frontend tests**

```bash
pnpm --filter @wafflebase/frontend test
```

Expected: PASS.

- [ ] **Step 6: Run verify:fast**

```bash
pnpm verify:fast
```

Expected: PASS.

- [ ] **Step 7: Manual smoke**

`pnpm dev`, open a slides document. Verify each state transition:
- Idle: Background button works, Image button uploads + inserts, Undo/Redo enables/disables.
- Shape selected: Fill, Border color/weight/dash work; Arrange menu opens; Rotate 90° spins selection.
- Image selected: Replace, Reset crop, Alt work.
- Text element selected (single click): Background, Border, Font, Size apply to whole box.
- Text editing (double-click into text): B/I/U/Color/Align work via shared components; Done returns to text-element selection.
- Multi-select: only Arrange visible.
- Theme panel toggle still works.
- Present button still launches presentation mode.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/app/slides/slides-detail.tsx
git commit -m "$(cat <<'EOF'
Replace old slides toolbar with morphing redesign

Mounts the new SlidesToolbar from slides/toolbar/ and removes the
old slides-formatting-toolbar.tsx. Present button is consumed
through the toolbar's RightGlobals.
EOF
)"
```

---

## Task 13: Visual harness scenarios + final verify

**Files:**
- Modify: `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`
- Create: `docs/tasks/active/20260515-slides-toolbar-redesign-lessons.md` (start blank; fill as PR review yields lessons)

Six scenarios capture each toolbar state for snapshot regression: idle, shape-selected, image-selected, text-element-selected, text-editing-active, multi-select.

- [ ] **Step 1: Locate existing slides scenarios**

```bash
grep -n "registerScenario\|scenario\|baseline" packages/frontend/src/app/harness/visual/slides-scenarios.tsx | head
```

- [ ] **Step 2: Add the six new scenarios**

Each scenario seeds a `MemSlidesStore` with the right elements and selection state, then mounts `<SlidesToolbar>` plus a minimal slide canvas at fixed dimensions for stable snapshots.

```tsx
registerScenario('slides-toolbar-idle', () => {
  const { store, editor, theme } = makeFixture({ elements: [] });
  return <SlidesToolbar editor={editor} store={store} theme={theme} ... />;
});
registerScenario('slides-toolbar-shape-selected', () => {
  const { store, editor, theme } = makeFixture({ elements: [{ type: 'shape', ... }], selectId: 'e1' });
  return <SlidesToolbar editor={editor} store={store} theme={theme} ... />;
});
// ... image-selected, text-element-selected, text-editing-active, multi-select
```

- [ ] **Step 3: Run visual harness; accept new baselines for the six new scenarios**

```bash
pnpm verify:browser:docker
```

Expected: six new baselines added; **existing slides scenarios should not diff** unless they used the old toolbar's specific layout (e.g. align buttons in the bar). For any pre-existing scenario diff, eyeball the snapshot to confirm the change is the expected redesign — if so, accept; if not, investigate.

- [ ] **Step 4: Run full verify gate**

```bash
pnpm verify:full
```

(Or `pnpm verify:self` if integration is too slow locally.) Expected: PASS.

- [ ] **Step 5: Update `docs/design/README.md`**

Append the new spec link under the Slides section per the template comment in the spec.

- [ ] **Step 6: Create lessons file (skeleton)**

```bash
touch docs/tasks/active/20260515-slides-toolbar-redesign-lessons.md
```

Initial content:

```markdown
# Slides Toolbar Redesign — Lessons

## Surprises during implementation
(Fill in as encountered.)

## Code review feedback
(Fill in after self-review and code-reviewer skill pass.)

## Follow-ups deferred to v1.1+
- Flip H/V — `frame.flipH/flipV` model fields + overlay handles.
- Lifting `stroke` to `ElementBase` once a third element type wants it.
- Crop UI polish if shipped as a placeholder in Task 9.
```

- [ ] **Step 7: Self-review with code-reviewer skill**

Per project workflow (CLAUDE.md), dispatch `superpowers:requesting-code-review` over the full branch diff before pushing. Apply blocking findings; record non-blocking ones in lessons.

- [ ] **Step 8: Open PR**

Title: `Redesign Slides toolbar with single morphing layout` (≤70 chars).

Body Summary:
- Replace always-on slides toolbar with single morphing toolbar (Idle / Object / Text-editing).
- Collapse 8 align/distribute icons into Arrange dropdown (Order / Align / Distribute / Rotate).
- Add Undo/Redo, Image insert, Slide background, Shape Border (color/weight/dash), Image Replace/Crop/Alt, box-level Font/Size for text elements.
- Extract docs text-formatting controls into shared `components/text-formatting/`; docs toolbar refactored to import them (no behavior change).
- Add `isTextEditing()` / `getActiveTextEditor()` / `onTextEditingChange()` to `SlidesEditor`.
- Add optional `ShapeElement.data.stroke.dash` and `TextElement.data.stroke` (Yorkie-safe additions).

Test plan: 6 visual harness scenarios; interaction tests for state transitions; manual smoke per Task 12 step 7.

- [ ] **Step 9: Archive task on merge**

```bash
pnpm tasks:archive && pnpm tasks:index
```

---

## Self-review notes (apply before opening PR)

- Confirm every new file is under `packages/frontend/src/app/slides/toolbar/` or `packages/frontend/src/components/text-formatting/` — no stray placement.
- Confirm `slides-formatting-toolbar.tsx` is the only deleted file.
- Confirm `pnpm verify:fast` is green at every commit (`git log --oneline | head -13` then bisect-style spot check).
- Confirm docs visual baselines unchanged after Task 3 (the extraction).
- Confirm the spec's "out of scope" items remain out of this PR (Flip, transitions, master slides, menu bar, external image URL).
