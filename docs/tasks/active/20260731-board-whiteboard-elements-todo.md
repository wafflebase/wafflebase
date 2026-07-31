# Board Whiteboard Elements (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sticky notes, image paste/drop, and a minimap to the `@wafflebase/board` infinite canvas, reusing the slides scene engine unchanged.

**Architecture:** All three features land as board-local code (`packages/frontend/src/app/board/` + one additive param on two shared slides image helpers). A sticky is a preset `roundRect` `ShapeElement` built by a board-local factory; image paste reuses `uploadImageFile` + `setupSlidesImagePaths` + `insertImageOnSlide`; the minimap is a vanilla-DOM overlay reusing `renderThumbnail` + `combinedBoundingBox` + `screenToWorld`. No Yorkie schema change, no new element type, no editor fork.

**Tech Stack:** TypeScript, React (frontend chrome), Yorkie CRDT (via `YorkieBoardStore`), Canvas 2D (via reused slides renderer), Vitest.

## Global Constraints

- **target-version 0.6.3.** Design spec: `docs/design/board/board-whiteboard-elements.md`.
- **Zero slides model / engine change.** The only files touched outside `app/board/` are `app/slides/insert-image.ts` and `app/slides/slides-image-input.ts`, and only by adding an **optional** `center` param whose default preserves today's behavior. Do NOT touch `packages/slides/src/**`.
- **No new element type.** A sticky is a `ShapeElement` with `data.kind === 'roundRect'`. It round-trips as an ordinary shape.
- **Board's single slide id is `SYNTHETIC_SLIDE_ID` (`'board'`)** — import from `@wafflebase/board`. Every board store call passes it (the store ignores the arg, but pass it for parity).
- **`Frame` is `{ x, y, w, h, rotation }`** (NOT `width`/`height`). `rotation` is radians.
- **Mutations must be wrapped in `store.batch(() => …)`** — `YorkieBoardStore` throws `"Mutations must be wrapped in batch()"` otherwise. One `batch` = one undo unit.
- **Run `pnpm --filter @wafflebase/frontend test` (Vitest)** for frontend unit tests. Pre-commit gate: `pnpm verify:fast`.
- **Commit format:** subject ≤70 chars (what changed); blank line; body explains why. End commits with the two trailer lines used across this repo.

---

### Task 1: Sticky factory — `sticky.ts` (pure model + placement helper)

**Files:**
- Create: `packages/frontend/src/app/board/sticky.ts`
- Test: `packages/frontend/src/app/board/sticky.test.ts`

**Interfaces:**
- Consumes (from `@wafflebase/slides`): `type ElementInit`, `type Point`, `type SlidesStore`, `type SlidesEditor`, `makeDefaultSlidesTextBlock`. From `@wafflebase/board`: `SYNTHETIC_SLIDE_ID`, `type Viewport`, `screenToWorld`.
- Produces:
  - `STICKY_COLORS: readonly { name: string; value: string }[]` (6 entries)
  - `STICKY_SIZE: number` (world px, square)
  - `buildStickyInit(colorValue: string, center: Point): ElementInit`
  - `dropStickyAtViewportCenter(deps: DropStickyDeps): string` where
    `DropStickyDeps = { store: SlidesStore; editor: SlidesEditor; viewport: Viewport; hostWidth: number; hostHeight: number; colorValue: string }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/app/board/sticky.test.ts
import { describe, it, expect, vi } from 'vitest';
import { STICKY_COLORS, STICKY_SIZE, buildStickyInit, dropStickyAtViewportCenter } from './sticky';

describe('buildStickyInit', () => {
  it('builds a roundRect shape centered on the given world point', () => {
    const init = buildStickyInit('#FFF8B8', { x: 500, y: 300 });
    expect(init.type).toBe('shape');
    const data = init.data as Record<string, unknown>;
    expect(data.kind).toBe('roundRect');
    expect(data.fill).toEqual({ kind: 'srgb', value: '#FFF8B8' });
    // frame centered on (500,300), size STICKY_SIZE square
    expect(init.frame).toMatchObject({
      x: 500 - STICKY_SIZE / 2,
      y: 300 - STICKY_SIZE / 2,
      w: STICKY_SIZE,
      h: STICKY_SIZE,
      rotation: 0,
    });
  });

  it('gives the sticky a middle-anchored, shrink-autofit, center-aligned text body', () => {
    const init = buildStickyInit('#CDEFC4', { x: 0, y: 0 });
    const text = (init.data as { text: { verticalAnchor: string; autofit: string; blocks: { style: { alignment: string } }[] } }).text;
    expect(text.verticalAnchor).toBe('middle');
    expect(text.autofit).toBe('shrink');
    expect(text.blocks[0].style.alignment).toBe('center');
  });

  it('carries a drop shadow', () => {
    const init = buildStickyInit('#C7E5FF', { x: 0, y: 0 });
    const effects = (init.data as { effects: { shadow?: unknown } }).effects;
    expect(effects.shadow).toBeDefined();
  });
});

describe('STICKY_COLORS', () => {
  it('has 6 distinct hex colors', () => {
    expect(STICKY_COLORS).toHaveLength(6);
    const values = STICKY_COLORS.map((c) => c.value);
    expect(new Set(values).size).toBe(6);
    for (const v of values) expect(v).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('dropStickyAtViewportCenter', () => {
  it('adds a sticky centered on the viewport, then selects + edits it', () => {
    const addElement = vi.fn().mockReturnValue('sticky-1');
    const batch = vi.fn((fn: () => void) => fn());
    const store = { addElement, batch } as unknown as import('@wafflebase/slides').SlidesStore;
    const setSelection = vi.fn();
    const enterTextEditing = vi.fn();
    const editor = { setSelection, enterTextEditing } as unknown as import('@wafflebase/slides').SlidesEditor;

    // viewport zoom=1, pan=0 → screen center (400,300) maps to world (400,300)
    const id = dropStickyAtViewportCenter({
      store, editor,
      viewport: { panX: 0, panY: 0, zoom: 1 },
      hostWidth: 800, hostHeight: 600,
      colorValue: '#FFF8B8',
    });

    expect(id).toBe('sticky-1');
    expect(batch).toHaveBeenCalledTimes(1);
    const [slideId, init] = addElement.mock.calls[0];
    expect(slideId).toBe('board');
    expect(init.frame.x).toBe(400 - STICKY_SIZE / 2);
    expect(init.frame.y).toBe(300 - STICKY_SIZE / 2);
    expect(setSelection).toHaveBeenCalledWith(['sticky-1']);
    expect(enterTextEditing).toHaveBeenCalledWith('sticky-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- sticky.test`
