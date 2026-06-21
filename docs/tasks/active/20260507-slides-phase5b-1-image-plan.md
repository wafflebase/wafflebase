# Slides Phase 5b-1 (Image Input) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Land the three image input paths the spec calls for —
toolbar "+ Image" file picker, drag-and-drop a local file onto the
canvas, paste from clipboard. All three funnel through the existing
`/images` workspace API (the same one docs and sheets already use).
Closes todo item 5.3.

**Architecture:**
- Slides package adds a pure `insertImage(slideId, src, naturalW,
  naturalH, opts?)` data API on `SlidesEditor`. It computes the
  default frame (centred, aspect-preserved, capped at 80 % of the
  slide), calls `store.addElement`, and updates the editor's
  selection. No DOM, no fetch — keeps slides decoupled from auth +
  CORS wiring.
- Frontend (`packages/frontend/src/app/slides/`) owns the three
  input paths. A new `slides-image-input.ts` module exposes:
    - `uploadImageFileForSlides(file)` — POSTs to `/images`, probes
      natural dimensions, returns `{ src, width, height }`. Reuses
      the same backend endpoint and JWT-cookie auth path that
      `packages/frontend/src/app/docs/image-insert.ts` uses for the
      docs editor.
    - `insertImageFromFile(editor, slideId, file)` — runs the upload
      + dimension probe, then calls `editor.insertImage(...)`. Toasts
      on failure.
    - `setupSlidesImagePaths(editor, getSlideId, canvasWrap)` —
      installs drag-drop and paste listeners on `canvasWrap`,
      gating on `editor.getEditingElementId() === null` so the
      paths don't fire while a text-box is in edit mode.
- `slides-view.tsx` renders a "+ Image" toolbar button that opens a
  hidden `<input type="file">` and feeds the picked file through
  `insertImageFromFile`, plus calls `setupSlidesImagePaths` once on
  mount so drag-and-paste also work.
- The Cmd+V slides-element paste keyboard rule and the new image
  paste listener cohabit safely — when the clipboard has image
  bytes (no slides JSON), the keyboard rule's `readClipboard()`
  returns `null` and the rule is a no-op, while the frontend paste
  listener handles the image. When the clipboard has slides JSON
  (no image bytes), the frontend listener is a no-op and the
  keyboard rule pastes the elements. The two can run concurrently.

**Spec:** [`docs/design/slides/slides.md`](../../design/slides/slides.md)
"Data model > ImageElement" + "Interactions" rows for image
insertion. Plan delivers todo item 5.3. Items 5.5 / 5.6 are Phases
5b-2 / 5b-3.

**Tech Stack:** TypeScript, Vitest (slides), node:test (frontend),
existing `docxImageUploader` (re-exported from
`packages/frontend/src/app/docs/docx-actions.ts`) for the actual
HTTP call so auth + CORS stay in one place.

**Phase 5b-1 ends when:** Toolbar "+ Image" inserts a file-picked
image, dragging a local image file onto the canvas inserts it,
pasting an image from the clipboard inserts it, all three paths
toast on upload failure without leaving the slide in a partial
state, and `pnpm verify:fast` is green.

---

## Task 1: Slides image-frame helper (model)

**Files:**
- Create: `packages/slides/src/model/image-frame.ts`
- Test: `packages/slides/src/model/image-frame.test.ts`

The slide's logical frame is 1920×1080 (`SLIDE_WIDTH × SLIDE_HEIGHT`
in `model/presentation.ts`). When the frontend hands an image with
natural dimensions to the editor, the editor needs a sensible
default frame:

- Preserve aspect ratio.
- Cap each dimension at 80 % of the slide so the image doesn't
  cover the whole canvas at insert time.
- If the image is smaller than the cap, use its natural size 1:1 (no
  upscaling — visually consistent with what the user dropped in).
- Centre inside the slide.

Pure math; no canvas or store dependencies.

- [ ] **Step 1: Failing test (default frame for an oversized image)**

