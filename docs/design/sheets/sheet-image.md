---
title: sheet-image
target-version: 0.3.4
---

# Sheet Image

## Summary

Add image support to the Sheets package. Phase 1 delivers floating images
(over cells) using the same anchor+offset pattern as Charts. Phase 2 adds
in-cell images via an `IMAGE()` formula function. A shared workspace-level
image upload API serves both Sheets and Docs.

## Goals / Non-Goals

### Goals

- Insert floating images via toolbar menu, drag-and-drop, and clipboard paste
- Drag-move and handle-resize for floating images
- Delete images via keyboard (Delete/Backspace) and context menu
- Server-side image upload with URL reference in the CRDT document
- Real-time collaborative sync (last-writer-wins, matching Charts)
- Anchor shift when rows/columns are inserted or deleted

### Non-Goals (Phase 1)

- In-cell images / `IMAGE()` formula function (Phase 2)
- Alt text editing, Z-order control, rotation (Phase 2)
- Image cropping, filters, borders, shadows
- S3 storage, thumbnails, CDN (future infrastructure)
- Edit locking during concurrent resize

## Proposal Details

### Data Model

#### SheetImage Type

```typescript
export type SheetImage = {
  id: string;             // UUID
  src: string;            // Server URL (/api/v1/workspaces/:wid/images/:id)
  anchor: Sref;           // Anchor cell reference (e.g. "B2")
  offsetX: number;        // Pixels from anchor cell's top-left
  offsetY: number;        // Pixels from anchor cell's top-left
  width: number;          // Display width in pixels
  height: number;         // Display height in pixels
  originalWidth: number;  // Intrinsic width for reset
  originalHeight: number; // Intrinsic height for reset
  alt?: string;           // Accessibility text (Phase 2)
};
```

#### Worksheet Document Structure

Images are stored in a top-level `images` map on the Worksheet, mirroring
the existing `charts` field:

```typescript
export type Worksheet = {
  cells: { [key: string]: Cell };
  charts?: { [id: string]: SheetChart };
  images?: { [id: string]: SheetImage };  // NEW
  // ... existing fields ...
};
```

#### Document Mutations

Images are managed via direct Yorkie `doc.update()` calls, matching the
Charts pattern. There are no dedicated Store interface methods — CRUD
operations mutate `root.sheets[tabId].images` directly within the Yorkie
document update callback.

### Backend: Workspace-Level Image API

A shared image service at the workspace level, usable by both Sheets and
Docs.

#### Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/v1/workspaces/:wid/images` | Upload image (multipart/form-data) |
| `GET` | `/api/v1/workspaces/:wid/images/:id` | Retrieve image binary |
| `DELETE` | `/api/v1/workspaces/:wid/images/:id` | Delete image |

All endpoints use `CombinedAuthGuard` (JWT + API key).

#### Prisma Model

```prisma
model Image {
  id          String    @id @default(uuid())
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  filename    String
  mimeType    String
  size        Int
  width       Int
  height      Int
  storagePath String
  createdBy   Int
  createdAt   DateTime  @default(now())
}
```

#### Constraints

- Allowed types: image/png, image/jpeg, image/gif, image/webp
- Max file size: 10 MB
- Storage: local filesystem via `StorageService` abstraction (swap to S3 later)

#### Module Structure

```
src/image/
├── image.module.ts       # Provides ImageService, StorageService
├── image.service.ts      # Metadata CRUD (Prisma)
├── image.controller.ts   # REST endpoints
└── storage.service.ts    # File I/O abstraction (local, future S3)
```

#### Upload Flow

1. Client sends `POST` with multipart file
2. Backend validates mime type and size
3. `StorageService` writes file to `uploads/images/:wid/:id.ext`
4. `ImageService` creates `Image` record in database
5. Response: `{ id, url, width, height }`

### Frontend: Rendering

#### Canvas Layer Order

```
① Grid Canvas      — cells, text, borders
② Image Layer      — floating images (NEW)
③ Chart Layer      — chart rendering (existing)
④ Overlay Canvas   — selection, handles, drag preview
```

#### Image Rendering Pipeline

1. `store.getImages()` — fetch all images from the store
2. Filter to viewport — skip images whose anchor + offset falls outside
   the visible area
3. Compute pixel position — `toBoundingRect(anchor)` + `offsetX/Y`
4. Async load — `getOrLoadImage(src, onLoad)` with caching (reuse Docs
   pattern from `image-cache.ts`)
5. Draw — `ctx.drawImage(img, x, y, width, height)`

### Frontend: Interaction

#### Image Selection

- `mousedown` on canvas → hit-test against all image rects
- If hit: select image, show 8 resize handles + blue border on overlay
- If miss: clear image selection, fall through to cell selection

#### Drag Move

- `mousedown` on selected image body → start drag
- `mousemove` → update preview position on overlay
- `mouseup` → compute new anchor + offset, call `store.updateImage()`

#### Handle Resize

- `mousedown` on handle → start resize drag
- `mousemove` → compute preview rect (aspect-ratio locked by default,
  Shift to release)
- `mouseup` → call `store.updateImage({ width, height })`
- Opposite corner/edge stays anchored (Google Sheets behavior)

#### Delete

- Selected image + Delete/Backspace → `store.deleteImage(id)`
- Context menu → "Delete image" option

#### Keyboard

- Escape → deselect image, return to cell mode

### Frontend: Insertion Paths

All three paths converge on: upload to server → `store.setImage()`.

#### Toolbar / Menu

Insert menu → "Image" → file dialog → upload → insert at active cell
with offset (0, 0).

#### Drag and Drop

`dragover` checks `dataTransfer` for image files → `drop` computes cell
from drop coordinates → upload → insert at computed anchor + offset.

#### Clipboard Paste

`paste` event → check `clipboardData.items` for image files → upload →
insert at active cell.

### Collaboration

#### Yorkie Sync

Image CRUD operations sync through Yorkie like Charts. The `images` map
uses last-writer-wins for concurrent edits to the same image.

#### Anchor Shift on Structural Changes

When rows or columns are inserted or deleted, image anchors shift
accordingly — same logic as chart anchor adjustment:

- Row insert above anchor → anchor row increments
- Column delete at anchor column → image deleted
- Row/column move → anchor updated to new position

#### Undo / Redo

Image mutations use the Store's existing `beginBatch/endBatch` to group
operations into single undo steps.

### Phase Roadmap

| | Phase 1 (current) | Phase 2 (future) |
|---|---|---|
| Floating image | Insert, drag-move, resize, delete | Alt text, Z-order, rotation |
| In-cell image | — | `IMAGE()` function, cell rendering |
| Insert paths | Menu, drag-and-drop, paste | URL input dialog |
| Backend | Upload API (workspace-level) | S3 migration, thumbnails |
| Collaboration | Real-time sync (LWW) | Edit locking (if needed) |

## Risks and Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large images slow Yorkie sync | Document bloat, sync latency | Only store URL in CRDT; binary on server; 10 MB limit |
| Concurrent resize conflicts | Visual flicker | Last-writer-wins (acceptable, matches Charts/Google Sheets) |
| Local file storage limits | Not production-scalable | StorageService abstraction allows S3 swap without API changes |
| Image load latency | Blank rectangles on first render | Async load with cache + placeholder rendering |