Expected: FAIL — module `./sticky` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/frontend/src/app/board/sticky.ts
import {
  type ElementInit,
  type Point,
  type SlidesStore,
  type SlidesEditor,
  makeDefaultSlidesTextBlock,
} from '@wafflebase/slides';
import {
  SYNTHETIC_SLIDE_ID,
  type Viewport,
  screenToWorld,
} from '@wafflebase/board';

/**
 * Six pastel sticky fills. Kept light so the default dark slides text
 * color stays legible on top — a sticky is a preset `roundRect` shape,
 * not a distinct element type, so it inherits the shape text renderer.
 */
export const STICKY_COLORS: readonly { name: string; value: string }[] = [
  { name: 'Yellow', value: '#FFF8B8' },
  { name: 'Green', value: '#CDEFC4' },
  { name: 'Blue', value: '#C7E5FF' },
  { name: 'Pink', value: '#FFD6E7' },
  { name: 'Orange', value: '#FFE0B2' },
  { name: 'Purple', value: '#E5D4FF' },
];

/** Square sticky side length, in board world px. */
export const STICKY_SIZE = 180;

/**
 * Build the `ElementInit` for a sticky note: a `roundRect` shape with a
 * solid srgb fill, a soft drop shadow, and a middle-anchored,
 * shrink-autofit, center-aligned text body, centered on `center`.
 *
 * The text body is seeded (rather than left absent for lazy creation)
 * so the sticky's middle/shrink/center layout applies to the first
 * keystroke — `withShapeText` preserves an existing `data.text` and only
 * synthesizes a bare one (top-anchored, grow) when none exists.
 */
export function buildStickyInit(colorValue: string, center: Point): ElementInit {
  const block = makeDefaultSlidesTextBlock();
  block.style = { ...block.style, alignment: 'center' };
  return {
    type: 'shape',
    frame: {
      x: center.x - STICKY_SIZE / 2,
      y: center.y - STICKY_SIZE / 2,
      w: STICKY_SIZE,
      h: STICKY_SIZE,
      rotation: 0,
    },
    data: {
      kind: 'roundRect',
      fill: { kind: 'srgb', value: colorValue },
      effects: {
        shadow: {
          color: '#000000',
          opacity: 0.18,
          angle: Math.PI / 2, // straight down
          distance: 3,
          blur: 8,
        },
      },
      text: {
        blocks: [block],
        verticalAnchor: 'middle',
        autofit: 'shrink',
      },
    },
  } as ElementInit;
}

export interface DropStickyDeps {
  store: SlidesStore;
  editor: SlidesEditor;
  viewport: Viewport;
  hostWidth: number;
  hostHeight: number;
  colorValue: string;
}

/**
 * Drop a sticky at the current viewport center, select it, and enter
 * text-edit so the user can type immediately. One `batch` = one undo
 * unit. Returns the new element id.
 */
