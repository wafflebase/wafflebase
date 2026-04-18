# Sheet Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add floating image support to the Sheets package, with a shared workspace-level image upload API usable by both Sheets and Docs.

**Architecture:** Follow the existing Charts pattern — images stored in `worksheet.images` on the Yorkie document, managed via direct `doc.update()` calls (not through the Store interface). Frontend renders images via a dedicated `ImageObjectLayer` React component, mirroring `ChartObjectLayer`. Backend extends the existing `ImageModule` with workspace-scoped endpoints in the API v1 layer.

**Tech Stack:** TypeScript, NestJS (Multer for upload), Prisma, Yorkie CRDT, React, Canvas API

**Spec:** `docs/design/sheets/sheet-image.md`

---

## File Structure

### Sheets Package (`packages/sheets/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/model/workbook/worksheet-document.ts` | Modify | Add `SheetImage` type, add `images` field to `Worksheet` |
| `src/index.ts` | Modify | Export `SheetImage` type |

### Backend Package (`packages/backend/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/api/v1/images.controller.ts` | Create | Workspace-scoped image endpoints (upload, get, delete) |
| `src/api/v1/api-v1.module.ts` | Modify | Register `ApiV1ImagesController` |
| `prisma/schema.prisma` | Modify | Add workspace relation to `Image` model (if needed) |

### Frontend Package (`packages/frontend/`)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/spreadsheet/image-object-layer.tsx` | Create | Image rendering, selection, drag-move, resize |
| `src/app/spreadsheet/image-cache.ts` | Create | Async image loading with dedup + callback subscription |
| `src/app/spreadsheet/image-upload.ts` | Create | Upload helper (shared by Sheets and Docs) |
| `src/app/spreadsheet/sheet-view.tsx` | Modify | Wire image CRUD handlers, render ImageObjectLayer |
| `src/app/spreadsheet/yorkie-worksheet-structure.ts` | Modify | Add `shiftImageAnchors` and `moveImageAnchors` |
| `src/components/formatting-toolbar.tsx` | Modify | Add "Insert image" button |
| `src/components/sheet-context-menu.tsx` | Modify | Add "Delete image" context menu item |

---

## Task 1: Add SheetImage Type to Sheets Package

**Files:**
- Modify: `packages/sheets/src/model/workbook/worksheet-document.ts:12-78`
- Modify: `packages/sheets/src/index.ts`

- [x] **Step 1: Add SheetImage type definition**

In `packages/sheets/src/model/workbook/worksheet-document.ts`, add the `SheetImage` type after the `SheetChart` type (after line 30):

```typescript
export type SheetImage = {
  id: string;
  src: string;
  anchor: Sref;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  alt?: string;
};
```

- [x] **Step 2: Add images field to Worksheet type**

In the same file, add `images` to the `Worksheet` type, next to the existing `charts` field:

```typescript
  charts?: { [id: string]: SheetChart };
  images?: { [id: string]: SheetImage };  // ADD THIS LINE
```

- [x] **Step 3: Initialize images in createWorksheet()**

In the `createWorksheet()` function, add `images: {},` next to `charts: {},`.

- [x] **Step 4: Export SheetImage from index.ts**

In `packages/sheets/src/index.ts`, find where `SheetChart` is exported and add `SheetImage` next to it:

```typescript
export type { SheetChart, SheetImage } from './model/workbook/worksheet-document';
```

- [x] **Step 5: Verify build**

Run: `pnpm sheets build`
Expected: Build succeeds with no errors

- [x] **Step 6: Commit**

```bash
git add packages/sheets/src/model/workbook/worksheet-document.ts packages/sheets/src/index.ts
git commit -m "Add SheetImage type and images field to Worksheet"
```

---

## Task 2: Backend Workspace-Scoped Image Endpoints

**Files:**
- Create: `packages/backend/src/api/v1/images.controller.ts`
- Modify: `packages/backend/src/api/v1/api-v1.module.ts`

- [x] **Step 1: Read existing image module for reference**

Read these files to understand current patterns:
- `packages/backend/src/image/image.controller.ts`
- `packages/backend/src/image/image.service.ts`
- `packages/backend/src/api/v1/documents.controller.ts`

