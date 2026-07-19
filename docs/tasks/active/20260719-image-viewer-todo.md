# Image Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `"image"` document type — upload png/jpeg/gif/webp files from the documents list, view them in an `<img>` viewer at `/f/:id` with zoom/download and workspace prev/next, and show inline lazy thumbnails in the list.

**Architecture:** Mirror the PDF static-blob spine. Images reuse `Document.fileId`, the `wafflebase-files` bucket, and the already-type-agnostic `GET /documents/:id/file` serving endpoint. No new migration, no new bucket, no Yorkie CRDT (comments/sharing deferred). The multi-file upload queue gains an `image` branch identical to `pdf`. The `/f/:id` route dispatches by `doc.type` to a PDF or image shell.

**Tech Stack:** NestJS + `@aws-sdk/client-s3` (MinIO) backend; React + TanStack Query + Tailwind/shadcn frontend; Vitest (frontend) / Jest (backend).

## Global Constraints

- Design spec: `docs/design/image-viewer.md`. Target version 0.7.0.
- Allowed image formats **only**: `png`, `jpg`/`jpeg`, `gif`, `webp`. No SVG/HEIC/AVIF/BMP/TIFF.
- Image size cap: **25 MB** (`MAX_IMAGE_UPLOAD_BYTES`). PDF stays **50 MB** (`MAX_PDF_UPLOAD_BYTES`). The `POST /files` Multer ceiling is the max of both (50 MB); the tighter per-category cap is enforced in `FileService.upload()`.
- `fileId` is allowed on `pdf` **and** `image` documents only — never on `sheet`/`doc`/`slides`.
- Image bytes are always loaded via `fetchWithAuth` → `URL.createObjectURL` (never a direct cross-origin `<img src>`), matching the PDF viewer's auth path. Always `revokeObjectURL` on unmount.
- Commit format: subject ≤ 70 chars, blank line 2, body wrapped ≤ 80 chars/line (a commit-msg hook enforces this). Each commit must pass `pnpm verify:fast`.
- Reserve the `image-` Yorkie key prefix but attach nothing (comments deferred).
- Out of scope this PR: comments/presence/sharing (`image-<id>` Yorkie doc), documents-list gallery/grid view (D2), server-side thumbnails.

---

## File Structure

- `packages/backend/src/file/file.constants.ts` — widen id pattern, add image cap (modify)
- `packages/backend/src/file/file.config.ts` — allow image MIMEs (modify)
- `packages/backend/src/file/file.service.ts` — image ext map + per-category cap (modify)
- `packages/backend/src/file/file.service.spec.ts` — image validation tests (modify)
- `packages/backend/src/document/document.dto.ts` — add `'image'` to `DOCUMENT_TYPES` (modify)
- `packages/backend/src/document/document-file-id.util.ts` — extracted `assertFileIdAllowed` (create)
- `packages/backend/src/document/document-file-id.util.spec.ts` — gate tests (create)
- `packages/backend/src/document/document.controller.ts` — call the extracted util (modify)
- `packages/backend/src/yorkie/yorkie-doc-key.ts` — reserve `image-` prefix (modify)
- `packages/backend/src/yorkie/yorkie-doc-key.spec.ts` — prefix tests (create)
- `packages/frontend/src/types/documents.ts` — add `"image"` to `DocumentType` (modify)
- `packages/frontend/src/app/documents/upload-kind.ts` — classify image extensions (modify)
- `packages/frontend/src/app/documents/__tests__/upload-kind.test.ts` — image classify tests (modify)
- `packages/frontend/src/api/files.ts` — `uploadPdf`→`uploadFile`, `pdfFileUrl`→`fileUrl` (modify)
- `packages/frontend/src/app/documents/upload-queue.ts` — merged image/pdf branch (modify)
- `packages/frontend/src/app/documents/__tests__/upload-queue.test.ts` — swap `.png` example (modify)
- `packages/frontend/src/app/documents/__tests__/upload-queue-worker.test.ts` — image branch + dep rename (modify)
- `packages/frontend/src/app/documents/document-list-utils.ts` — `image`→`/f/:id` (modify)
- `packages/frontend/src/app/documents/document-list.tsx` — TYPE_META, filter, Upload Image menu, thumbnail cell (modify)
- `packages/frontend/src/app/documents/image-thumb.tsx` — lazy row thumbnail (create)
- `packages/frontend/src/app/files/file-shell.tsx` — shared sidebar/header shell (create)
- `packages/frontend/src/app/files/image-viewer.tsx` — image viewer + prev/next (create)
- `packages/frontend/src/app/files/file-detail.tsx` — dispatch pdf vs image (modify)
- `packages/frontend/src/app/files/pdf-collab.tsx` — `pdfFileUrl`→`fileUrl` import (modify)

---

## Task 1: Backend blob storage accepts images