export function dropStickyAtViewportCenter(deps: DropStickyDeps): string {
  const { store, editor, viewport, hostWidth, hostHeight, colorValue } = deps;
  const center = screenToWorld(viewport, {
    x: hostWidth / 2,
    y: hostHeight / 2,
  });
  let id = '';
  store.batch(() => {
    id = store.addElement(SYNTHETIC_SLIDE_ID, buildStickyInit(colorValue, center));
  });
  editor.setSelection([id]);
  editor.enterTextEditing(id);
  return id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- sticky.test`
Expected: PASS (all 5 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/board/sticky.ts packages/frontend/src/app/board/sticky.test.ts
git commit -m "Add board sticky-note factory (preset roundRect shape)"
```

---

### Task 2: Sticky toolbar control + board-view wiring

**Files:**
- Modify: `packages/frontend/src/app/board/board-toolbar.tsx` (add a Sticky split-button with a 6-color menu)
- Modify: `packages/frontend/src/app/board/board-view.tsx` (ref-backed `onInsertSticky` callback wired to `dropStickyAtViewportCenter`)

**Interfaces:**
- Consumes: `dropStickyAtViewportCenter`, `STICKY_COLORS` (Task 1).
- Produces: `BoardToolbarProps` gains `onInsertSticky?: (colorValue: string) => void`.

**Design note (why a ref):** `store`/`editor`/`vp`/`hostW`/`hostH` all live inside board-view's single mount `useEffect` (imperative canvas mount). Expose the sticky action through a `stickyInserterRef` assigned inside that effect, and pass the toolbar a stable `(color) => stickyInserterRef.current?.(color)` — mirroring how `editor` is already lifted to state for the toolbar.

- [ ] **Step 1: Add the ref + callback in board-view.tsx**

In `board-view.tsx`, near the other refs (after `const vp = useRef<Viewport>(DEFAULT_VIEWPORT);`):

```tsx
// Assigned inside the mount effect once store/editor exist; lets the
// toolbar trigger a sticky drop that reads the live viewport + host size.
const stickyInserterRef = useRef<((colorValue: string) => void) | null>(null);
```

Add the import at the top:

```tsx
import { dropStickyAtViewportCenter } from "./sticky";
```

Inside the mount `useEffect`, after `setEditor(editor);` (around line 199), assign the inserter:

```tsx
    stickyInserterRef.current = (colorValue: string) => {
      dropStickyAtViewportCenter({
        store,
        editor,
        viewport: vp.current,
        hostWidth: hostW,
        hostHeight: hostH,
        colorValue,
      });
    };
```

In the effect cleanup (the returned function, near `editorRef.current = null;`), add:

```tsx
      stickyInserterRef.current = null;
```

Update the toolbar render (line ~429) to pass the callback:

```tsx
      {!readOnly && (
        <BoardToolbar
          editor={editor}
          onInsertSticky={(color) => stickyInserterRef.current?.(color)}
        />
      )}
```

- [ ] **Step 2: Add the Sticky split-button to board-toolbar.tsx**

Add to `BoardToolbarProps`:

```tsx
export interface BoardToolbarProps {
  editor: SlidesEditor | null;
  disabled?: boolean;
  /** Drop a sticky of the given fill color at the viewport center. */
  onInsertSticky?: (colorValue: string) => void;
}
```

Add imports:

```tsx
import { IconNote } from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { STICKY_COLORS } from "./sticky";
```

Insert a Sticky control after the Text box `<Tooltip>` block and before `<ShapePicker>`:

```tsx
      {/* Sticky note ▾ — main click drops the first (yellow) color;
          chevron opens the 6-color palette. Placement + text-edit entry
          is board-local (dropStickyAtViewportCenter), not an editor
          InsertKind, so the slides editor is untouched. */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2"
              aria-label="Sticky note"
              disabled={disabled || !editor}
              onClick={() => onInsertSticky?.(STICKY_COLORS[0].value)}
            >
              <IconNote size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sticky note</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-5 px-0"
              aria-label="Sticky note color"
              disabled={disabled || !editor}
            >
              <span aria-hidden>▾</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="flex gap-1 p-1">
            {STICKY_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-label={c.name}
                title={c.name}
                className="h-6 w-6 rounded border border-black/10"
                style={{ backgroundColor: c.value }}
                onClick={() => onInsertSticky?.(c.value)}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
```

> Before writing, confirm `@/components/ui/dropdown-menu` and `@/components/ui/button` exist and export those names (grep: `rg "export" packages/frontend/src/components/ui/dropdown-menu.tsx`). They are used throughout the app (e.g. slides pickers), so they should. If `IconNote` is not in `@tabler/icons-react`, use `IconSticker` or `IconNotes` (grep node_modules or the slides toolbar for an available note/sticker icon).

- [ ] **Step 3: Verify the toolbar still type-checks and renders**

Run: `pnpm --filter @wafflebase/frontend build` (tsc) — expect no type errors from the toolbar/board-view edits.
Run: `pnpm --filter @wafflebase/frontend test -- board` — existing board tests still green.

- [ ] **Step 4: Manual smoke (deferred to final verify)**

Note in the task: `pnpm dev`, open a board, click Sticky → a yellow sticky appears centered and enters text edit; the chevron palette drops other colors. (Captured in the final verify step, not this task's gate.)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/board/board-toolbar.tsx packages/frontend/src/app/board/board-view.tsx
git commit -m "Wire board sticky-note toolbar control + viewport-center drop"
```

---

### Task 3: Additive `center` param on the shared image insert helpers

**Files:**
- Modify: `packages/frontend/src/app/slides/insert-image.ts` (`InsertImageArgs.center?`, apply override)
- Modify: `packages/frontend/src/app/slides/slides-image-input.ts` (`SlidesImagePathDeps.center?`, forward)
- Test: `packages/frontend/src/app/slides/insert-image.test.ts` (add a center-override case; create the file if absent)

**Interfaces:**
- Produces: `InsertImageArgs` gains `center?: { x: number; y: number }`; `SlidesImagePathDeps` gains `center?: () => { x: number; y: number } | undefined`.
- Back-compat: both optional; when absent, behavior is byte-identical to today (slide-center framing).

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/app/slides/insert-image.test.ts  (add to existing describe, or create)
import { describe, it, expect, vi } from 'vitest';
import { insertImageOnSlide, computeImageFrame } from './insert-image';

function fakeStore(meta: object = {}) {
  const added: { slideId: string; init: any }[] = [];
  return {
    read: () => ({ meta }),
    batch: (fn: () => void) => fn(),
    addElement: (slideId: string, init: any) => {
      added.push({ slideId, init });
      return 'img-1';
    },
    added,
  } as any;
}

describe('insertImageOnSlide center override', () => {
  it('centers the image frame on `center` when provided (keeps computed size)', async () => {
    const store = fakeStore();
    const upload = vi.fn().mockResolvedValue({ url: 'u', w: 100, h: 100 });
    await insertImageOnSlide({ store, slideId: 'board', file: {} as File, upload, center: { x: 1000, y: 2000 } });
    const { init } = store.added[0];
    expect(init.frame.w).toBe(100);
    expect(init.frame.h).toBe(100);
    expect(init.frame.x).toBe(1000 - 100 / 2);
    expect(init.frame.y).toBe(2000 - 100 / 2);
  });

  it('falls back to slide-center framing when center is omitted', async () => {
    const store = fakeStore();
    const upload = vi.fn().mockResolvedValue({ url: 'u', w: 100, h: 100 });
    await insertImageOnSlide({ store, slideId: 's1', file: {} as File, upload });
    const { init } = store.added[0];
    const expected = computeImageFrame(100, 100);
    expect(init.frame.x).toBe(expected.x);
    expect(init.frame.y).toBe(expected.y);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- insert-image.test`
Expected: FAIL — `center` is ignored (first test's x/y assertions fail).

- [ ] **Step 3: Implement the additive param**

In `insert-image.ts`, extend the interface:

```ts
export interface InsertImageArgs {
  store: SlidesStore;
  slideId: string;
  file: File;
  upload: (file: File) => Promise<{ url: string; w: number; h: number }>;
  /**
   * Optional world-space center for the inserted image. When set, the
   * aspect-capped frame is re-centered on this point (board mode: land
   * the image on-screen at the current viewport center) instead of the
   * slide's geometric center. Absent ⇒ today's slide-center framing.
   */
  center?: { x: number; y: number };
}
```

In `insertImageOnSlide`, re-center when `center` is set:

```ts
export async function insertImageOnSlide(args: InsertImageArgs): Promise<string> {
  const { url, w, h } = await args.upload(args.file);
  const slideHeight = deckSlideHeight(args.store.read().meta);
  const frame = computeImageFrame(w, h, slideHeight);
  if (args.center) {
    frame.x = args.center.x - frame.w / 2;
    frame.y = args.center.y - frame.h / 2;
  }
  let elementId = '';
  args.store.batch(() => {
    elementId = args.store.addElement(args.slideId, {
      type: 'image',
      frame,
      data: { src: url },
    });
  });
  return elementId;
}
```

In `slides-image-input.ts`, thread a center provider:

```ts
export interface SlidesImagePathDeps {
  canvasWrap: HTMLElement;
  editor: Pick<SlidesEditor, 'getEditingElementId' | 'getCurrentSlideId'>;
  store: SlidesStore;
  upload: (file: File) => Promise<{ url: string; w: number; h: number }>;
  /**
   * Optional per-insert world center (board mode: current viewport
   * center). Evaluated at drop/paste time so it tracks live pan/zoom.
   * Absent ⇒ slide-center framing (slides behavior unchanged).
   */
  center?: () => { x: number; y: number } | undefined;
}
```

And forward it in the internal `insert`:

```ts
  const { canvasWrap, editor, store, upload, center } = deps;

  const insert = (slideId: string, file: File) => {
    void insertImageOnSlide({ store, slideId, file, upload, center: center?.() }).catch((err) => {
      console.error('Failed to insert image', err);
      toast.error('Failed to insert image');
    });
  };
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @wafflebase/frontend test -- insert-image.test`
Expected: PASS. Also run any existing `slides-image-input` test to confirm no regression: `pnpm --filter @wafflebase/frontend test -- slides-image-input`.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/slides/insert-image.ts packages/frontend/src/app/slides/slides-image-input.ts packages/frontend/src/app/slides/insert-image.test.ts
git commit -m "Add optional viewport-center override to image insert helpers"
```

---

### Task 4: Board image wiring — upload fn, paste/drop, toolbar Image button

**Files:**
- Modify: `packages/frontend/src/app/board/board-detail.tsx` (pass `workspaceId` into `BoardView`)
- Modify: `packages/frontend/src/app/board/board-view.tsx` (add `workspaceId` prop; build `upload`; mount `setupSlidesImagePaths` with `center`; ref-backed `onInsertImage`)
- Modify: `packages/frontend/src/app/board/board-toolbar.tsx` (Image button + hidden file input)
- Create: `packages/frontend/src/app/board/board-image.ts` (the `uploadImageFile` → `{url,w,h}` adapter)
- Test: `packages/frontend/src/app/board/board-image.test.ts`

**Interfaces:**
- Produces: `makeBoardImageUpload(workspaceId: string): (file: File) => Promise<{ url: string; w: number; h: number }>`; `BoardToolbarProps` gains `onInsertImage?: (file: File) => void`; `BoardViewProps` gains `workspaceId?: string`.
- Consumes: `uploadImageFile` (`app/spreadsheet/image-upload.ts`), `setupSlidesImagePaths` + `insertImageOnSlide` (Task 3), `screenToWorld` + `SYNTHETIC_SLIDE_ID` (`@wafflebase/board`).

- [ ] **Step 1: Write the failing test for the upload adapter**

```ts
// packages/frontend/src/app/board/board-image.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/spreadsheet/image-upload', () => ({
  uploadImageFile: vi.fn().mockResolvedValue({ id: 'x', url: 'http://h/u.png', width: 320, height: 240 }),
}));