- [x] **Step 2: Create workspace-scoped images controller**

Create `packages/backend/src/api/v1/images.controller.ts`:

```typescript
import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ImageService } from '../../image/image.service';
import { AuthenticatedRequest } from '../../auth/auth.types';

@Controller('api/v1/workspaces/:workspaceId/images')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
export class ApiV1ImagesController {
  constructor(private readonly imageService: ImageService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ id: string; url: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.imageService.upload(file.buffer, file.mimetype, file.originalname);
  }

  @Get(':imageId')
  async get(
    @Param('imageId') imageId: string,
    @Res() res: Response,
  ): Promise<void> {
    const stream = await this.imageService.get(imageId);
    if (!stream) {
      throw new NotFoundException('Image not found');
    }
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', stream.contentType);
    stream.body.pipe(res);
  }

  @Delete(':imageId')
  async delete(@Param('imageId') imageId: string): Promise<void> {
    await this.imageService.delete(imageId);
  }
}
```

- [x] **Step 3: Register controller in API v1 module**

In `packages/backend/src/api/v1/api-v1.module.ts`, add the import and register the controller:

```typescript
import { ApiV1ImagesController } from './images.controller';
```

Add `ApiV1ImagesController` to the `controllers` array. Add `ImageModule` to the `imports` array.

- [x] **Step 4: Verify build**

Run: `pnpm backend build`
Expected: Build succeeds

- [x] **Step 5: Verify existing tests still pass**

Run: `pnpm backend test`
Expected: All tests pass

- [x] **Step 6: Commit**

```bash
git add packages/backend/src/api/v1/images.controller.ts packages/backend/src/api/v1/api-v1.module.ts
git commit -m "Add workspace-scoped image upload endpoints to API v1"
```

---

## Task 3: Frontend Image Cache

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/image-cache.ts`

- [x] **Step 1: Read Docs image-cache.ts for reference**

Read: `packages/docs/src/view/image-cache.ts`

- [x] **Step 2: Create image cache module**

Create `packages/frontend/src/app/spreadsheet/image-cache.ts`:

```typescript
const imageCache = new Map<string, HTMLImageElement>();
const pendingCallbacks = new Map<string, Array<() => void>>();

/**
 * Returns cached HTMLImageElement or null (triggers async load).
 * When image loads, all registered callbacks are invoked.
 */
export function getOrLoadImage(
  src: string,
  onLoad?: () => void,
): HTMLImageElement | null {
  const cached = imageCache.get(src);
  if (cached) {
    if (cached.naturalWidth === 0) return null; // failed
    return cached;
  }

  const pending = pendingCallbacks.get(src);
  if (pending) {
    if (onLoad) pending.push(onLoad);
    return null;
  }

  const callbacks: Array<() => void> = [];
  if (onLoad) callbacks.push(onLoad);
  pendingCallbacks.set(src, callbacks);

  const img = new Image();
  img.onload = () => {
    imageCache.set(src, img);
    const cbs = pendingCallbacks.get(src);
    pendingCallbacks.delete(src);
    cbs?.forEach((cb) => cb());
  };
  img.onerror = () => {
    const placeholder = new Image();
    imageCache.set(src, placeholder); // naturalWidth = 0
    const cbs = pendingCallbacks.get(src);
    pendingCallbacks.delete(src);
    cbs?.forEach((cb) => cb());
  };
  img.src = src;

  return null;
}
```

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/image-cache.ts
git commit -m "Add image cache with async load and dedup for Sheets"
```

---

## Task 4: Frontend Image Upload Helper

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/image-upload.ts`

- [x] **Step 1: Read Docs upload pattern for reference**

Read: `packages/frontend/src/app/docs/image-insert.ts` (lines 1-50)
Read: `packages/frontend/src/app/docs/docx-actions.ts` (image upload section)

- [x] **Step 2: Create image upload helper**

Create `packages/frontend/src/app/spreadsheet/image-upload.ts`:

```typescript
import { fetchWithAuth } from '../../api/auth';

const BACKEND_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export type UploadResult = {
  id: string;
  url: string;
  width: number;
  height: number;
};