```ts
// packages/slides/src/model/image-frame.test.ts
import { describe, expect, it } from 'vitest';
import { computeImageFrame } from './image-frame';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './presentation';

describe('computeImageFrame', () => {
  it('caps oversized landscape images at 80% of the slide width', () => {
    const frame = computeImageFrame(3840, 1080);
    expect(frame.w).toBe(SLIDE_WIDTH * 0.8);
    expect(frame.h).toBeCloseTo((SLIDE_WIDTH * 0.8) * (1080 / 3840));
    // Centred horizontally + vertically
    expect(frame.x).toBeCloseTo((SLIDE_WIDTH - frame.w) / 2);
    expect(frame.y).toBeCloseTo((SLIDE_HEIGHT - frame.h) / 2);
    expect(frame.rotation).toBe(0);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/slides/src/model/image-frame.ts
import type { Frame } from './element';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './presentation';

const MAX_RATIO = 0.8;

/**
 * Default frame for a freshly-inserted image element. Aspect-preserved,
 * capped at 80 % of the slide in each dimension, centred. Caller passes
 * the image's natural pixel dimensions; the result is in slide-logical
 * coordinates (1920×1080 space).
 *
 * `rotation` is always 0 for inserted images — users can rotate via
 * the existing rotate handle once selected.
 */
export function computeImageFrame(
  naturalWidth: number,
  naturalHeight: number,
): Frame {
  const maxW = SLIDE_WIDTH * MAX_RATIO;
  const maxH = SLIDE_HEIGHT * MAX_RATIO;
  // Fit-inside scale (≤ 1). If the image already fits, use 1:1.
  const scale = Math.min(1, maxW / naturalWidth, maxH / naturalHeight);
  const w = naturalWidth * scale;
  const h = naturalHeight * scale;
  return {
    x: (SLIDE_WIDTH - w) / 2,
    y: (SLIDE_HEIGHT - h) / 2,
    w,
    h,
    rotation: 0,
  };
}
```

- [ ] **Step 3: More test coverage**

```ts
  it('uses natural size 1:1 for images smaller than the cap', () => {
    const frame = computeImageFrame(400, 300);
    expect(frame.w).toBe(400);
    expect(frame.h).toBe(300);
    expect(frame.x).toBe((SLIDE_WIDTH - 400) / 2);
    expect(frame.y).toBe((SLIDE_HEIGHT - 300) / 2);
  });

  it('caps tall portrait images at 80% of the slide height', () => {
    const frame = computeImageFrame(800, 4000);
    expect(frame.h).toBe(SLIDE_HEIGHT * 0.8);
    expect(frame.w).toBeCloseTo((SLIDE_HEIGHT * 0.8) * (800 / 4000));
  });

  it('handles a square image at the cap', () => {
    const frame = computeImageFrame(2000, 2000);
    // Height cap (1080 * 0.8 = 864) is the binding constraint.
    expect(frame.w).toBeCloseTo(SLIDE_HEIGHT * 0.8);
    expect(frame.h).toBeCloseTo(SLIDE_HEIGHT * 0.8);
  });
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @wafflebase/slides test src/model/image-frame.test.ts
git add packages/slides/src/model/image-frame.ts \
        packages/slides/src/model/image-frame.test.ts
git commit -m "Add slides image-frame default helper"
```

---

## Task 2: `SlidesEditor.insertImage` API

**Files:**
- Modify: `packages/slides/src/view/editor/editor.ts`
- Test: `packages/slides/src/view/editor/editor.test.ts`

Public method on the editor that wraps `computeImageFrame` +
`store.addElement`, returns the new element id, and selects it. The
frontend image input paths all funnel through this one entry.

- [ ] **Step 1: Failing test**

Append to `editor.test.ts`:

```ts
  it('insertImage adds a centred image element and selects it', () => {
    const { editor, store } = makeFixture();
    const slideId = store.read().slides[0].id;

    const id = editor.insertImage(
      slideId,
      'https://example.test/cat.png',
      400,
      300,
      { alt: 'cat' },
    );

    const slide = store.read().slides.find((s) => s.id === slideId)!;
    const inserted = slide.elements.find((e) => e.id === id)!;
    expect(inserted.type).toBe('image');
    expect((inserted as ImageElement).data.src).toBe(
      'https://example.test/cat.png',
    );
    expect((inserted as ImageElement).data.alt).toBe('cat');
    // Centred at default frame
    expect(inserted.frame.w).toBe(400);
    expect(inserted.frame.h).toBe(300);
    expect(editor.getSelection()).toEqual([id]);
  });
```

(Import `ImageElement` from `../../model/element`. Add to existing
imports rather than duplicating.)

- [ ] **Step 2: Run test, expect FAIL on `editor.insertImage` not defined**

```bash
pnpm --filter @wafflebase/slides test src/view/editor/editor.test.ts -t insertImage
```

- [ ] **Step 3: Add the method to the `SlidesEditor` interface**

In `editor.ts` near the other public methods on the `SlidesEditor`
interface (around the `setInsertMode` declaration), add:

```ts
  /**
   * Insert an image element on the given slide. The image is centred
   * with an aspect-preserved frame capped at 80 % of the slide; the
   * inserted element id is returned and added to the current selection.
   *
   * The src must be a URL the canvas's image-cache can fetch — the
   * frontend uploads files through `/images` and passes back the
   * resulting URL. Slides itself never touches `fetch` or auth.
   */
  insertImage(
    slideId: string,
    src: string,
    naturalWidth: number,
    naturalHeight: number,
    opts?: { alt?: string },
  ): string;
```

- [ ] **Step 4: Implement on the impl class**

Inside `SlidesEditorImpl`, add:

```ts
  insertImage(
    slideId: string,
    src: string,
    naturalWidth: number,
    naturalHeight: number,
    opts?: { alt?: string },
  ): string {
    const frame = computeImageFrame(naturalWidth, naturalHeight);
    let id = '';
    this.options.store.batch(() => {
      id = this.options.store.addElement(slideId, {
        type: 'image',
        frame,
        data: opts?.alt ? { src, alt: opts.alt } : { src },
      });
      this.selection.set([id]);
    });
    this.requestRender();
    return id;
  }
```

Add the import at the top:

```ts
import { computeImageFrame } from '../../model/image-frame';
```

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter @wafflebase/slides test src/view/editor/editor.test.ts
git add packages/slides/src/view/editor/editor.ts \
        packages/slides/src/view/editor/editor.test.ts
git commit -m "Expose SlidesEditor.insertImage data API"
```

---

## Task 3: Frontend image-input module

**Files:**
- Create: `packages/frontend/src/app/slides/slides-image-input.ts`
- Test: `packages/frontend/tests/app/slides/slides-image-input.test.ts`

Mirrors the docs `image-insert.ts` shape for slides:

- `uploadImageFileForSlides(file: File)` — uploads through the same
  `docxImageUploader` the docs editor uses (POST `/images`, returns
  the absolute URL), then runs an in-DOM `<img>` preflight to capture
  the natural dimensions. Returns `{ src, width, height }`. Throws
  on upload or load failure (caller toasts).
- `insertImageFromFile(editor, slideId, file)` — wraps the upload
  + insert flow with `toast.error` on failure. Returns the inserted
  element id, or `null` on failure.
- `setupSlidesImagePaths(editor, getSlideId, canvasWrap)` — installs
  `dragenter` / `dragover` / `drop` and `paste` listeners on
  `canvasWrap`. Both gates on `editor.getEditingElementId() ===
  null` so they don't fire while a text-box is in edit mode (in that
  case the docs editor's own listeners handle paste / drop). Returns
  a cleanup function.

- [ ] **Step 1: Failing test (upload + insert smoke)**

```ts
// packages/frontend/tests/app/slides/slides-image-input.test.ts
import { describe, expect, it, vi } from 'vitest';
import { insertImageFromFile } from '@/app/slides/slides-image-input';

vi.mock('@/app/docs/docx-actions', () => ({
  docxImageUploader: vi.fn(async () => 'https://images.test/abc.png'),
}));