import { makeBoardImageUpload } from './board-image';
import { uploadImageFile } from '@/app/spreadsheet/image-upload';

describe('makeBoardImageUpload', () => {
  it('uploads with the workspace id and maps width/height → w/h', async () => {
    const upload = makeBoardImageUpload('ws-1');
    const out = await upload({} as File);
    expect(uploadImageFile).toHaveBeenCalledWith(expect.anything(), 'ws-1');
    expect(out).toEqual({ url: 'http://h/u.png', w: 320, h: 240 });
  });
});
```

> Confirm the import alias for `image-upload.ts` — it lives at `packages/frontend/src/app/spreadsheet/image-upload.ts`. Use whatever alias the repo uses (`@/app/spreadsheet/image-upload`); grep an existing importer to match (`rg "spreadsheet/image-upload" packages/frontend/src`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- board-image.test`
Expected: FAIL — `./board-image` not found.

- [ ] **Step 3: Implement the adapter**

```ts
// packages/frontend/src/app/board/board-image.ts
import { uploadImageFile } from '@/app/spreadsheet/image-upload';

/**
 * Board image upload adapter: binds the workspace id and reshapes
 * `uploadImageFile`'s `{ id, url, width, height }` into the
 * `{ url, w, h }` contract `insertImageOnSlide` expects.
 */
export function makeBoardImageUpload(
  workspaceId: string,
): (file: File) => Promise<{ url: string; w: number; h: number }> {
  return async (file: File) => {
    const { url, width, height } = await uploadImageFile(file, workspaceId);
    return { url, w: width, h: height };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- board-image.test`
Expected: PASS.

- [ ] **Step 5: Thread `workspaceId` from board-detail.tsx**

In `board-detail.tsx`, `BoardLayout` already has `documentData?.workspaceId`. Pass it:

```tsx
          <BoardView documentId={documentId} workspaceId={documentData?.workspaceId} />
```

- [ ] **Step 6: Wire board-view.tsx (prop, upload, paste/drop mount, image inserter ref)**

Add to `BoardViewProps`:

```tsx
  /**
   * Owning workspace id (from the document metadata). Needed to build
   * the image-upload function (`POST /api/v1/workspaces/:id/images`).
   * Undefined while the document query is loading — the Image button
   * stays disabled until it resolves.
   */
  workspaceId?: string;
```

Destructure it: `export function BoardView({ documentId, readOnly, workspaceId }: BoardViewProps) {`.

Add imports:

```tsx
import { screenToWorld } from "@wafflebase/board";
import { setupSlidesImagePaths } from "../slides/slides-image-input";
import { insertImageOnSlide } from "../slides/insert-image";
import { makeBoardImageUpload } from "./board-image";
```

Add a ref beside `stickyInserterRef`:

```tsx
const imageInserterRef = useRef<((file: File) => void) | null>(null);
```

Add `workspaceId` to the effect dependency array: `}, [didMount, doc, readOnly, workspaceId]);`

Inside the mount effect, after `setEditor(editor);`, build the upload + viewport-center provider and mount the paste/drop paths (only when editable AND a workspace is known):

```tsx
    // Image input: paste + drag-drop + toolbar button, all funneling to
    // insertImageOnSlide, centered on the current viewport. Disabled in
    // read-only mode and until the workspace id resolves (upload needs it).
    let disposeImagePaths: (() => void) | undefined;
    if (!readOnly && workspaceId) {
      const upload = makeBoardImageUpload(workspaceId);
      const center = () => screenToWorld(vp.current, { x: hostW / 2, y: hostH / 2 });
      disposeImagePaths = setupSlidesImagePaths({
        canvasWrap: container,
        editor,
        store,
        upload,
        center,
      });
      imageInserterRef.current = (file: File) => {
        void insertImageOnSlide({
          store,
          slideId: SYNTHETIC_SLIDE_ID,
          file,
          upload,
          center: center(),
        }).catch(() => { /* toast handled inside insertImageOnSlide callers */ });
      };
    }
```