/**
 * Validates the file, loads dimensions, uploads to server.
 * Throws on validation or upload failure.
 */
export async function uploadImageFile(
  file: File,
  workspaceId: string,
): Promise<UploadResult> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large (max 10 MB)');
  }

  const { width, height } = await loadImageDimensions(file);

  const formData = new FormData();
  formData.append('file', file);

  const res = await fetchWithAuth(
    `${BACKEND_BASE}/api/v1/workspaces/${workspaceId}/images`,
    { method: 'POST', body: formData },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed: ${body}`);
  }

  const { id, url } = await res.json();
  return { id, url: resolveImageUrl(url), width, height };
}

function loadImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

function resolveImageUrl(url: string): string {
  if (url.startsWith('/')) return `${BACKEND_BASE}${url}`;
  return url;
}
```

- [x] **Step 3: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/image-upload.ts
git commit -m "Add image upload helper for Sheets"
```

---

## Task 5: Image Anchor Shifting on Row/Column Operations

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts:79-128`

- [x] **Step 1: Read existing chart anchor shift logic**

Read: `packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts` (lines 79-250)

- [x] **Step 2: Add shiftImageAnchors function**

Add `shiftImageAnchors` after `shiftChartAnchors` in the same file:

```typescript
function shiftImageAnchors(
  images: Worksheet['images'] | undefined,
  axis: Axis,
  index: number,
  count: number,
): void {
  if (!images) return;

  for (const image of safeWorksheetRecordValues(images as Record<string, SheetImage>)) {
    const shiftedAnchor = shiftSref(image.anchor, axis, index, count);
    if (shiftedAnchor) {
      image.anchor = shiftedAnchor;
      continue;
    }
    const fallback = parseRef(image.anchor);
    if (axis === 'row') {
      fallback.r = Math.max(1, index);
    } else {
      fallback.c = Math.max(1, index);
    }
    image.anchor = toSref(fallback);
  }
}
```

- [x] **Step 3: Add moveImageAnchors function**

Add `moveImageAnchors` after `moveChartAnchors`:

```typescript
function moveImageAnchors(
  images: Worksheet['images'] | undefined,
  axis: Axis,
  srcIndex: number,
  count: number,
  dstIndex: number,
): void {
  if (!images) return;

  for (const image of safeWorksheetRecordValues(images as Record<string, SheetImage>)) {
    const nextAnchor = moveRef(
      parseRef(image.anchor),
      axis,
      srcIndex,
      count,
      dstIndex,
    );
    image.anchor = toSref(nextAnchor);
  }
}
```

- [x] **Step 4: Wire into applyYorkieWorksheetShift**

Find the call to `shiftChartAnchors(ws.charts, ...)` in `applyYorkieWorksheetShift` and add below it:

```typescript
shiftImageAnchors(ws.images, axis, index, count);
```

- [x] **Step 5: Wire into applyYorkieWorksheetMove**

Find the call to `moveChartAnchors(ws.charts, ...)` in `applyYorkieWorksheetMove` and add below it:

```typescript
moveImageAnchors(ws.images, axis, srcIndex, count, dstIndex);
```

- [x] **Step 6: Add SheetImage import**

Add `SheetImage` to the imports from `@wafflebase/sheets` at the top of the file.

- [x] **Step 7: Verify build**

Run: `pnpm build`
Expected: Build succeeds

- [x] **Step 8: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/yorkie-worksheet-structure.ts
git commit -m "Add image anchor shifting on row/column insert/delete/move"
```

---

## Task 6: Image Object Layer — Rendering and Hit-Testing

**Files:**
- Create: `packages/frontend/src/app/spreadsheet/image-object-layer.tsx`

- [x] **Step 1: Read chart-object-layer.tsx for reference**

Read: `packages/frontend/src/app/spreadsheet/chart-object-layer.tsx` (full file)

- [x] **Step 2: Create ImageObjectLayer component**

Create `packages/frontend/src/app/spreadsheet/image-object-layer.tsx`:

```typescript
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { SheetImage, Sref } from '@wafflebase/sheets';
import type { Spreadsheet } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '../../types/worksheet';
import { getOrLoadImage } from './image-cache';
import { parseRef, toSref } from '@wafflebase/sheets';

type ImageHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_SIZE = 8;
const HANDLE_HALF = HANDLE_SIZE / 2;
const HANDLE_HIT_SLACK = 4;
const BORDER_COLOR = '#1a73e8';
const HANDLE_FILL = '#ffffff';

type ImageRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragState = {
  type: 'move' | 'resize';
  imageId: string;
  startX: number;
  startY: number;
  startRect: ImageRect;
  handle?: ImageHandle;
};

type ImageObjectLayerProps = {
  spreadsheet: Spreadsheet | undefined;
  root: SpreadsheetDocument;
  tabId: string;
  readOnly: boolean;
  selectedImageId: string | null;
  onSelectImage: (imageId: string | null) => void;
  onUpdateImage: (imageId: string, patch: Partial<SheetImage>) => void;
  onDeleteImage: (imageId: string) => void;
  renderVersion: number;
};

export function ImageObjectLayer({
  spreadsheet,
  root,
  tabId,
  readOnly,
  selectedImageId,
  onSelectImage,
  onUpdateImage,
  onDeleteImage,
  renderVersion,
}: ImageObjectLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [previewRect, setPreviewRect] = useState<ImageRect | null>(null);

  const images = root.sheets?.[tabId]?.images;
  const imageEntries = images
    ? Object.values(images).filter((img): img is SheetImage => !!img?.id)
    : [];

  // Convert anchor+offset to screen coordinates
  const toScreenRect = useCallback(
    (img: SheetImage): ImageRect | null => {
      if (!spreadsheet) return null;
      const rect = spreadsheet.cellBoundingRect(parseRef(img.anchor));
      if (!rect) return null;
      return {
        id: img.id,
        x: rect.left + img.offsetX,
        y: rect.top + img.offsetY,
        width: img.width,
        height: img.height,
      };
    },
    [spreadsheet],
  );

  // Collect all visible image rects
  const getImageRects = useCallback((): ImageRect[] => {
    return imageEntries
      .map(toScreenRect)
      .filter((r): r is ImageRect => r !== null);
  }, [imageEntries, toScreenRect]);

  // Hit-test: find image at point
  const findImageAtPoint = useCallback(
    (x: number, y: number): ImageRect | null => {
      const rects = getImageRects();
      // Reverse order so topmost image is hit first
      for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i];
        if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
          return r;
        }
      }
      return null;
    },
    [getImageRects],
  );

  // Hit-test: which handle at point
  const findHandleAtPoint = useCallback(
    (rect: ImageRect, x: number, y: number): ImageHandle | null => {
      const slack = HANDLE_HALF + HANDLE_HIT_SLACK;
      const handles: Array<{ handle: ImageHandle; hx: number; hy: number }> = [
        { handle: 'nw', hx: rect.x, hy: rect.y },
        { handle: 'n', hx: rect.x + rect.width / 2, hy: rect.y },
        { handle: 'ne', hx: rect.x + rect.width, hy: rect.y },
        { handle: 'e', hx: rect.x + rect.width, hy: rect.y + rect.height / 2 },
        { handle: 'se', hx: rect.x + rect.width, hy: rect.y + rect.height },
        { handle: 's', hx: rect.x + rect.width / 2, hy: rect.y + rect.height },
        { handle: 'sw', hx: rect.x, hy: rect.y + rect.height },
        { handle: 'w', hx: rect.x, hy: rect.y + rect.height / 2 },
      ];
      for (const { handle, hx, hy } of handles) {
        if (Math.abs(x - hx) <= slack && Math.abs(y - hy) <= slack) {
          return handle;
        }
      }
      return null;
    },
    [],
  );

  // Draw images + selection overlay on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spreadsheet) return;

    const container = canvas.parentElement;
    if (!container) return;
    canvas.width = container.clientWidth * devicePixelRatio;
    canvas.height = container.clientHeight * devicePixelRatio;
    canvas.style.width = `${container.clientWidth}px`;
    canvas.style.height = `${container.clientHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const rects = getImageRects();

    // Draw images
    for (const rect of rects) {
      const img = imageEntries.find((i) => i.id === rect.id);
      if (!img) continue;

      const drawRect = previewRect?.id === rect.id ? previewRect : rect;
      const htmlImg = getOrLoadImage(img.src, () => {
        // Force re-render on load
        canvas.dispatchEvent(new Event('image-loaded'));
      });

      if (htmlImg) {
        ctx.drawImage(htmlImg, drawRect.x, drawRect.y, drawRect.width, drawRect.height);
      } else {
        // Placeholder while loading
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(drawRect.x, drawRect.y, drawRect.width, drawRect.height);
        ctx.strokeStyle = '#ccc';
        ctx.strokeRect(drawRect.x, drawRect.y, drawRect.width, drawRect.height);
      }

      // Selection overlay
      if (img.id === selectedImageId) {
        drawSelectionOverlay(ctx, drawRect);
      }
    }
  }, [renderVersion, selectedImageId, imageEntries, getImageRects, previewRect, spreadsheet]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (readOnly) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const canvasRect = canvas.getBoundingClientRect();
      const x = e.clientX - canvasRect.left;
      const y = e.clientY - canvasRect.top;

      // If image selected, check handle first
      if (selectedImageId) {
        const selectedRect = getImageRects().find((r) => r.id === selectedImageId);
        if (selectedRect) {
          const handle = findHandleAtPoint(selectedRect, x, y);
          if (handle) {
            e.stopPropagation();
            e.preventDefault();
            dragRef.current = {
              type: 'resize',
              imageId: selectedImageId,
              startX: e.clientX,
              startY: e.clientY,
              startRect: { ...selectedRect },
              handle,
            };
            return;
          }
        }
      }

      // Check image body hit
      const hit = findImageAtPoint(x, y);
      if (hit) {
        e.stopPropagation();
        e.preventDefault();
        onSelectImage(hit.id);
        dragRef.current = {
          type: 'move',
          imageId: hit.id,
          startX: e.clientX,
          startY: e.clientY,
          startRect: { ...hit },
        };
        return;
      }

      // Miss — deselect
      if (selectedImageId) {
        onSelectImage(null);
      }
    },
    [readOnly, selectedImageId, getImageRects, findHandleAtPoint, findImageAtPoint, onSelectImage],
  );

  // Global mousemove/mouseup for drag
  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (drag.type === 'move') {
        setPreviewRect({
          ...drag.startRect,
          x: drag.startRect.x + dx,
          y: drag.startRect.y + dy,
        });
      } else if (drag.type === 'resize' && drag.handle) {
        setPreviewRect(computeResizeRect(drag.startRect, drag.handle, dx, dy));
      }
    };

    const handleMouseUp = (e: globalThis.MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || !spreadsheet) {
        dragRef.current = null;
        setPreviewRect(null);
        return;
      }

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (drag.type === 'move' && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        // Compute new anchor + offset from final position
        const finalX = drag.startRect.x + dx;
        const finalY = drag.startRect.y + dy;
        const newRef = spreadsheet.cellRefFromPoint(finalX, finalY);
        if (newRef) {
          const cellRect = spreadsheet.cellBoundingRect(newRef);
          if (cellRect) {
            onUpdateImage(drag.imageId, {
              anchor: toSref(newRef) as Sref,
              offsetX: finalX - cellRect.left,
              offsetY: finalY - cellRect.top,
            });
          }
        }
      } else if (drag.type === 'resize' && drag.handle) {
        const result = computeResizeRect(drag.startRect, drag.handle, dx, dy);
        if (result.width !== drag.startRect.width || result.height !== drag.startRect.height) {
          onUpdateImage(drag.imageId, {
            width: Math.max(20, result.width),
            height: Math.max(20, result.height),
          });
        }
      }

      dragRef.current = null;
      setPreviewRect(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [spreadsheet, onUpdateImage]);

  // Keyboard handler for delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedImageId || readOnly) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDeleteImage(selectedImageId);
        onSelectImage(null);
      }
      if (e.key === 'Escape') {
        onSelectImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImageId, readOnly, onDeleteImage, onSelectImage]);

  if (imageEntries.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: selectedImageId || imageEntries.length > 0 ? 'auto' : 'none',
        zIndex: 2,
      }}
      onMouseDown={handleMouseDown}
    />
  );
}

// --- Helper functions ---

function drawSelectionOverlay(ctx: CanvasRenderingContext2D, rect: ImageRect) {
  // Border
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

  // 8 handles
  const handles = [
    [rect.x, rect.y],
    [rect.x + rect.width / 2, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x + rect.width, rect.y + rect.height / 2],
    [rect.x + rect.width, rect.y + rect.height],
    [rect.x + rect.width / 2, rect.y + rect.height],
    [rect.x, rect.y + rect.height],
    [rect.x, rect.y + rect.height / 2],
  ];

  ctx.fillStyle = HANDLE_FILL;
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 1.5;
  for (const [hx, hy] of handles) {
    ctx.fillRect(hx - HANDLE_HALF, hy - HANDLE_HALF, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(hx - HANDLE_HALF, hy - HANDLE_HALF, HANDLE_SIZE, HANDLE_SIZE);
  }
}

function computeResizeRect(
  start: ImageRect,
  handle: ImageHandle,
  dx: number,
  dy: number,
): ImageRect {
  let { x, y, width, height } = start;
  const aspect = width / height;

  switch (handle) {
    case 'se':
      width += dx;
      height = width / aspect;
      break;
    case 'nw':
      width -= dx;
      height = width / aspect;
      x = start.x + start.width - width;
      y = start.y + start.height - height;
      break;
    case 'ne':
      width += dx;
      height = width / aspect;
      y = start.y + start.height - height;
      break;
    case 'sw':
      width -= dx;
      height = width / aspect;
      x = start.x + start.width - width;
      break;
    case 'e':
      width += dx;
      break;
    case 'w':
      width -= dx;
      x = start.x + start.width - width;
      break;
    case 'n':
      height -= dy;
      y = start.y + start.height - height;
      break;
    case 's':
      height += dy;
      break;
  }

  return {
    id: start.id,
    x,
    y,
    width: Math.max(20, width),
    height: Math.max(20, height),
  };
}
```