vi.mock('@/app/docs/image-insert', () => ({
  loadImageDimensions: vi.fn(async () => ({ width: 400, height: 300 })),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

describe('insertImageFromFile', () => {
  it('uploads, probes dimensions, and calls editor.insertImage', async () => {
    const insertImage = vi.fn(() => 'el-1');
    const editor = {
      insertImage,
      getEditingElementId: () => null,
    } as unknown as Parameters<typeof insertImageFromFile>[0];
    const file = new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' });

    const id = await insertImageFromFile(editor, 'slide-1', file);

    expect(id).toBe('el-1');
    expect(insertImage).toHaveBeenCalledWith(
      'slide-1',
      'https://images.test/abc.png',
      400,
      300,
      { alt: 'cat.png' },
    );
  });
});
```

(The frontend test runner is configured via the existing
`packages/frontend/vitest.config.ts` — confirm with
`pnpm --filter @wafflebase/frontend test`.)

- [ ] **Step 2: Run, expect FAIL on missing module**

```bash
pnpm --filter @wafflebase/frontend test slides-image-input
```

- [ ] **Step 3: Implement**

```ts
// packages/frontend/src/app/slides/slides-image-input.ts
import type { SlidesEditor } from '@wafflebase/slides';
import { docxImageUploader } from '@/app/docs/docx-actions';
import { loadImageDimensions } from '@/app/docs/image-insert';
import { toast } from 'sonner';

export interface UploadedImage {
  src: string;
  width: number;
  height: number;
}

/**
 * POST a local file to /images, then probe the resulting URL for its
 * intrinsic dimensions. Reuses `docxImageUploader` so auth (JWT cookie)
 * and CORS wiring stay in one place. Throws on upload or load
 * failure — callers should toast.
 */
export async function uploadImageFileForSlides(
  file: File,
): Promise<UploadedImage> {
  const filename = file.name || 'pasted-image';
  const src = await docxImageUploader(file, filename);
  const { width, height } = await loadImageDimensions(src);
  return { src, width, height };
}

/**
 * Upload a local image, probe its size, and call
 * `editor.insertImage`. Toasts on any failure and returns null so
 * callers don't have to wrap with try/catch.
 */
export async function insertImageFromFile(
  editor: SlidesEditor,
  slideId: string,
  file: File,
): Promise<string | null> {
  try {
    const { src, width, height } = await uploadImageFileForSlides(file);
    return editor.insertImage(slideId, src, width, height, {
      alt: file.name,
    });
  } catch (err) {
    console.error('[slides] image insert failed', err);
    toast.error(
      err instanceof Error
        ? `Image upload failed: ${err.message}`
        : 'Image upload failed',
    );
    return null;
  }
}

/**
 * Install drag-and-drop + paste listeners on `canvasWrap` for image
 * input. Both paths are gated on the editor not being in text-edit
 * mode — when the user is typing inside a text-box, the docs
 * editor's own paste / drop listeners handle paste, and this
 * module's listeners must not fire.
 *
 * Returns a cleanup function that removes the installed listeners.
 */
export function setupSlidesImagePaths(
  editor: SlidesEditor,
  getSlideId: () => string | undefined,
  canvasWrap: HTMLElement,
): () => void {
  const onDragOver = (e: DragEvent) => {
    if (editor.getEditingElementId() !== null) return;
    if (!hasImageFile(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    if (editor.getEditingElementId() !== null) return;
    const file = pickImageFile(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    const slideId = getSlideId();
    if (!slideId) return;
    void insertImageFromFile(editor, slideId, file);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (editor.getEditingElementId() !== null) return;
    const file = pickImageFile(e.clipboardData);
    if (!file) return;
    e.preventDefault();
    const slideId = getSlideId();
    if (!slideId) return;
    void insertImageFromFile(editor, slideId, file);
  };

  canvasWrap.addEventListener('dragover', onDragOver);
  canvasWrap.addEventListener('drop', onDrop);
  canvasWrap.addEventListener('paste', onPaste);

  return () => {
    canvasWrap.removeEventListener('dragover', onDragOver);
    canvasWrap.removeEventListener('drop', onDrop);
    canvasWrap.removeEventListener('paste', onPaste);
  };
}

function hasImageFile(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return true;
  }
  for (const file of Array.from(dt.files)) {
    if (file.type.startsWith('image/')) return true;
  }
  return false;
}

function pickImageFile(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of Array.from(dt.files)) {
    if (file.type.startsWith('image/')) return file;
  }
  return null;
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm --filter @wafflebase/frontend test slides-image-input
git add packages/frontend/src/app/slides/slides-image-input.ts \
        packages/frontend/tests/app/slides/slides-image-input.test.ts
git commit -m "Add slides image-input module (upload, drop, paste)"
```

---

## Task 4: Wire toolbar + drag/paste in `slides-view.tsx`

**Files:**
- Modify: `packages/frontend/src/app/slides/slides-view.tsx`

The "+ Image" toolbar button opens a hidden `<input type="file"
accept="image/*">` and feeds the picked file through
`insertImageFromFile`. `setupSlidesImagePaths` is wired once on
mount with the existing `canvasWrap` div as the listener host.

- [ ] **Step 1: Add a toolbar button + file picker**

Inside the toolbar setup block (after the existing
`insertKinds` loop that creates rect/ellipse/line/arrow/text
buttons), append:

```ts
    // Hidden file input — single instance reused across button clicks.
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    canvasWrap.appendChild(fileInput);

    const imageBtn = document.createElement("button");
    imageBtn.type = "button";
    imageBtn.textContent = "+ Image";
    imageBtn.style.background = "#2a2a2a";
    imageBtn.style.color = "#ddd";
    imageBtn.style.border = "1px solid #444";
    imageBtn.style.padding = "6px 12px";
    imageBtn.style.borderRadius = "4px";
    imageBtn.style.cursor = "pointer";
    imageBtn.style.fontSize = "13px";
    imageBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";  // allow re-picking the same file
      if (!file) return;
      const slideId = editor.getCurrentSlideId();
      if (!slideId) return;
      void insertImageFromFile(editor, slideId, file);
    });
    toolbar.appendChild(imageBtn);
```

(Add the imports near the top of the file:)

```ts
import {
  insertImageFromFile,
  setupSlidesImagePaths,
} from "./slides-image-input";
```

- [ ] **Step 2: Wire drag-drop + paste**

After the editor is initialised (`const editor = initializeEditor({
... })` line), add:

```ts
    const cleanupImagePaths = setupSlidesImagePaths(
      editor,
      () => editor.getCurrentSlideId(),
      canvasWrap,
    );
```

In the `useEffect`'s cleanup return, add `cleanupImagePaths();`
before the existing teardown.

- [ ] **Step 3: Manual smoke**

Local dev (the test harness covers the unit logic; there's no
substitute for actually inserting an image):

```bash
docker compose up -d
pnpm dev
```

In a slides document:
1. Click "+ Image", pick a local PNG → image appears centred.
2. Drag a JPG from the desktop onto the canvas → image appears.
3. Copy an image from another tab, focus the slides canvas, Cmd+V →
   image appears.
4. While editing a text-box (double-click → typing), the same three
   actions should NOT insert an image (text-box owns input). Drop
   does nothing; paste pastes text into the text-box.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/slides/slides-view.tsx
git commit -m "Wire slides image input — toolbar, drag-drop, paste"
```

---

## Task 5: Verify gate + checklist tick

- [ ] **Step 1: Run the full pre-commit gate**

```bash
pnpm verify:fast
```

- [ ] **Step 2: Tick item 5.3 in the master todo**

In `docs/tasks/active/20260505-slides-package-mvp-todo.md`, change

```
- [ ] 5.3 Image input paths — upload, drag-drop, clipboard paste (workspace image API reuse)
```

to

```
- [x] 5.3 Image input paths — upload, drag-drop, clipboard paste (workspace image API reuse)
```

- [ ] **Step 3: Commit + push**

```bash
git add docs/tasks/active/20260505-slides-package-mvp-todo.md
git commit -m "Tick Slides 5.3 (image input)"
git push
```

---

## Out of scope for 5b-1

- External image URL embed (toolbar text input). Spec defers this
  to v1.1 — no work in 5b-1.
- Image cropping UI. Crop is part of the data model
  (`ImageElement.data.crop`) but the editing affordance is v2.
- Drag the image's frame to resize. Already handled by the
  existing resize interaction; image input only needs the insert
  paths.
- Sub-image-of-image embed (e.g. SVG processing). The frontend
  hands raw bytes to `/images`; the server stores the file as-is.

---

## Continuation (2026-06-21): gap analysis + what shipped

The original plan above proposed an architecture (a `SlidesEditor.insertImage`
API + a slides-package `image-frame.ts` helper) that was **not** the path
taken. By the time this was revisited, image insertion had already landed
differently:

- **Already done (toolbar file picker):** `slides-detail.tsx` →
  `handleImagePick` opens a hidden `<input type="file" accept="image/*">`
  and calls `insertImageOnSlide({ store, slideId, file, upload })`
  (`packages/frontend/src/app/slides/insert-image.ts`). Upload reuses the
  workspace `/api/v1/.../images` API via `uploadImageFile`
  (`spreadsheet/image-upload.ts`) — same endpoint as docs/sheets.
- **Was missing (this continuation closes it):**
  1. **Drag-and-drop** a local image file onto the canvas.
  2. **Clipboard paste** of an image.
  3. **80 % insert cap** — `insert-image.ts` inserted at natural size 1:1
     and centred only, so an oversized source (e.g. 3840×2160) spilled off
     every slide edge. The plan called for an aspect-preserved 80 % cap; it
     had been dropped.

### What shipped

- `insert-image.ts` — extracted a pure `computeImageFrame(naturalW,
  naturalH)` that aspect-preserves + caps at 80 % of 1920×1080 + centres,
  with a 0-dimension guard. `insertImageOnSlide` now routes through it.
- `slides-image-input.ts` (new) — `pickImageFile` / `hasImageFile` plus
  `setupSlidesImagePaths({ canvasWrap, editor, store, upload })`. **Two
  hosts, deliberately:** `drop`/`dragover` on `canvasWrap` (drop dispatches
  to the cursor's element), `paste` on `document` (matches the editor's
  document-level keyboard model — when no text box is focused the paste
  target is `document.body`, which a canvas-scoped listener never sees).
  **Paste** gates on `editor.getEditingElementId() === null` and bails
  when an unrelated input/textarea/contenteditable is focused or a modal
  dialog is open. **Drop is intentionally NOT gated on edit mode** — the
  slides text box installs no drop handler, so bailing while editing
  would hand a bare-canvas drop to the browser default (navigate to the
  file → unmount the editor); drop always `preventDefault`s and inserts.
- `slides-view.tsx` — new optional `uploadImage` prop, captured in a ref
  (the parent's `uploadFn` identity changes once the workspace id loads),
  wired via `setupSlidesImagePaths` at mount + cleaned up on unmount.
  Read-only share-link mounts pass no uploader, so the paths stay off.
- `slides-detail.tsx` (desktop) passes `uploadImage={uploadFn}`. Mobile
  (`MobileSlidesView`) keeps its own touch-oriented insert; desktop file
  drag-drop is not a mobile affordance.

### Deviations from the original plan (intentional)

- No `SlidesEditor.insertImage` API and no slides-package `image-frame.ts`.
  The insert policy (cap, centre) lives in the frontend `insert-image.ts`
  next to the upload, keeping the slides package free of insert-frame
  policy. Both approaches work; this matched the already-landed code.
- Tests cover the pure frame math and the `pickImageFile` / drop / paste /
  editing-gate / cleanup logic through a real `MemSlidesStore`, rather than
  dispatching jsdom `DragEvent` / `ClipboardEvent` (whose constructors are
  unreliable in jsdom) — events are synthesised as `Event` with a
  defined `dataTransfer` / `clipboardData`.