In the cleanup, dispose it and clear the ref:

```tsx
      disposeImagePaths?.();
      imageInserterRef.current = null;
```

Pass `onInsertImage` to the toolbar:

```tsx
      {!readOnly && (
        <BoardToolbar
          editor={editor}
          onInsertSticky={(color) => stickyInserterRef.current?.(color)}
          onInsertImage={(file) => imageInserterRef.current?.(file)}
          disabled={!workspaceId}
        />
      )}
```

> `disabled={!workspaceId}` disables *all* insert controls briefly while the workspace loads. If that's too aggressive, gate only the Image button by passing a separate `imageDisabled` prop — but the whole-toolbar disable matches the "editor not ready" pattern already used (`disabled || !editor`) and the window is sub-second. Keep it simple.

- [ ] **Step 7: Add the Image button + hidden file input to board-toolbar.tsx**

Add to `BoardToolbarProps`: `onInsertImage?: (file: File) => void;`

Add imports:

```tsx
import { useRef } from "react";
import { IconPhoto } from "@tabler/icons-react";
```

(Merge `useRef` into the existing `react` import.) Inside `BoardToolbar`, add a hidden input ref:

```tsx
  const fileInputRef = useRef<HTMLInputElement>(null);
```

Insert the Image control after the Sticky block:

```tsx
      {/* Image — opens a file picker; upload + insert is board-view's
          onInsertImage (reuses the slides upload + insert pipeline). */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            pressed={false}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Insert image"
            disabled={disabled || !editor || !onInsertImage}
          >
            <IconPhoto size={16} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Insert image</TooltipContent>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onInsertImage?.(file);
          e.target.value = ""; // allow re-selecting the same file
        }}
      />
```

- [ ] **Step 8: Type-check + tests**

Run: `pnpm --filter @wafflebase/frontend build` — no type errors.
Run: `pnpm --filter @wafflebase/frontend test -- board` — board tests green.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/app/board/board-detail.tsx packages/frontend/src/app/board/board-view.tsx packages/frontend/src/app/board/board-toolbar.tsx packages/frontend/src/app/board/board-image.ts packages/frontend/src/app/board/board-image.test.ts
git commit -m "Wire board image paste/drop/file-picker via reused upload pipeline"
```

---

### Task 5: Minimap geometry — `minimap-geometry.ts` (pure, unit-tested)

**Files:**
- Create: `packages/frontend/src/app/board/minimap-geometry.ts`
- Test: `packages/frontend/src/app/board/minimap-geometry.test.ts`

**Interfaces:**
- Consumes (from `@wafflebase/slides`): `type Point`, `type Frame`, `combinedBoundingBox`, `screenToWorld`, `type Viewport`.
- Produces:
  - `type MiniRect = { x: number; y: number; w: number; h: number }`
  - `type MiniFit = { scale: number; offsetX: number; offsetY: number }`
  - `sceneBounds(frames: Frame[], pad?: number): MiniRect | undefined`
  - `fitScene(bounds: MiniRect, mini: { w: number; h: number }): MiniFit`
  - `worldToMini(fit: MiniFit, p: Point): Point`
  - `miniToWorld(fit: MiniFit, p: Point): Point`
  - `viewportRectInMini(vp: Viewport, host: { w: number; h: number }, fit: MiniFit): MiniRect`
  - `centerViewportOnWorld(vp: Viewport, world: Point, host: { w: number; h: number }): Viewport`

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/app/board/minimap-geometry.test.ts
import { describe, it, expect } from 'vitest';
import {
  sceneBounds, fitScene, worldToMini, miniToWorld,
  viewportRectInMini, centerViewportOnWorld,
} from './minimap-geometry';

const frame = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });

describe('sceneBounds', () => {
  it('is undefined for an empty scene', () => {
    expect(sceneBounds([])).toBeUndefined();
  });
  it('unions all frames and pads', () => {
    const b = sceneBounds([frame(0, 0, 100, 100), frame(200, 50, 100, 100)], 10)!;
    expect(b).toMatchObject({ x: -10, y: -10, w: 320, h: 170 });
  });
});

describe('fitScene', () => {
  it('letterboxes a wide scene (width-bound) and centers it', () => {
    const fit = fitScene({ x: 0, y: 0, w: 400, h: 100 }, { w: 200, h: 150 });
    expect(fit.scale).toBeCloseTo(0.5); // 200/400 < 150/100
    expect(fit.offsetX).toBeCloseTo(0);
    expect(fit.offsetY).toBeCloseTo((150 - 100 * 0.5) / 2); // vertically centered
  });
});

describe('worldToMini / miniToWorld round-trip', () => {
  it('is an inverse pair', () => {
    const fit = fitScene({ x: 0, y: 0, w: 400, h: 300 }, { w: 200, h: 150 });
    const p = { x: 123, y: 77 };
    const back = miniToWorld(fit, worldToMini(fit, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});

describe('viewportRectInMini', () => {
  it('maps the on-screen world rect into minimap px', () => {
    // identity viewport: screen (0,0)-(host) == world (0,0)-(host)
    const fit = fitScene({ x: 0, y: 0, w: 800, h: 600 }, { w: 200, h: 150 });
    const r = viewportRectInMini({ panX: 0, panY: 0, zoom: 1 }, { w: 800, h: 600 }, fit);
    expect(r).toMatchObject({ x: 0, y: 0, w: 200, h: 150 });
  });
});

describe('centerViewportOnWorld', () => {
  it('sets pan so the world point lands at host center, keeping zoom', () => {
    const vp = centerViewportOnWorld({ panX: 0, panY: 0, zoom: 2 }, { x: 100, y: 50 }, { w: 800, h: 600 });
    expect(vp.zoom).toBe(2);
    // host center 400,300 == world*zoom + pan → pan = 400 - 100*2 = 200 ; 300 - 50*2 = 200
    expect(vp.panX).toBe(200);
    expect(vp.panY).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- minimap-geometry.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the geometry**

```ts
// packages/frontend/src/app/board/minimap-geometry.ts
import {
  type Point,
  type Frame,
  type Viewport,
  combinedBoundingBox,
  screenToWorld,
} from '@wafflebase/slides';