- [x] **Step 3: Verify build**

Run: `pnpm build`
Expected: Build succeeds (component not yet wired)

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/image-object-layer.tsx
git commit -m "Add ImageObjectLayer with rendering, selection, drag, and resize"
```

---

## Task 7: Wire Image CRUD into SheetView

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx`

- [x] **Step 1: Read sheet-view.tsx for chart integration pattern**

Read: `packages/frontend/src/app/spreadsheet/sheet-view.tsx` (full file, focus on chart-related code)

- [x] **Step 2: Add image state and imports**

Add imports at the top:

```typescript
import type { SheetImage } from '@wafflebase/sheets';
import { uploadImageFile } from './image-upload';
```

Add lazy import for ImageObjectLayer:

```typescript
const ImageObjectLayer = lazy(() =>
  import('./image-object-layer').then((m) => ({ default: m.ImageObjectLayer })),
);
```

Add state variables near the chart state:

```typescript
const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
```

- [x] **Step 3: Add image CRUD handlers**

Add after the chart handlers, following the same pattern:

```typescript
const handleInsertImage = useCallback(
  async (file: File) => {
    if (readOnly || !doc) return;

    try {
      const result = await uploadImageFile(file, workspaceId);
      const sheet = sheetRef.current;
      const anchor = sheet ? toSref(sheet.getActiveCell()) : 'A1';
      const imageId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      doc.update((root) => {
        const ws = root.sheets[tabId];
        if (!ws.images) {
          ws.images = {};
        }
        ws.images[imageId] = {
          id: imageId,
          src: result.url,
          anchor,
          offsetX: 8,
          offsetY: 8,
          width: Math.min(result.width, 400),
          height: Math.min(result.width, 400) * (result.height / result.width),
          originalWidth: result.width,
          originalHeight: result.height,
        } as SheetImage;
      });

      setSelectedImageId(imageId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Image upload failed');
    }
  },
  [doc, readOnly, tabId, workspaceId],
);

const handleUpdateImage = useCallback(
  (imageId: string, patch: Partial<SheetImage>) => {
    if (readOnly || !doc) return;

    doc.update((root) => {
      const image = root.sheets[tabId]?.images?.[imageId];
      if (!image) return;

      if (patch.anchor !== undefined) image.anchor = patch.anchor;
      if (patch.offsetX !== undefined) image.offsetX = patch.offsetX;
      if (patch.offsetY !== undefined) image.offsetY = patch.offsetY;
      if (patch.width !== undefined) image.width = patch.width;
      if (patch.height !== undefined) image.height = patch.height;
    });
  },
  [doc, readOnly, tabId],
);

const handleDeleteImage = useCallback(
  (imageId: string) => {
    if (readOnly || !doc) return;

    doc.update((root) => {
      const ws = root.sheets[tabId];
      if (!ws?.images?.[imageId]) return;
      delete ws.images[imageId];
    });

    if (selectedImageId === imageId) {
      setSelectedImageId(null);
    }
  },
  [doc, readOnly, selectedImageId, tabId],
);
```