**Files:**
- Modify: `packages/backend/src/file/file.constants.ts`
- Modify: `packages/backend/src/file/file.config.ts`
- Modify: `packages/backend/src/file/file.service.ts`
- Test: `packages/backend/src/file/file.service.spec.ts`

**Interfaces:**
- Produces: `MAX_IMAGE_UPLOAD_BYTES` constant; widened `VALID_FILE_ID_PATTERN`; `FileService.upload(buffer, mimeType)` now accepts image MIMEs (per-category cap).

- [ ] **Step 1: Widen constants**

In `packages/backend/src/file/file.constants.ts`, replace the pdf-only pattern and add the image cap:

```ts
export const VALID_FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpe?g|gif|webp)$/i;

/** Max PDF upload size (50 MB). Shared by the Multer limit and FileService. */
export const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Max image upload size (25 MB). Enforced per-category in FileService. */
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
```

- [ ] **Step 2: Allow image MIMEs in config**

In `packages/backend/src/file/file.config.ts`, extend `allowedMimeTypes` (leave `maxFileSizeBytes: MAX_PDF_UPLOAD_BYTES` — it is the Multer ceiling / max of both caps):

```ts
  maxFileSizeBytes: MAX_PDF_UPLOAD_BYTES,
  allowedMimeTypes: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
  ],
```

- [ ] **Step 3: Write failing service tests**

Append to `packages/backend/src/file/file.service.spec.ts`. First extend `makeService` to allow images, then add image cases. Replace the `makeService` body's two config values:

```ts
    'file.maxFileSizeBytes': 50 * 1024 * 1024,
    'file.allowedMimeTypes': [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
    ],
```

Then add a new describe block:

```ts
import { MAX_IMAGE_UPLOAD_BYTES } from './file.constants';

describe('FileService.upload image support', () => {
  it('rejects an image over the 25 MB cap even though Multer allows 50 MB', async () => {
    const svc = makeService();
    const tooBig = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1);
    await expect(svc.upload(tooBig, 'image/png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an unknown mime type not in the allow-list', async () => {
    const svc = makeService();
    await expect(
      svc.upload(Buffer.from('x'), 'image/svg+xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

Note: the existing `rejects a non-pdf mime type` test constructs a service whose config is now image-allowing via the shared `makeService`. Change that one test to use a still-disallowed type so it keeps asserting the allow-list:

```ts
  it('rejects a disallowed mime type', async () => {
    const svc = makeService();
    await expect(
      svc.upload(Buffer.from('x'), 'application/zip'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @wafflebase/backend test -- file.service`
Expected: FAIL — `image/png` currently rejected (not in `MIME_TO_EXT`), 25 MB cap not enforced.

- [ ] **Step 5: Extend the service**

In `packages/backend/src/file/file.service.ts`, extend the MIME→ext map and add a per-category cap. Update the import and `MIME_TO_EXT`:

```ts
import { MAX_IMAGE_UPLOAD_BYTES } from './file.constants';

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
```

Replace the size check inside `upload()`:

```ts
    // Images get a tighter cap than the Multer ceiling (which admits the
    // largest allowed upload, i.e. a 50 MB PDF).
    const cap = mimeType.startsWith('image/')
      ? MAX_IMAGE_UPLOAD_BYTES
      : this.maxFileSize;
    if (file.length > cap) {
      throw new BadRequestException(
        `File too large (max ${cap / 1024 / 1024} MB)`,
      );
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/backend test -- file.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/file/
git commit -m "Accept image blobs in the file storage service"
```

---

## Task 2: Backend accepts the `image` document type

**Files:**
- Modify: `packages/backend/src/document/document.dto.ts`
- Create: `packages/backend/src/document/document-file-id.util.ts`
- Test: `packages/backend/src/document/document-file-id.util.spec.ts`
- Modify: `packages/backend/src/document/document.controller.ts`
- Modify: `packages/backend/src/yorkie/yorkie-doc-key.ts`
- Test: `packages/backend/src/yorkie/yorkie-doc-key.spec.ts`

**Interfaces:**
- Consumes: `VALID_FILE_ID_PATTERN` (Task 1).
- Produces: `assertFileIdAllowed(type, fileId)` exported from `document-file-id.util.ts`; `DOCUMENT_TYPES` includes `'image'`; `yorkieDocKeyPrefix('image')` → `'image-'`.

- [ ] **Step 1: Add `image` to the DTO type union**

In `packages/backend/src/document/document.dto.ts`:

```ts
const DOCUMENT_TYPES = ['sheet', 'doc', 'slides', 'pdf', 'note', 'image'] as const;
```

- [ ] **Step 2: Write failing gate util test**

Create `packages/backend/src/document/document-file-id.util.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { assertFileIdAllowed } from './document-file-id.util';

describe('assertFileIdAllowed', () => {
  it('allows a fileId on pdf and image documents', () => {
    expect(() => assertFileIdAllowed('pdf', 'blob.pdf')).not.toThrow();
    expect(() => assertFileIdAllowed('image', 'blob.png')).not.toThrow();
  });

  it('rejects a fileId on non-blob types', () => {
    for (const type of ['sheet', 'doc', 'slides', 'note', undefined]) {
      expect(() => assertFileIdAllowed(type, 'blob.png')).toThrow(
        BadRequestException,
      );
    }
  });

  it('is a no-op when no fileId is provided', () => {
    expect(() => assertFileIdAllowed('sheet', undefined)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- document-file-id`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Create the util**

Create `packages/backend/src/document/document-file-id.util.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

/** Types whose documents may carry a stored-blob `fileId`. */
const FILE_ID_TYPES = new Set(['pdf', 'image']);

/**
 * Contract guard: only pdf/image documents reference a stored blob. Reject a
 * `fileId` on any other type so the coupling can't silently loosen.
 */
export function assertFileIdAllowed(
  type: string | undefined,
  fileId: string | undefined,
): void {
  if (fileId && !FILE_ID_TYPES.has(type ?? 'sheet')) {
    throw new BadRequestException('fileId is only allowed for pdf/image documents');
  }
}
```

- [ ] **Step 5: Use the util in the controller**

In `packages/backend/src/document/document.controller.ts`, delete the private `assertFileIdAllowed` method (around lines 104-112) and import the util:

```ts
import { assertFileIdAllowed } from './document-file-id.util';
```

Replace the two call sites `this.assertFileIdAllowed(body.type, body.fileId);` with:

```ts
    assertFileIdAllowed(body.type, body.fileId);
```

- [ ] **Step 6: Write failing doc-key test**

Create `packages/backend/src/yorkie/yorkie-doc-key.spec.ts`:

```ts
import {
  yorkieDocKeyPrefix,
  yorkieDocKey,
  parseYorkieDocKey,
} from './yorkie-doc-key';

describe('yorkie-doc-key image prefix', () => {
  it('maps image to the image- prefix', () => {
    expect(yorkieDocKeyPrefix('image')).toBe('image-');
    expect(yorkieDocKey('image', 'abc')).toBe('image-abc');
  });

  it('round-trips an image key', () => {
    expect(parseYorkieDocKey('image-abc')).toEqual({ type: 'image', id: 'abc' });
  });

  it('still throws on an unknown type', () => {
    expect(() => yorkieDocKeyPrefix('bogus')).toThrow();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- yorkie-doc-key`
Expected: FAIL — `yorkieDocKeyPrefix('image')` throws (unknown type).

- [ ] **Step 8: Reserve the image prefix**

In `packages/backend/src/yorkie/yorkie-doc-key.ts`:

```ts
export type DocumentTypeLike =
  | 'sheet' | 'doc' | 'slides' | 'pdf' | 'note' | 'image';

export const YORKIE_DOC_KEY_PREFIXES = {
  sheet: 'sheet-',
  doc: 'doc-',
  slides: 'slides-',
  pdf: 'pdf-',
  note: 'note-',
  image: 'image-',
} as const;
```

And add the switch case before `default:`:

```ts
    case 'image':
      return YORKIE_DOC_KEY_PREFIXES.image;
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/backend test -- "document-file-id|yorkie-doc-key"`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/backend/src/document/ packages/backend/src/yorkie/
git commit -m "Allow the image document type in the backend"
```

---

## Task 3: Frontend classify + upload queue image branch

**Files:**
- Modify: `packages/frontend/src/types/documents.ts`
- Modify: `packages/frontend/src/app/documents/upload-kind.ts`
- Test: `packages/frontend/src/app/documents/__tests__/upload-kind.test.ts`
- Modify: `packages/frontend/src/api/files.ts`
- Modify: `packages/frontend/src/app/files/pdf-collab.tsx`
- Modify: `packages/frontend/src/app/documents/upload-queue.ts`
- Modify: `packages/frontend/src/app/documents/document-list-utils.ts`
- Test: `packages/frontend/src/app/documents/__tests__/upload-queue.test.ts`
- Test: `packages/frontend/src/app/documents/__tests__/upload-queue-worker.test.ts`

**Interfaces:**
- Consumes: `assertFileIdAllowed` semantics (Task 2) — the frontend creates `image` docs with a `fileId`.
- Produces: `UploadKind` includes `"image"`; `uploadFile(file)` and `fileUrl(id, token?)` in `api/files.ts`; `getDocumentPath({type:"image"})` → `/f/:id`.

- [ ] **Step 1: Add `"image"` to `DocumentType`**

In `packages/frontend/src/types/documents.ts`:

```ts
export type DocumentType = "sheet" | "doc" | "slides" | "pdf" | "note" | "image";
```

- [ ] **Step 2: Update classify tests (png is now supported)**

Replace `packages/frontend/src/app/documents/__tests__/upload-kind.test.ts` body:

```ts
import { describe, it, expect } from "vitest";
import { classifyUploadKind } from "@/app/documents/upload-kind";

describe("classifyUploadKind", () => {
  it("maps supported extensions case-insensitively", () => {
    expect(classifyUploadKind("Budget.XLSX")).toBe("sheet");
    expect(classifyUploadKind("notes.docx")).toBe("doc");
    expect(classifyUploadKind("deck.pptx")).toBe("slides");
    expect(classifyUploadKind("report.pdf")).toBe("pdf");
  });
  it("maps image extensions to image", () => {
    expect(classifyUploadKind("photo.png")).toBe("image");
    expect(classifyUploadKind("pic.JPG")).toBe("image");
    expect(classifyUploadKind("pic.jpeg")).toBe("image");
    expect(classifyUploadKind("anim.gif")).toBe("image");
    expect(classifyUploadKind("shot.webp")).toBe("image");
  });
  it("returns null for unsupported types", () => {
    expect(classifyUploadKind("archive.zip")).toBeNull();
    expect(classifyUploadKind("vector.svg")).toBeNull();
    expect(classifyUploadKind("noext")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- upload-kind`
Expected: FAIL — `photo.png` is `null`, not `"image"`.

- [ ] **Step 4: Extend the classifier**

In `packages/frontend/src/app/documents/upload-kind.ts`:

```ts
export type UploadKind = "sheet" | "doc" | "slides" | "pdf" | "image";

export const SKIP_REASON = "Unsupported file type";

const EXT_TO_KIND: Record<string, UploadKind> = {
  xlsx: "sheet",
  docx: "doc",
  pptx: "slides",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
};
```

(Leave `classifyUploadKind` unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- upload-kind`
Expected: PASS.

- [ ] **Step 6: Generalize the file API**

In `packages/frontend/src/api/files.ts`, rename both exports to be type-agnostic (the endpoint already is):

```ts
import { fetchWithAuth } from "./auth";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

/** Upload a blob (pdf or image); returns the stored blob id. */
export async function uploadFile(file: File): Promise<{ id: string }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await fetchWithAuth(`${BACKEND_BASE}/files`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`File upload failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { id: string };
}

/** Document-scoped, permission-gated URL that streams the stored blob. */
export function fileUrl(documentId: string, token?: string): string {
  const base = `${BACKEND_BASE}/documents/${documentId}/file`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
```

- [ ] **Step 7: Update the pdf-collab import**

In `packages/frontend/src/app/files/pdf-collab.tsx`, line ~34 and ~136:

```ts
import { fileUrl } from '@/api/files.ts';
```
```ts
    fileUrl: fileUrl(documentId, token),
```

- [ ] **Step 8: Merge the pdf/image branch in the upload queue**

In `packages/frontend/src/app/documents/upload-queue.ts`:

Update the import (line 6):

```ts
import { uploadFile } from "@/api/files";
```

Rename the `UploadDeps` field and default (lines 150, 164):

```ts
  uploadFile: typeof uploadFile;
```
```ts
  uploadFile,
```

Replace the `else if (item.kind === "pdf") { ... }` block (lines 264-276) with a merged branch:

```ts
    } else if (item.kind === "pdf" || item.kind === "image") {
      patchItem(item.id, { status: "uploading" });
      const dot = item.fileName.lastIndexOf(".");
      const ext = dot >= 0 ? item.fileName.slice(dot + 1).toLowerCase() : "";
      const fallback = item.kind === "pdf" ? "Untitled PDF" : "Untitled Image";
      const title = stripExt(item.fileName, ext, fallback);
      // Upload the blob at most once per item: persist the returned fileId
      // immediately so a retry whose earlier failure was in createDoc reuses
      // the blob instead of orphaning it with a second upload.
      let fileId = item.fileId;
      if (!fileId) {
        ({ id: fileId } = await d.uploadFile(file));
        patchItem(item.id, { fileId });
      }
      const created = await getOrCreateDoc(item, {
        title,
        type: item.kind,
        fileId,
      });
      finish(item.id, created);
    }
```

- [ ] **Step 9: Route image to the file viewer**

In `packages/frontend/src/app/documents/document-list-utils.ts`, add a case in the `getDocumentPath` switch alongside `pdf`:

```ts
    case "pdf":
    case "image":
      return `/f/${doc.id}`;
```

- [ ] **Step 10: Fix the existing worker/queue tests**

In `packages/frontend/src/app/documents/__tests__/upload-queue.test.ts` (lines 12-16), swap the now-supported `.png` for an unsupported type:

```ts
    const items = q.enqueue([file("a.xlsx"), file("b.zip")], "ws1");
    expect(items.map((i) => i.status)).toEqual(["pending", "skipped"]);
```
(Keep the `reason` assertion referencing `items[1]`.)

In `packages/frontend/src/app/documents/__tests__/upload-queue-worker.test.ts`:

- Rename every `uploadPdf:` in the inline deps objects (lines 24, 64, 101, 150, 193, 237, 268, 312) to `uploadFile:`, and the two assertions `deps.uploadPdf` (lines 210, 222) to `deps.uploadFile`.
- In the "processes a mixed batch" test (line 33), the `b.png` file now uploads as an image. Update the batch and assertions:

```ts
    q.enqueue([file("a.xlsx"), file("b.png"), file("c.pdf")], "ws1");
```
```ts
    expect(snap.find((i) => i.fileName === "a.xlsx")?.status).toBe("done");
    expect(snap.find((i) => i.fileName === "c.pdf")?.status).toBe("done");
    expect(snap.find((i) => i.fileName === "b.png")?.status).toBe("done");
    // xlsx + png + pdf all create a document now.
    expect(deps.createDoc).toHaveBeenCalledTimes(3);
    // Content is applied only for the parsed sheet; the png and pdf store
    // their bytes server-side at create time.
    expect(deps.applyContent).toHaveBeenCalledTimes(1);
```

- Add a focused test that the image path uploads a blob and creates an `image` doc (place after the mixed-batch test):

```ts
  it("uploads an image blob and creates an image document", async () => {
    const deps = makeWorkerDeps();
    deps.uploadFile = vi.fn(async () => ({ id: "img-1" }));
    q.enqueue([file("cat.png")], "ws1");
    q.startUploads(undefined, deps as never);
    await flush();
    await flush();
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(deps.createDoc).toHaveBeenCalledWith(
      "ws1",
      expect.objectContaining({ type: "image", fileId: "img-1" }),
    );
    expect(deps.applyContent).not.toHaveBeenCalled();
  });
```

> If the file has no shared `makeWorkerDeps()` helper, copy the inline deps
> object shape used by the mixed-batch test (with `uploadFile` instead of
> `uploadPdf`) rather than referencing a helper that doesn't exist.

- [ ] **Step 11: Run the frontend queue tests**

Run: `pnpm --filter @wafflebase/frontend test -- upload-queue upload-kind`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/frontend/src/types/documents.ts \
  packages/frontend/src/app/documents/upload-kind.ts \
  packages/frontend/src/api/files.ts \
  packages/frontend/src/app/files/pdf-collab.tsx \
  packages/frontend/src/app/documents/upload-queue.ts \
  packages/frontend/src/app/documents/document-list-utils.ts \
  packages/frontend/src/app/documents/__tests__/
git commit -m "Route image uploads through the document queue"
```

---

## Task 4: Documents list — image filter, menu, and inline thumbnails

**Files:**
- Create: `packages/frontend/src/app/documents/image-thumb.tsx`
- Modify: `packages/frontend/src/app/documents/document-list.tsx`

**Interfaces:**
- Consumes: `fileUrl` (Task 3), `TYPE_META` shape, `classifyUploadKind` accept list.
- Produces: `ImageThumb({ documentId })` React component; `image` entry in `TYPE_META`/`TYPE_OPTIONS`; "Upload Image" New-menu item.

- [ ] **Step 1: Write the ImageThumb component**

Create `packages/frontend/src/app/documents/image-thumb.tsx`. It lazily fetches bytes only after the row scrolls into view (`IntersectionObserver`), builds an object URL, and revokes it on unmount. Falls back to the generic icon while loading or on error:

```tsx
import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { fetchWithAuth } from "@/api/auth";
import { fileUrl } from "@/api/files";

/**
 * Small inline thumbnail for an `image` document row. Client-side downscale
 * (no server thumbnails): the full blob is fetched — but only once the row is
 * scrolled into view — and the browser scales it into the fixed box. The
 * object URL is revoked on unmount to avoid leaks across list re-renders.
 */
export function ImageThumb({ documentId }: { documentId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetchWithAuth(fileUrl(documentId));
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    });
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);

  return (
    <div
      ref={ref}
      className="h-4 w-4 shrink-0 overflow-hidden rounded-sm bg-muted"
    >
      {src && !failed ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon className="h-4 w-4 text-pink-500" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the image type in the list**

In `packages/frontend/src/app/documents/document-list.tsx`:

Add the lucide import near the other icon imports:

```ts
import { Image as ImageIcon } from "lucide-react";
import { ImageThumb } from "./image-thumb";
```

Add the `image` entry to `TYPE_META`:

```ts
  image: { label: "Images", Icon: ImageIcon, color: "text-pink-500" },
```

Add `"image"` to `TYPE_OPTIONS` (after `"pdf"`):

```ts
const TYPE_OPTIONS: ReadonlyArray<DocumentType> = [
  "sheet",
  "doc",
  "note",
  "slides",
  "pdf",
  "image",
];
```

- [ ] **Step 3: Render the thumbnail in the title cell**

In the title cell (around line 256), swap the plain icon for the thumbnail when the row is an image:

```tsx
      cell: ({ row }) => {
        const { Icon, color } = TYPE_META[row.original.type];
        return (
          <div className="flex items-center gap-2">
            {row.original.type === "image" ? (
              <ImageThumb documentId={String(row.original.id)} />
            ) : (
              <Icon className={`h-4 w-4 shrink-0 ${color}`} />
            )}
            <span className="capitalize">{row.getValue("title")}</span>
```

(Leave the rest of the cell — presence avatars, etc. — unchanged.)

- [ ] **Step 4: Add the "Upload Image" New-menu item**

In `ImportMenuItems` (around line 222, after the Upload PDF item):

```tsx
        <DropdownMenuItem
          onClick={() => onImport(".png,.jpg,.jpeg,.gif,.webp")}
        >
          <ImageIcon className="mr-2 h-4 w-4 text-pink-500" />
          Upload Image
        </DropdownMenuItem>
```

- [ ] **Step 5: Verify lint + build**

Run: `pnpm --filter @wafflebase/frontend lint && pnpm --filter @wafflebase/frontend test`
Expected: PASS (no test asserts the exact menu list; TYPE_META now exhaustively covers `DocumentType`, satisfying the `Record<DocumentType, …>` type).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/documents/image-thumb.tsx \
  packages/frontend/src/app/documents/document-list.tsx
git commit -m "Show image type filter and inline row thumbnails"
```

---

## Task 5: Image viewer + `/f/:id` dispatch + prev/next

**Files:**
- Create: `packages/frontend/src/app/files/file-shell.tsx`
- Create: `packages/frontend/src/app/files/image-viewer.tsx`
- Modify: `packages/frontend/src/app/files/file-detail.tsx`

**Interfaces:**
- Consumes: `fetchDocument`, `fetchDocuments`, `fetchWorkspaces`, `fileUrl` (Task 3), existing `PdfCollabProvider`/`PdfHeaderActions`/`PdfCollabBody`.
- Produces: `FileShell` (shared sidebar/header), `ImageViewer` (viewer + nav); `FileDetail` dispatches by `doc.type`.

- [ ] **Step 1: Extract the shared shell**

Create `packages/frontend/src/app/files/file-shell.tsx` by lifting the sidebar/header/rename/workspace logic currently inline in `file-detail.tsx`'s `FileLayout`. It takes the header actions and body as props and does NOT own any Yorkie provider:

```tsx
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchDocument, renameDocument } from "@/api/documents";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { IconFolder, IconSettings, IconDatabase } from "@tabler/icons-react";

/**
 * Shared app shell for the `/f/:id` file routes (pdf + image). Owns the
 * sidebar, the editable title header, workspace nav, and the not-found
 * redirect. The Yorkie provider (if any) is supplied by the caller wrapping
 * this shell — image documents have none.
 */
export function FileShell({
  documentId,
  headerActions,
  children,
}: {
  documentId: string;
  headerActions: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: documentData, isError: isDocumentError } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
  });

  useEffect(() => {
    document.title = documentData?.title
      ? `${documentData.title} — Wafflebase`
      : "Wafflebase";
  }, [documentData?.title]);

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });

  const currentWorkspace = workspaces.find(
    (w) => w.id === documentData?.workspaceId,
  );
  const workspaceSlug = currentWorkspace?.slug;
  const fallbackSlug = workspaceSlug ?? workspaces[0]?.slug;

  useEffect(() => {
    if (isDocumentError) {
      toast.error("Document not found");
      navigate(fallbackSlug ? `/w/${fallbackSlug}` : "/documents", {
        replace: true,
      });
    }
  }, [isDocumentError, navigate, fallbackSlug]);

  const items = useMemo(() => {
    const base = workspaceSlug
      ? {
          docs: `/w/${workspaceSlug}`,
          data: `/w/${workspaceSlug}/datasources`,
          settings: `/w/${workspaceSlug}/settings`,
        }
      : { docs: "/documents", data: "/datasources", settings: "/settings" };
    return {
      main: [
        { title: "Documents", url: base.docs, icon: IconFolder },
        { title: "Data Sources", url: base.data, icon: IconDatabase },
        { title: "Settings", url: base.settings, icon: IconSettings },
      ],
      secondary: [],
    };
  }, [workspaceSlug]);

  const handleWorkspaceChange = useCallback(
    (slug: string) => navigate(`/w/${slug}`),
    [navigate],
  );

  const handleRenameDocument = useCallback(
    async (newTitle: string) => {
      try {
        await renameDocument(documentId, newTitle);
        queryClient.invalidateQueries({ queryKey: ["document", documentId] });
        queryClient.invalidateQueries({ queryKey: ["documents"] });
      } catch {
        toast.error("Failed to rename document");
      }
    },
    [documentId, queryClient],
  );

  return (
    <SidebarProvider>
      <AppSidebar
        variant="inset"
        items={items}
        workspaces={workspaces}
        currentWorkspace={currentWorkspace}
        onWorkspaceChange={handleWorkspaceChange}
      />
      <SidebarInset>
        <SiteHeader
          title={documentData?.title ?? "Loading..."}
          editable
          onRename={handleRenameDocument}
        >
          <div className="flex items-center gap-2">{headerActions}</div>
        </SiteHeader>
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 2: Write the image viewer with prev/next**

Create `packages/frontend/src/app/files/image-viewer.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/api/auth";
import { fetchDocument, fetchDocuments } from "@/api/documents";
import { fileUrl } from "@/api/files";

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

export function ImageViewer({ documentId }: { documentId: string }) {
  const navigate = useNavigate();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const downloadName = useRef<string>("image");

  // Load the current image bytes via the authed endpoint → object URL.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setError(false);
    setZoom(1);
    (async () => {
      try {
        const res = await fetchWithAuth(fileUrl(documentId));
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);

  const { data: current } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => fetchDocument(documentId),
    retry: false,
  });
  useEffect(() => {
    if (current?.title) downloadName.current = current.title;
  }, [current?.title]);

  // Sibling images in the same workspace, stably ordered, for prev/next.
  const { data: allDocs = [] } = useQuery({
    queryKey: ["documents"],
    queryFn: fetchDocuments,
  });
  const siblings = useMemo(() => {
    if (!current) return [] as string[];
    return allDocs
      .filter(
        (d) => d.type === "image" && d.workspaceId === current.workspaceId,
      )
      .sort((a, b) =>
        a.title === b.title
          ? String(a.id).localeCompare(String(b.id))
          : a.title.localeCompare(b.title),
      )
      .map((d) => String(d.id));
  }, [allDocs, current]);

  const index = siblings.indexOf(documentId);
  const prevId = index > 0 ? siblings[index - 1] : undefined;
  const nextId =
    index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;

  const go = useCallback(
    (id?: string) => id && navigate(`/f/${id}`),
    [navigate],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(prevId);
      else if (e.key === "ArrowRight") go(nextId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, prevId, nextId]);

  const download = useCallback(() => {
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = downloadName.current;
    a.click();
  }, [src]);

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-auto bg-muted/30">
      {error ? (
        <p className="text-sm text-muted-foreground">Failed to load image.</p>
      ) : src ? (
        <img
          src={src}
          alt={downloadName.current}
          style={{ transform: `scale(${zoom})` }}
          className="max-h-full max-w-full object-contain transition-transform"
        />
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {prevId && (
        <Button
          variant="secondary"
          size="icon"
          aria-label="Previous image"
          className="absolute left-4 top-1/2 -translate-y-1/2"
          onClick={() => go(prevId)}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      )}
      {nextId && (
        <Button
          variant="secondary"
          size="icon"
          aria-label="Next image"
          className="absolute right-4 top-1/2 -translate-y-1/2"
          onClick={() => go(nextId)}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      )}

      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-background p-1 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-12 text-center text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Download image"
          onClick={download}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Dispatch by type in FileDetail**

Rewrite `packages/frontend/src/app/files/file-detail.tsx` so `FileLayout` becomes two thin layouts selected by `doc.type`, both built on `FileShell`. The PDF layout keeps the `PdfCollabProvider`; the image layout has none:

```tsx
import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { fetchDocument } from "@/api/documents";
import { Loader } from "@/components/loader";
import { ShareDialog } from "@/components/share-dialog";
import { UserPresence } from "@/components/user-presence";
import type { User } from "@/types/users";
import { FileShell } from "./file-shell";
import { ImageViewer } from "./image-viewer";
import {
  PdfCollabProvider,
  PdfHeaderActions,
  PdfCollabBody,
} from "./pdf-collab";

function PdfFileLayout({
  documentId,
  currentUser,
}: {
  documentId: string;
  currentUser: User;
}) {
  return (
    <PdfCollabProvider
      documentId={documentId}
      readOnly={false}
      presenceUser={{
        userId: String(currentUser.id),
        username: currentUser.username,
        email: currentUser.email,
        photo: currentUser.photo,
      }}
    >
      <FileShell
        documentId={documentId}
        headerActions={
          <>
            <PdfHeaderActions />
            <ShareDialog documentId={documentId} />
            <UserPresence />
          </>
        }
      >
        <PdfCollabBody />
      </FileShell>
    </PdfCollabProvider>
  );
}

function ImageFileLayout({ documentId }: { documentId: string }) {
  return (
    <FileShell
      documentId={documentId}
      headerActions={<ShareDialog documentId={documentId} />}
    >
      <ImageViewer documentId={documentId} />
    </FileShell>
  );
}

/**
 * FileDetail is the `/f/:id` route shared by static blob documents. It
 * auth-gates on the current user, resolves the document `type`, then mounts
 * the matching layout: pdf → collaborative PDF (comments + presence over the
 * `pdf-<id>` Yorkie doc); image → a plain viewer with no Yorkie attachment.
 */
export function FileDetail() {
  const { id } = useParams();

  const {
    data: currentUser,
    isLoading: userLoading,
    isError: userError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const { data: documentData, isLoading: docLoading } = useQuery({
    queryKey: ["document", id],
    queryFn: () => fetchDocument(id!),
    retry: false,
    enabled: !!id,
  });

  if (userLoading || docLoading) return <Loader />;
  if (userError || !currentUser) return <Navigate to="/login" replace />;

  if (documentData?.type === "image") {
    return <ImageFileLayout documentId={id!} />;
  }
  return <PdfFileLayout documentId={id!} currentUser={currentUser} />;
}

export default FileDetail;
```

- [ ] **Step 4: Typecheck + lint + test**

Run: `pnpm --filter @wafflebase/frontend lint && pnpm --filter @wafflebase/frontend test`
Expected: PASS. (No unit test drives the viewer; it is covered by manual smoke below. If the repo has a route smoke test that mounts `FileDetail`, ensure it still renders the PDF path.)

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/files/
git commit -m "Add the image viewer with workspace prev/next navigation"
```

---

## Task 6: Full verify + manual smoke + finish

- [ ] **Step 1: Run the full fast gate**

Run: `pnpm verify:fast`
Expected: PASS (lint + all unit suites across packages).

- [ ] **Step 2: Manual smoke in `pnpm dev`**

Prereq: `docker compose up -d` (Postgres + Yorkie + MinIO). Then `pnpm dev`.

- Drop a mixed batch onto the documents list: a `.png`, a `.pdf`, an `.xlsx`, and a `.zip`. Confirm: png + pdf + xlsx land as their types, `.zip` is skipped with a reason in the upload panel.
- Confirm the list shows an inline thumbnail for the image row (scroll to force lazy load) and the "Images" filter chip works.
- Open the image (`/f/:id`): it renders, zoom in/out and download work, arrow keys ←/→ move between the workspace's images, and the chevrons hide at the ends.
- Confirm a PDF still opens with comments/presence (no regression from the FileDetail refactor).
- Try uploading a > 25 MB image → the upload panel row shows an error with the size reason; other items continue.

- [ ] **Step 3: Self-review the branch diff**

Dispatch a code review over the full branch diff (`/code-review` or `superpowers:requesting-code-review`). Apply blocking findings; note non-blocking ones as known limitations.

- [ ] **Step 4: Capture lessons + index**

Create `docs/tasks/active/20260719-image-viewer-lessons.md` with anything non-obvious found during implementation (e.g. the `.png`-as-skipped test coupling, the FileDetail provider-before-type ordering). Then:

```bash
pnpm tasks:index
git add docs/tasks/
git commit -m "Add image-viewer task lessons"
```

- [ ] **Step 5: Rebase, push, open PR**

```bash
git fetch && git rebase origin/main
git push -u origin image-documents
```
Open a PR titled `Add image documents (upload, viewer, thumbnails)` with a Summary + Test plan body. After merge, `pnpm tasks:archive && pnpm tasks:index`.

---

## Self-Review (author check against `docs/design/image-viewer.md`)

- **Data model** (image type, reuse `fileId`, widen `assertFileIdAllowed`, reserve `image-`) → Task 2. ✅
- **Storage & serving** (MIME_TO_EXT, per-category cap, id pattern, allow-list; serving unchanged) → Task 1. ✅
- **Upload flow** (classify, `uploadFile`, queue branch, `getDocumentPath`, Upload Image menu, TYPE_META) → Tasks 3 + 4. ✅
- **Viewer** (`/f/:id` dispatch, `ImageViewer` fetch→objectURL→`<img>`, fit/zoom/download, prev/next + keyboard) → Task 5. ✅
- **List thumbnails** (D1, IntersectionObserver lazy, client downscale, icon fallback) → Task 4. ✅
- **Non-goals** honored: no `image-<id>` Yorkie doc, no gallery/grid view, no server thumbnails, no SVG/HEIC. ✅
- **Regression guard**: existing `.png`-as-skipped tests updated (Task 3, Step 10). ✅
- Type consistency: `uploadFile`/`fileUrl` names used identically in Tasks 3 & 5; `assertFileIdAllowed(type, fileId)` signature identical in Task 2 def and controller call.
```