export type MiniRect = { x: number; y: number; w: number; h: number };
export type MiniFit = { scale: number; offsetX: number; offsetY: number };

/**
 * World AABB enclosing every element frame, padded by `pad` world px on
 * each side. Undefined when there are no frames (empty board → no
 * minimap content). Uses the rotation-aware `combinedBoundingBox`.
 */
export function sceneBounds(frames: Frame[], pad = 0): MiniRect | undefined {
  const box = combinedBoundingBox(frames);
  if (!box) return undefined;
  return { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
}

/**
 * Uniform fit of a world `bounds` rect into a `mini` px box, letterboxed
 * (aspect-preserving) and centered. `scale` is world px → minimap px.
 */
export function fitScene(bounds: MiniRect, mini: { w: number; h: number }): MiniFit {
  const scale = Math.min(mini.w / bounds.w, mini.h / bounds.h);
  const drawnW = bounds.w * scale;
  const drawnH = bounds.h * scale;
  // Offset places world `bounds.{x,y}` origin, then centers the drawn
  // content within the minimap box.
  return {
    scale,
    offsetX: (mini.w - drawnW) / 2 - bounds.x * scale,
    offsetY: (mini.h - drawnH) / 2 - bounds.y * scale,
  };
}

export function worldToMini(fit: MiniFit, p: Point): Point {
  return { x: p.x * fit.scale + fit.offsetX, y: p.y * fit.scale + fit.offsetY };
}

export function miniToWorld(fit: MiniFit, p: Point): Point {
  return { x: (p.x - fit.offsetX) / fit.scale, y: (p.y - fit.offsetY) / fit.scale };
}

/**
 * The current on-screen world rectangle (what the board viewport shows),
 * mapped into minimap px. Corners come from `screenToWorld` of the two
 * host corners, so it tracks live pan/zoom.
 */
export function viewportRectInMini(
  vp: Viewport,
  host: { w: number; h: number },
  fit: MiniFit,
): MiniRect {
  const tl = worldToMini(fit, screenToWorld(vp, { x: 0, y: 0 }));
  const br = worldToMini(fit, screenToWorld(vp, { x: host.w, y: host.h }));
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

/**
 * A viewport that keeps `zoom` but pans so `world` sits at the host
 * center (used when the user drags/clicks in the minimap to navigate).
 */
export function centerViewportOnWorld(
  vp: Viewport,
  world: Point,
  host: { w: number; h: number },
): Viewport {
  return {
    zoom: vp.zoom,
    panX: host.w / 2 - world.x * vp.zoom,
    panY: host.h / 2 - world.y * vp.zoom,
  };
}
```

> If `type Frame` is not re-exported from `@wafflebase/slides`, it is (confirmed: `yorkie-board-store.ts` imports `type Frame` from it). `combinedBoundingBox`, `screenToWorld`, `type Point`, `type Viewport` are all exported from the slides barrel.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- minimap-geometry.test`
Expected: PASS (all 6 describes).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/board/minimap-geometry.ts packages/frontend/src/app/board/minimap-geometry.test.ts
git commit -m "Add board minimap geometry (fit, world↔mini, viewport rect)"
```

---

### Task 6: Minimap overlay — `board-minimap.ts` factory + board-view mount

**Files:**
- Create: `packages/frontend/src/app/board/board-minimap.ts` (vanilla-DOM factory: scene snapshot + viewport rect + drag-to-pan + toggle)
- Modify: `packages/frontend/src/app/board/board-view.tsx` (mount the minimap; drive `repaintScene` / `repaintViewport`)
- Test: `packages/frontend/src/app/board/board-minimap.test.ts` (factory smoke — element created, toggle flips, dispose removes listeners)

**Interfaces:**
- Consumes: Task 5 geometry; `renderThumbnail` + `type SlidesStore` + `type Viewport` + `SYNTHETIC_SLIDE_ID` (`@wafflebase/board`) + `type Point` (slides).
- Produces:
  - `type BoardMinimap = { element: HTMLElement; repaintScene(): void; repaintViewport(vp: Viewport): void; dispose(): void }`
  - `createBoardMinimap(deps: BoardMinimapDeps): BoardMinimap` where
    `BoardMinimapDeps = { store: SlidesStore; getHostSize: () => { w: number; h: number }; onNavigate: (worldCenter: Point) => void; dpr: number; initialVisible?: boolean }`

**Design:** Vanilla factory (not React) to match board-view's imperative canvas mount. The scene is painted to the minimap `<canvas>` via `renderThumbnail` with a fitted `viewport` (so no slide-rect background is drawn — the board plane is transparent; the minimap element supplies its own CSS backdrop). The scene paint is coalesced (rAF-dirty). The viewport rectangle is a cheap stroked rect redrawn on top after each scene paint AND on every `repaintViewport(vp)` call (board-view calls it every pan/zoom frame). To avoid re-running the O(n) `store.read()` + full scene paint every pan frame, cache the last scene snapshot to an offscreen canvas and, on `repaintViewport`, blit the snapshot + stroke the rect only.

- [ ] **Step 1: Write the failing factory smoke test**

```ts
// packages/frontend/src/app/board/board-minimap.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBoardMinimap } from './board-minimap';

function fakeStore() {
  return {
    read: () => ({
      meta: { title: 't', themeId: 'x', masterId: 'y' },
      themes: [], masters: [], layouts: [],
      slides: [{ id: 'board', layoutId: 'blank', background: {}, elements: [], notes: [] }],
      guides: [],
    }),
  } as any;
}

describe('createBoardMinimap', () => {
  beforeEach(() => {
    // jsdom canvas getContext returns null; stub a minimal 2D context.
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({
      setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      strokeRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(),
      scale: vi.fn(), translate: vi.fn(), beginPath: vi.fn(), rect: vi.fn(),
      stroke: vi.fn(), fill: vi.fn(),
    }));
  });

  it('creates a root element and toggles visibility', () => {
    const mm = createBoardMinimap({
      store: fakeStore(),
      getHostSize: () => ({ w: 800, h: 600 }),
      onNavigate: vi.fn(),
      dpr: 1,
    });
    expect(mm.element).toBeInstanceOf(HTMLElement);
    // a toggle button exists
    const toggle = mm.element.querySelector('button');
    expect(toggle).not.toBeNull();
    mm.dispose();
  });

  it('repaintScene / repaintViewport do not throw with an empty scene', () => {
    const mm = createBoardMinimap({
      store: fakeStore(),
      getHostSize: () => ({ w: 800, h: 600 }),
      onNavigate: vi.fn(),
      dpr: 1,
    });
    expect(() => {
      mm.repaintScene();
      mm.repaintViewport({ panX: 0, panY: 0, zoom: 1 });
    }).not.toThrow();
    mm.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- board-minimap.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the factory**

```ts
// packages/frontend/src/app/board/board-minimap.ts
import {
  type SlidesStore,
  type Viewport,
  type Point,
  type Slide,
  type SlidesDocument,
  renderThumbnail,
} from '@wafflebase/slides';
import {
  sceneBounds, fitScene, miniToWorld, viewportRectInMini, type MiniFit,
} from './minimap-geometry';

const MINI_W = 200;
const MINI_H = 150;
const PAD = 80; // world-px breathing room around the scene bounds

export interface BoardMinimapDeps {
  store: SlidesStore;
  getHostSize: () => { w: number; h: number };
  onNavigate: (worldCenter: Point) => void;
  dpr: number;
  initialVisible?: boolean;
}

export interface BoardMinimap {
  element: HTMLElement;
  repaintScene(): void;
  repaintViewport(vp: Viewport): void;
  dispose(): void;
}

/**
 * Bottom-right minimap overlay for the board. Vanilla DOM (mounted by
 * board-view alongside the main canvas). Scene snapshot via
 * `renderThumbnail` with a fitted viewport (no slide-rect background);
 * viewport rectangle + drag-to-pan via the pure minimap geometry.
 */
export function createBoardMinimap(deps: BoardMinimapDeps): BoardMinimap {
  const { store, getHostSize, onNavigate, dpr } = deps;
  let visible = deps.initialVisible ?? true;

  const root = document.createElement('div');
  root.style.cssText = [
    'position:absolute', 'right:12px', 'bottom:12px', 'z-index:5',
    'display:flex', 'flex-direction:column', 'align-items:flex-end', 'gap:4px',
  ].join(';');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Toggle minimap');
  toggle.style.cssText = 'font:12px system-ui;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.6);color:#fff;border:0;cursor:pointer';

  const panel = document.createElement('div');
  panel.style.cssText = [
    `width:${MINI_W}px`, `height:${MINI_H}px`,
    'border-radius:6px', 'overflow:hidden',
    'box-shadow:0 2px 8px rgba(0,0,0,.25)',
    'background:rgba(127,127,127,.12)', 'backdrop-filter:blur(2px)',
  ].join(';');

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(MINI_W * dpr);
  canvas.height = Math.round(MINI_H * dpr);
  canvas.style.width = `${MINI_W}px`;
  canvas.style.height = `${MINI_H}px`;
  canvas.style.display = 'block';
  canvas.style.cursor = 'pointer';
  panel.appendChild(canvas);

  root.appendChild(toggle);
  root.appendChild(panel);

  const ctx = canvas.getContext('2d');
  // Offscreen cache of the last scene paint so repaintViewport (called
  // every pan/zoom frame) blits instead of re-reading the whole store.
  const snapshot = document.createElement('canvas');
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  const snapCtx = snapshot.getContext('2d');

  let lastFit: MiniFit | null = null;
  let lastVp: Viewport = { panX: 0, panY: 0, zoom: 1 };

  const applyVisibility = () => {
    panel.style.display = visible ? 'block' : 'none';
    toggle.textContent = visible ? 'Map ▾' : 'Map ▸';
  };

  const paintScene = () => {
    if (!snapCtx) return;
    const doc = store.read() as SlidesDocument;
    const slide = doc.slides[0] as Slide;
    const frames = slide.elements.map((e) => e.frame);
    snapCtx.setTransform(1, 0, 0, 1, 0, 0);
    snapCtx.clearRect(0, 0, snapshot.width, snapshot.height);
    const bounds = sceneBounds(frames, PAD);
    if (!bounds) {
      lastFit = null;
      blit();
      return;
    }
    lastFit = fitScene(bounds, { w: MINI_W, h: MINI_H });
    renderThumbnail(snapCtx, slide, doc, {
      hostWidth: MINI_W,
      hostHeight: MINI_H,
      dpr,
      viewport: { zoom: lastFit.scale, panX: lastFit.offsetX, panY: lastFit.offsetY },
      cull: false,
      onAssetLoad: () => scheduleScene(),
    });
    blit();
  };

  const blit = () => {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(snapshot, 0, 0);
    // viewport rectangle (device px)
    if (lastFit) {
      const r = viewportRectInMini(lastVp, getHostSize(), lastFit);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = '#2b7fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  };

  // rAF-coalesced scene repaint.
  let sceneRaf = 0;
  const scheduleScene = () => {
    if (sceneRaf) return;
    sceneRaf = requestAnimationFrame(() => {
      sceneRaf = 0;
      paintScene();
    });
  };

  // --- drag-to-navigate ---
  let dragging = false;
  const navigateFromEvent = (e: PointerEvent) => {
    if (!lastFit) return;
    const rect = canvas.getBoundingClientRect();
    const world = miniToWorld(lastFit, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    onNavigate(world);
  };
  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    navigateFromEvent(e);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (dragging) navigateFromEvent(e);
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onToggle = () => {
    visible = !visible;
    applyVisibility();
    if (visible) scheduleScene();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  toggle.addEventListener('click', onToggle);

  applyVisibility();

  return {
    element: root,
    repaintScene: () => { if (visible) scheduleScene(); },
    repaintViewport: (vp: Viewport) => {
      lastVp = vp;
      if (visible) blit();
    },
    dispose: () => {
      if (sceneRaf) cancelAnimationFrame(sceneRaf);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      toggle.removeEventListener('click', onToggle);
      root.remove();
    },
  };
}
```

> Confirm `type Slide` and `type SlidesDocument` are exported from `@wafflebase/slides` (grep the barrel: `rg "Slide\b|SlidesDocument" packages/slides/src/index.ts`). `renderThumbnail` is exported (line 187). If `Slide`/`SlidesDocument` are only exported from `./model/presentation` under different names, adjust the import or use `ReturnType<SlidesStore['read']>` for the doc type and `['slides'][number]` for the slide type.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- board-minimap.test`
Expected: PASS (element created, toggle present, no throw on empty scene).

- [ ] **Step 5: Mount the minimap in board-view.tsx**

Add imports:

```tsx
import { createBoardMinimap, type BoardMinimap } from "./board-minimap";
import { centerViewportOnWorld } from "./minimap-geometry";
```

Inside the mount effect, after the minimap's dependencies exist (store + editor + host size known, i.e. after `setEditor(editor);`), create it and append to `container`:

```tsx
    const minimap: BoardMinimap = createBoardMinimap({
      store,
      dpr,
      getHostSize: () => ({ w: hostW, h: hostH }),
      onNavigate: (worldCenter) => {
        vp.current = centerViewportOnWorld(vp.current, worldCenter, { w: hostW, h: hostH });
        editor.setViewport(vp.current);
        minimap.repaintViewport(vp.current);
      },
    });
    container.appendChild(minimap.element);
    minimap.repaintScene();
    minimap.repaintViewport(vp.current);
```

Drive repaints from the existing hooks:

- In `store.onChange` (the `offChange` handler): after `pushPeers();` add
  ```tsx
      minimap.repaintScene();
      minimap.repaintViewport(vp.current);
  ```
- In `onWheel`, after `editor.setViewport(vp.current);` add `minimap.repaintViewport(vp.current);`
- In `onPointerMove` (pan), after `editor.setViewport(vp.current);` add `minimap.repaintViewport(vp.current);`
- In the `resizeObserver` callback, after re-reading `canvasRect`, add `minimap.repaintViewport(vp.current);` (host size changed → the viewport rect moved).

In the cleanup, dispose it (before `editor.detach()`):

```tsx
      minimap.dispose();
```

> The minimap is created inside the effect regardless of `readOnly` — a viewer should still see it (design: "present in read-only"). `onNavigate` panning is view-local, so it's safe read-only. The toggle button and drag work without any store mutation.

- [ ] **Step 6: Type-check + full board test run + manual note**

Run: `pnpm --filter @wafflebase/frontend build` — no type errors.
Run: `pnpm --filter @wafflebase/frontend test -- board` — all board tests green.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/app/board/board-minimap.ts packages/frontend/src/app/board/board-minimap.test.ts packages/frontend/src/app/board/board-view.tsx
git commit -m "Add board minimap overlay with viewport rect + drag-to-pan"
```

---

### Task 7: Final integration — verify, chunk-gate, design-doc status, manual smoke

**Files:**
- Possibly modify: `harness.config.json` (only if the frontend chunk-count gate trips — SP1 hit this)
- Modify: `docs/design/board/board.md` (flip the SP2 sub-project row to "shipped" / update status wording if the doc tracks it)

- [ ] **Step 1: Run the full fast gate**

Run: `pnpm verify:fast`
Expected: lint + unit tests green across packages. Fix any lint (e.g. unused imports) inline.

- [ ] **Step 2: Run the self gate (includes builds + chunk gate)**

Run: `pnpm verify:self`
Expected: all lanes green. **If `verify:frontend:chunks` fails** on chunk COUNT (SP1's board chunks already bumped it once; sticky/minimap add no new lazy route, so this likely stays green), bump `maxChunkCount` in `harness.config.json` with a one-line reason appended to `maxChunkCountReason` — the established repo pattern. Do NOT suppress a real regression; a size failure on an existing chunk is a code issue, investigate first.

- [ ] **Step 3: Manual smoke in `pnpm dev`**

Start `docker compose up -d` (if not running) + `pnpm dev`. Open/create a board (`/b/:id`) and verify:
  - Sticky: click the Sticky button → a yellow 180² sticky appears at screen center, selected, in text-edit; type text → it stays centered + shrinks to fit. Chevron palette drops other colors. Move/resize/rotate work (it's a shape). Reload → sticky + text persist (CRDT).
  - Image: drag a PNG onto the canvas → it uploads and lands at the viewport center. Paste an image from the clipboard → same. Toolbar Image button → file picker → inserts. Pasting *inside* a sticky's text does NOT drop a canvas image.
  - Minimap: bottom-right overview shows all elements; the blue rectangle tracks pan/zoom; dragging in the minimap recenters the board; toggle hides/shows it. Empty board → minimap panel is blank (no crash).
  - Collab (optional): open the same board in a second tab → a sticky/image added in one appears in the other.

- [ ] **Step 4: Self code-review over the branch diff**

Dispatch `/code-review` (or `superpowers:requesting-code-review`) over the full branch diff. Apply blocking findings; note non-blocking ones. Pay attention to the reachability lesson from SP1: verify no reused-editor gesture (context menu, keymap) hits a `notSupported()` throw via the new controls (stickies are plain shapes, so they shouldn't — confirm).

- [ ] **Step 5: Capture lessons + archive**

Fill in `docs/tasks/active/20260731-board-whiteboard-elements-lessons.md`, then `pnpm tasks:archive && pnpm tasks:index`. Commit the task docs together with `tasks/README.md`.

- [ ] **Step 6: Open the PR**

`git fetch && git rebase origin/main`; push; open a PR titled ≤70 chars (e.g. "Board SP2: sticky notes, image paste, minimap"), body = Summary + Test plan.

---

## Self-Review

**Spec coverage:**
- Sticky notes (preset roundRect + palette + viewport-center drop + auto text-edit) → Tasks 1–2. ✓
- Image paste + drag-drop + file-picker (reused pipeline, viewport-centered) → Tasks 3–4. ✓
- Minimap (fit + snapshot + viewport rect + drag-to-pan + toggle, view-local, read-only) → Tasks 5–6. ✓
- Zero slides model change / additive image param → enforced in Global Constraints + Task 3. ✓
- Design-doc status + chunk gate + manual smoke + review → Task 7. ✓

**Placeholder scan:** every code step has concrete code; the two "confirm export/alias" notes are verification instructions with named fallbacks, not deferred work. ✓

**Type consistency:** `dropStickyAtViewportCenter` / `buildStickyInit` (Task 1) match their Task 2 call site; `InsertImageArgs.center` (Task 3) matches Task 4's `center: center()` call; `MiniFit`/`sceneBounds`/`fitScene`/`viewportRectInMini`/`centerViewportOnWorld` (Task 5) match Task 6's imports and board-view's `onNavigate`. `Frame` is `{x,y,w,h,rotation}` throughout. ✓