- [x] **Step 4: Render ImageObjectLayer**

Find where `ChartObjectLayer` is rendered and add `ImageObjectLayer` above it (images render below charts in z-order):

```typescript
{imageEntries.length > 0 && (
  <Suspense fallback={null}>
    <ImageObjectLayer
      spreadsheet={sheet}
      root={root}
      tabId={tabId}
      readOnly={readOnly}
      selectedImageId={selectedImageId}
      onSelectImage={setSelectedImageId}
      onUpdateImage={handleUpdateImage}
      onDeleteImage={handleDeleteImage}
      renderVersion={renderVersion}
    />
  </Suspense>
)}
```

Where `imageEntries` is derived:

```typescript
const hasImages = !!root && Object.keys(root.sheets[tabId]?.images || {}).length > 0;
```

- [x] **Step 5: Pass handleInsertImage to toolbar**

Find where `onInsertChart` is passed to `FormattingToolbar` and add:

```typescript
onInsertImage={handleInsertImage}
```

- [x] **Step 6: Verify build**

Run: `pnpm build`
Expected: Build succeeds

- [x] **Step 7: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/sheet-view.tsx
git commit -m "Wire image CRUD handlers and ImageObjectLayer into SheetView"
```

---

## Task 8: Toolbar Insert Image Button

**Files:**
- Modify: `packages/frontend/src/components/formatting-toolbar.tsx`

- [x] **Step 1: Read toolbar to find chart button pattern**

Read: `packages/frontend/src/components/formatting-toolbar.tsx` (find `onInsertChart` and chart button)

- [x] **Step 2: Add onInsertImage prop**

Add to the `FormattingToolbarProps` interface:

```typescript
onInsertImage?: (file: File) => void;
```

- [x] **Step 3: Add image insert button with file input**

Find the chart insert button (`IconChartBar`) and add an image button next to it:

```typescript
<>
  <input
    ref={imageInputRef}
    type="file"
    accept="image/png,image/jpeg,image/gif,image/webp"
    className="hidden"
    onChange={(e) => {
      const file = e.target.files?.[0];
      if (file) onInsertImage?.(file);
      e.target.value = '';
    }}
  />
  <ToolbarButton
    tooltip="Insert image"
    onClick={() => imageInputRef.current?.click()}
    disabled={readOnly}
  >
    <IconPhoto size={16} />
  </ToolbarButton>
</>
```

Add `useRef` for the file input:

```typescript
const imageInputRef = useRef<HTMLInputElement>(null);
```

Add `IconPhoto` to the Tabler icon imports.

- [x] **Step 4: Verify build**

Run: `pnpm build`
Expected: Build succeeds

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/components/formatting-toolbar.tsx
git commit -m "Add image insert button to formatting toolbar"
```

---

## Task 9: Drag-and-Drop and Clipboard Paste Image Insertion

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx`

- [x] **Step 1: Add drag-and-drop handler**

Add dragover and drop handlers to the spreadsheet container div:

```typescript
const handleDragOver = useCallback((e: React.DragEvent) => {
  if (readOnly) return;
  const hasImage = Array.from(e.dataTransfer.items).some((item) =>
    item.type.startsWith('image/'),
  );
  if (hasImage) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
}, [readOnly]);

const handleDrop = useCallback(
  (e: React.DragEvent) => {
    if (readOnly) return;
    e.preventDefault();

    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.type.startsWith('image/'),
    );
    if (!file) return;

    handleInsertImage(file);
  },
  [readOnly, handleInsertImage],
);
```

Add `onDragOver={handleDragOver}` and `onDrop={handleDrop}` to the spreadsheet container element.

- [x] **Step 2: Add clipboard paste handler**

Add paste handler:

```typescript
const handlePaste = useCallback(
  (e: ClipboardEvent) => {
    if (readOnly) return;

    const imageFile = Array.from(e.clipboardData?.items || [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .find((f): f is File => f !== null);

    if (imageFile) {
      e.preventDefault();
      handleInsertImage(imageFile);
    }
  },
  [readOnly, handleInsertImage],
);

useEffect(() => {
  const container = containerRef.current;
  if (!container) return;
  container.addEventListener('paste', handlePaste);
  return () => container.removeEventListener('paste', handlePaste);
}, [handlePaste]);
```

- [x] **Step 3: Verify build**

Run: `pnpm build`
Expected: Build succeeds

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/sheet-view.tsx
git commit -m "Add drag-and-drop and clipboard paste for image insertion"
```

---

## Task 10: Context Menu Delete Image

**Files:**
- Modify: `packages/frontend/src/components/sheet-context-menu.tsx`
- Modify: `packages/frontend/src/app/spreadsheet/sheet-view.tsx`

- [x] **Step 1: Read context menu component**

Read: `packages/frontend/src/components/sheet-context-menu.tsx`

- [x] **Step 2: Add onDeleteImage prop to SheetContextMenu**

Add to props:

```typescript
onDeleteImage?: () => void;
selectedImageId?: string | null;
```

- [x] **Step 3: Add "Delete image" menu item**

When `selectedImageId` is truthy, add a "Delete image" menu item:

```typescript
{selectedImageId && (
  <>
    <ContextMenuSeparator />
    <ContextMenuItem onClick={() => onDeleteImage?.()}>
      <IconTrash size={14} />
      Delete image
    </ContextMenuItem>
  </>
)}
```

Add `IconTrash` to imports.

- [x] **Step 4: Wire in sheet-view.tsx**

Pass the new props to `SheetContextMenu`:

```typescript
onDeleteImage={() => {
  if (selectedImageId) {
    handleDeleteImage(selectedImageId);
  }
}}
selectedImageId={selectedImageId}
```

- [x] **Step 5: Verify build**

Run: `pnpm build`
Expected: Build succeeds

- [x] **Step 6: Commit**

```bash
git add packages/frontend/src/components/sheet-context-menu.tsx packages/frontend/src/app/spreadsheet/sheet-view.tsx
git commit -m "Add delete image option to sheet context menu"
```

---

## Task 11: Final Verification

- [x] **Step 1: Run lint and unit tests**

Run: `pnpm verify:fast`
Expected: All checks pass

- [x] **Step 2: Manual verification**

Start dev server: `pnpm dev`

Test each insertion path:
1. Click toolbar image button → select file → image appears at active cell
2. Drag image file from OS file explorer → drop on sheet → image appears at drop position
3. Copy image to clipboard → Ctrl+V on sheet → image appears at active cell

Test interactions:
4. Click image → selection handles appear
5. Drag image body → image moves, anchor updates
6. Drag corner handle → image resizes with aspect ratio
7. Press Delete with image selected → image removed
8. Right-click image → "Delete image" in context menu
9. Press Escape → image deselected

Test collaboration:
10. Open same document in two tabs → insert image in one → appears in the other

Test structural operations:
11. Insert row above image anchor → image moves down
12. Delete column at image anchor → image deleted

- [x] **Step 3: Commit any fixes from verification**

- [x] **Step 4: Final commit with design doc update**

```bash
git add docs/design/sheets/sheet-image.md docs/design/README.md
git commit -m "Add sheet image design doc"
```
