# Generic File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept any file as a `"file"` document — a blob with no dedicated
viewer — so a workspace stores arbitrary files the way Google Drive does.

**Architecture:** `Document.type` is defined as a viewer-routing key, and
`"file"` joins it as "blob with no dedicated viewer". The upload allow-list is
removed; safety moves to the **serving** side, where the response
`Content-Type` is derived from the document type instead of echoed from
storage. Two nullable columns (`fileSize`, `mimeType`) carry the metadata the
list shows and a future quota would sum.

**Tech Stack:** NestJS 11 + Prisma 6 + `@aws-sdk/client-s3` (MinIO in dev);
React 19 + TanStack Query + Tailwind/shadcn; Jest (backend), Vitest (frontend).

**Design doc:** [`docs/design/generic-file-upload.md`](../../design/generic-file-upload.md)

## Global Constraints

- Single upload cap: **50 MB** for every type (`MAX_FILE_UPLOAD_BYTES`), except
  images which keep the tighter **25 MB** `MAX_IMAGE_UPLOAD_BYTES`. Do not
  change the Multer ceiling or introduce presigned uploads.
- The response `Content-Type` is **never** echoed from stored blob metadata.
  It is derived from the document `type` on every path.
- Client-supplied MIME and filename are untrusted. A filename extension enters
  an S3 key only through the `^[a-z0-9]{1,12}$` sanitizer.
- The `file-` Yorkie key prefix is **reserved only** — no task attaches a
  `file-<id>` document.
- No workspace quota, no new previews, no comments on `file` documents.
- Commit after every task with `pnpm verify:fast` green (project gate).
- Backend tests: `pnpm backend test`. Frontend tests: `pnpm frontend test`.
- **The frontend has no typecheck lane.** `pnpm frontend lint` is not
  type-aware and `vite build` uses esbuild, which strips types without
  checking them — so `verify:fast` stays green through type errors. Any task
  touching `packages/frontend` must additionally run:

  ```bash
  cd packages/frontend && npx tsc -p tsconfig.app.json --noEmit
  ```

  (`-p tsconfig.app.json` matters: a bare `tsc --noEmit` checks nothing,
  because the root tsconfig is `{"files": [], "references": [...]}`.) There are
  **151 pre-existing errors** in unrelated files; do not fix them. Compare
  against `.superpowers/sdd/20260806-generic-file-upload-todo/tsc-baseline.txt`
  and require that your change only removes lines, never adds them.

---

### Task 1: Widen the document type and consolidate the blob predicate

**Files:**
- Create: `packages/backend/prisma/migrations/20260806000000_add_document_file_metadata/migration.sql`
- Modify: `packages/backend/prisma/schema.prisma:41-63`
- Modify: `packages/backend/src/document/document.dto.ts:13-21`
- Modify: `packages/backend/src/document/document-file-id.util.ts` (whole file)
- Modify: `packages/backend/src/yorkie/yorkie-doc-key.ts:12-50`
- Modify: `packages/frontend/src/types/documents.ts:1`
- Modify: `packages/frontend/src/app/documents/document-list-utils.ts`
- Test: `packages/backend/src/document/document-file-id.util.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isBlobBacked(type: string | undefined): boolean` (backend, from
    `document-file-id.util.ts`)
  - `assertFileIdAllowed(type: string | undefined, fileId: string | undefined): void`
    (backend, now also extension-consistency checked)
  - `isBlobBacked(type: DocumentType | undefined): boolean` (frontend, from
    `document-list-utils.ts`)
  - `DocumentType` gains `"file"` on both sides; `Document` gains
    `fileSize?: number` and `mimeType?: string` (frontend type).

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/document/document-file-id.util.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { assertFileIdAllowed, isBlobBacked } from './document-file-id.util';

const UUID = '11111111-2222-3333-4444-555555555555';

describe('isBlobBacked', () => {
  it('is true for exactly the blob types', () => {
    expect(isBlobBacked('pdf')).toBe(true);
    expect(isBlobBacked('image')).toBe(true);
    expect(isBlobBacked('file')).toBe(true);
    expect(isBlobBacked('sheet')).toBe(false);
    expect(isBlobBacked('doc')).toBe(false);
    expect(isBlobBacked(undefined)).toBe(false);
  });
});

describe('assertFileIdAllowed', () => {
  it('allows no fileId on any type', () => {
    expect(() => assertFileIdAllowed('sheet', undefined)).not.toThrow();
    expect(() => assertFileIdAllowed('file', undefined)).not.toThrow();
  });

  it('rejects a fileId on a non-blob type', () => {
    expect(() => assertFileIdAllowed('sheet', `${UUID}.pdf`)).toThrow(
      BadRequestException,
    );
    expect(() => assertFileIdAllowed(undefined, `${UUID}.pdf`)).toThrow(
      BadRequestException,
    );
  });

  it('requires the extension to match the declared type', () => {
    expect(() => assertFileIdAllowed('pdf', `${UUID}.pdf`)).not.toThrow();
    expect(() => assertFileIdAllowed('pdf', `${UUID}.html`)).toThrow(
      BadRequestException,
    );
    expect(() => assertFileIdAllowed('pdf', `${UUID}.png`)).toThrow(
      BadRequestException,
    );
    expect(() => assertFileIdAllowed('image', `${UUID}.png`)).not.toThrow();
    expect(() => assertFileIdAllowed('image', `${UUID}.jpeg`)).not.toThrow();
    expect(() => assertFileIdAllowed('image', `${UUID}.pdf`)).toThrow(
      BadRequestException,
    );
  });

  it('accepts any extension, and none, on a file document', () => {
    expect(() => assertFileIdAllowed('file', `${UUID}.zip`)).not.toThrow();
    expect(() => assertFileIdAllowed('file', `${UUID}.html`)).not.toThrow();
    expect(() => assertFileIdAllowed('file', UUID)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- document-file-id.util.spec`
Expected: FAIL — `isBlobBacked` is not exported.

- [ ] **Step 3: Rewrite the util**

Replace the whole of `packages/backend/src/document/document-file-id.util.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * Extension rule per blob-backed document type. `null` means "any extension,
 * or none" — that is the whole point of the `file` type.
 *
 * This is the first of the two controls that keep uploaded active content from
 * ever being served inline: it prevents an `.html` blob from being attached to
 * a `pdf`/`image` document in the first place. The second is the derived
 * response Content-Type in `file-response.util.ts` — see
 * docs/design/generic-file-upload.md.
 */
const FILE_ID_EXT: Record<string, RegExp | null> = {
  pdf: /\.pdf$/i,
  image: /\.(png|jpe?g|gif|webp)$/i,
  file: null,
};

/** Whether documents of this type reference a stored blob via `fileId`. */
export function isBlobBacked(type: string | undefined): boolean {
  return type !== undefined && type in FILE_ID_EXT;
}

/**
 * Contract guard: only blob-backed documents carry a `fileId`, and the blob's
 * extension must agree with the declared type.
 */
export function assertFileIdAllowed(
  type: string | undefined,
  fileId: string | undefined,
): void {
  if (!fileId) return;
  const resolved = type ?? 'sheet';
  if (!isBlobBacked(resolved)) {
    throw new BadRequestException(
      'fileId is only allowed for pdf/image/file documents',
    );
  }
  const pattern = FILE_ID_EXT[resolved];
  if (pattern && !pattern.test(fileId)) {
    throw new BadRequestException(
      `fileId extension does not match a ${resolved} document`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- document-file-id.util.spec`
Expected: PASS

- [ ] **Step 5: Add the Prisma migration**

Add to `model Document` in `packages/backend/prisma/schema.prisma`, directly
below `fileId`:

```prisma
  // Blob metadata for file-backed documents (pdf/image/file); null for the
  // CRDT types. `fileSize` is also what a future workspace storage quota
  // would SUM — see docs/design/generic-file-upload.md.
  fileSize  Int?
  mimeType  String?
```

Create `packages/backend/prisma/migrations/20260806000000_add_document_file_metadata/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Document" ADD COLUMN "fileSize" INTEGER;
ALTER TABLE "Document" ADD COLUMN "mimeType" TEXT;
```

Run: `pnpm --filter @wafflebase/backend exec prisma generate`
Expected: client regenerates with the two fields.

- [ ] **Step 6: Widen the type enums**

In `packages/backend/src/document/document.dto.ts`, add `'file'` to
`DOCUMENT_TYPES` after `'board'`.

In `packages/backend/src/yorkie/yorkie-doc-key.ts`: add `| 'file'` to
`DocumentTypeLike`, `file: 'file-',` to `YORKIE_DOC_KEY_PREFIXES`, and to the
switch:

```ts
    case 'file':
      return YORKIE_DOC_KEY_PREFIXES.file;
```

Add a comment above the `file` prefix entry:

```ts
  // Reserved only — nothing attaches a `file-<id>` document. The prefix exists
  // so the "unknown type throws" guard never fires for a file document, and so
  // comments can be added later without a schema change.
```

In `packages/frontend/src/types/documents.ts`, widen the union and the
`Document` shape:

```ts
export type DocumentType =
  | "sheet"
  | "doc"
  | "slides"
  | "pdf"
  | "note"
  | "image"
  | "board"
  | "file";
```

and inside `export type Document = {` add:

```ts
  // Blob metadata, present only on file-backed documents (pdf/image/file).
  fileSize?: number;
  mimeType?: string;
```

- [ ] **Step 7: Add the frontend predicate**

Append to `packages/frontend/src/app/documents/document-list-utils.ts`:

```ts
/**
 * Whether this document's content is a stored blob rather than a CRDT — the
 * types that have a `fileId`, can be downloaded, and open at `/f/:id`.
 * Mirrors `isBlobBacked` in the backend's document-file-id.util.ts.
 */
export function isBlobBacked(type: DocumentType | undefined): boolean {
  return type === "pdf" || type === "image" || type === "file";
}
```

Add `"file"` to the `getDocumentPath` switch beside `"pdf"`/`"image"`:

```ts
    case "pdf":
    case "image":
    case "file":
      return `/f/${doc.id}`;
```

- [ ] **Step 8: Run the full gate**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/backend/prisma packages/backend/src/document packages/backend/src/yorkie/yorkie-doc-key.ts packages/frontend/src/types/documents.ts packages/frontend/src/app/documents/document-list-utils.ts
git commit -m "Add the file document type and one blob-backed predicate"
```

---

### Task 2: Accept any file at `POST /files`

**Files:**
- Create: `packages/backend/src/file/file-extension.util.ts`
- Create: `packages/backend/src/file/file-extension.util.spec.ts`
- Modify: `packages/backend/src/file/file.constants.ts`
- Modify: `packages/backend/src/file/file.config.ts:17-25`
- Modify: `packages/backend/src/file/file.service.ts:14-90`
- Modify: `packages/backend/src/file/file.controller.ts:13,29-37`
- Modify: `packages/backend/src/file/file.service.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `safeExtension(fileName: string): string | null`
  - `FileService.upload(file: Buffer, mimeType: string, originalName: string):
    Promise<{ id: string; size: number; mimeType: string }>`
  - `MAX_FILE_UPLOAD_BYTES` (replaces `MAX_PDF_UPLOAD_BYTES`)
  - widened `VALID_FILE_ID_PATTERN`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/file/file-extension.util.spec.ts`:

```ts
import { safeExtension } from './file-extension.util';

describe('safeExtension', () => {
  it('lowercases a normal extension', () => {
    expect(safeExtension('Report.PDF')).toBe('pdf');
    expect(safeExtension('archive.zip')).toBe('zip');
  });

  it('takes only the last segment', () => {
    expect(safeExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns null when there is no usable extension', () => {
    expect(safeExtension('Makefile')).toBeNull();
    expect(safeExtension('trailing.')).toBeNull();
  });

  it('rejects anything that is not short and alphanumeric', () => {
    // A path separator must never reach the S3 key.
    expect(safeExtension('../../etc/passwd')).toBeNull();
    expect(safeExtension('shell.php%00')).toBeNull();
    expect(safeExtension('a.' + 'x'.repeat(13))).toBeNull();
    expect(safeExtension('doc.한글')).toBeNull();
    expect(safeExtension('weird.ph p')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- file-extension.util.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the sanitizer**

Create `packages/backend/src/file/file-extension.util.ts`:

```ts
/**
 * The extension to store in a blob's S3 key, taken from the client-supplied
 * filename. That filename is untrusted input flowing into an object key, so
 * this sanitizes rather than validates: anything that is not a short
 * alphanumeric run is dropped and the blob is stored without an extension.
 * The uuid prefix means the key is never attacker-chosen either way.
 */
export function safeExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(ext) ? ext : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- file-extension.util.spec`
Expected: PASS

- [ ] **Step 5: Widen the constants**

Replace the top of `packages/backend/src/file/file.constants.ts`:

```ts
/**
 * A stored blob id: a uuid plus an optional sanitized extension (see
 * file-extension.util.ts). Any extension is allowed — the type↔extension
 * agreement is enforced per document type in document-file-id.util.ts.
 */
export const VALID_FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,12})?$/i;

/** Max upload size for any file (50 MB). Shared by Multer and FileService. */
export const MAX_FILE_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Max image upload size (25 MB). Enforced per-category in FileService. */
export const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
```

Update the three importers of the old name — `file.config.ts:2,17`,
`file.controller.ts:13,31`, `file.service.ts:12` — to `MAX_FILE_UPLOAD_BYTES`.

- [ ] **Step 6: Drop the MIME allow-list from config**

In `packages/backend/src/file/file.config.ts`, delete the `allowedMimeTypes`
array entirely and set:

```ts
  maxFileSizeBytes: MAX_FILE_UPLOAD_BYTES,
```

- [ ] **Step 7: Rewrite `FileService.upload`**

In `packages/backend/src/file/file.service.ts`: delete the `MIME_TO_EXT` map,
the `allowedMimeTypes` field, and its `constructor` assignment. Import
`safeExtension` from `./file-extension.util` and replace `upload`:

```ts
  /**
   * Store a blob. Accepts any content — the safety rule lives on the serving
   * side (see document/file-response.util.ts), not here, because an upload-time
   * extension blacklist is defeated by renaming.
   *
   * `mimeType` is client-supplied and untrusted. It is stored as data and used
   * only to pick which size cap applies; lying can at most widen the cap to
   * MAX_FILE_UPLOAD_BYTES, which Multer already enforces.
   */
  async upload(
    file: Buffer,
    mimeType: string,
    originalName: string,
  ): Promise<{ id: string; size: number; mimeType: string }> {
    const cap = mimeType.startsWith('image/')
      ? MAX_IMAGE_UPLOAD_BYTES
      : this.maxFileSize;
    if (file.length > cap) {
      throw new BadRequestException(
        `File too large (max ${cap / 1024 / 1024} MB)`,
      );
    }
    const contentType = mimeType || 'application/octet-stream';
    const ext = safeExtension(originalName);
    const id = ext ? `${randomUUID()}.${ext}` : randomUUID();
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: id,
        Body: file,
        ContentType: contentType,
      }),
    );
    return { id, size: file.length, mimeType: contentType };
  }
```

Leave `getObject` and `delete` unchanged, except `getObject`'s fallback
content type, which becomes neutral:

```ts
      contentType: response.ContentType || 'application/octet-stream',
```

- [ ] **Step 8: Forward the original filename from the controller**

In `packages/backend/src/file/file.controller.ts`, change the return to:

```ts
    return this.fileService.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
```

and widen the declared return type to
`Promise<{ id: string; size: number; mimeType: string }>`.

- [ ] **Step 9: Update the service spec**

In `packages/backend/src/file/file.service.spec.ts`: replace the
`'file.allowedMimeTypes'` config entry with nothing, pass a third
`originalname` argument at every `upload(...)` call site, and replace the
"rejects unsupported MIME" case with:

```ts
  it('stores an arbitrary file type', async () => {
    const result = await service.upload(
      Buffer.from('PK'),
      'application/zip',
      'archive.zip',
    );
    expect(result.id).toMatch(/\.zip$/);
    expect(result.size).toBe(4);
    expect(result.mimeType).toBe('application/zip');
  });

  it('stores a file with no usable extension without one', async () => {
    const result = await service.upload(
      Buffer.from('all:'),
      'text/plain',
      'Makefile',
    );
    expect(result.id).not.toContain('.');
  });
```

- [ ] **Step 10: Run the backend suite**

Run: `pnpm backend test`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add packages/backend/src/file
git commit -m "Store any uploaded file, sanitizing the extension into the key"
```

---

### Task 3: Derive the response Content-Type from the document type

**Files:**
- Create: `packages/backend/src/document/file-response.util.ts`
- Create: `packages/backend/src/document/file-response.util.spec.ts`
- Modify: `packages/backend/src/document/document-file.controller.ts:47-58`

**Interfaces:**
- Consumes: nothing (pure module; the controller wires it).
- Produces: `fileResponseHeaders(type: string, storedContentType: string,
  title: string): { contentType: string; disposition: string }`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/document/file-response.util.spec.ts`:

```ts
import { fileResponseHeaders } from './file-response.util';

describe('fileResponseHeaders', () => {
  it('pins a pdf document to application/pdf regardless of what is stored', () => {
    expect(fileResponseHeaders('pdf', 'text/html', 'report')).toEqual({
      contentType: 'application/pdf',
      disposition: 'inline',
    });
  });

  it('serves an image inline only for the four safe raster types', () => {
    expect(fileResponseHeaders('image', 'image/png', 'shot')).toEqual({
      contentType: 'image/png',
      disposition: 'inline',
    });
    // The adversarial case: a blob stored as html on an image document must
    // never render in the backend origin.
    expect(fileResponseHeaders('image', 'text/html', 'shot').contentType).toBe(
      'application/octet-stream',
    );
    expect(
      fileResponseHeaders('image', 'image/svg+xml', 'shot').disposition,
    ).toMatch(/^attachment/);
  });

  it('always serves a file document as an opaque attachment', () => {
    const headers = fileResponseHeaders('file', 'text/html', 'page');
    expect(headers.contentType).toBe('application/octet-stream');
    expect(headers.disposition).toBe("attachment; filename*=UTF-8''page");
  });

  it('encodes the filename so a crafted title cannot inject a header', () => {
    const headers = fileResponseHeaders(
      'file',
      'application/zip',
      'evil\r\nX-Injected: 1',
    );
    expect(headers.disposition).not.toContain('\r');
    expect(headers.disposition).not.toContain('\n');
  });

  it('percent-encodes non-ascii titles', () => {
    expect(fileResponseHeaders('file', 'application/zip', '보고서').disposition).toBe(
      "attachment; filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/backend test -- file-response.util.spec`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the util**

Create `packages/backend/src/document/file-response.util.ts`:

```ts
/** The only stored content types ever echoed back to a browser. */
const INLINE_IMAGE_MIME = /^image\/(png|jpeg|gif|webp)$/;

const OCTET_STREAM = 'application/octet-stream';

/**
 * Response headers for a document's stored blob, derived from the document
 * `type` — never echoed blindly from storage.
 *
 * Hosting arbitrary user bytes has one serious failure mode: content the
 * browser treats as active, rendered in the backend origin with the session
 * cookie in scope. `nosniff` does not help against an explicit `text/html`,
 * and an upload-time extension blacklist is defeated by renaming. So the
 * decision is made here, from server-held state: a `file` document is always
 * an opaque attachment, and the viewer types are pinned to what their viewer
 * can actually render.
 */
export function fileResponseHeaders(
  type: string,
  storedContentType: string,
  title: string,
): { contentType: string; disposition: string } {
  if (type === 'pdf') {
    return { contentType: 'application/pdf', disposition: 'inline' };
  }
  if (type === 'image' && INLINE_IMAGE_MIME.test(storedContentType)) {
    return { contentType: storedContentType, disposition: 'inline' };
  }
  return {
    contentType: OCTET_STREAM,
    disposition: `attachment; filename*=UTF-8''${encodeRfc5987(title)}`,
  };
}

/**
 * RFC 5987 `filename*` encoding. CR/LF are stripped before encoding as
 * defense in depth — `encodeURIComponent` would percent-encode them anyway,
 * but header safety should not rest on that detail.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value.replace(/[\r\n]/g, ' ')).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/backend test -- file-response.util.spec`
Expected: PASS

- [ ] **Step 5: Wire it into the controller**

In `packages/backend/src/document/document-file.controller.ts`, import
`fileResponseHeaders` from `./file-response.util` and replace the response
block at the end of `getDocumentFile`:

```ts
    const { body, contentType } = await this.fileService.getObject(doc.fileId);
    const headers = fileResponseHeaders(doc.type, contentType, doc.title);
    res.setHeader('Content-Type', headers.contentType);
    res.setHeader('Content-Disposition', headers.disposition);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(Buffer.from(body));
```

- [ ] **Step 6: Run the backend suite**

Run: `pnpm backend test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/document
git commit -m "Derive the blob response type from the document type"
```

---

### Task 4: Persist `fileSize` and `mimeType` on create

**Files:**
- Modify: `packages/backend/src/document/document.dto.ts` (both create DTOs)
- Modify: `packages/backend/src/document/document.controller.ts:120-135` and the
  workspace-scoped create beside it
- Modify: `packages/frontend/src/api/files.ts:6-16`
- Modify: `packages/frontend/src/api/documents.ts:9-13`
- Modify: `packages/frontend/src/api/workspaces.ts:276-284`

**Interfaces:**
- Consumes: `isBlobBacked` (Task 1), `FileService.upload`'s
  `{ id, size, mimeType }` (Task 2).
- Produces:
  - `uploadFile(file: File): Promise<{ id: string; size: number; mimeType: string }>`
    (frontend `api/files.ts`)
  - `createDocument` / `createWorkspaceDocument` payloads accept
    `fileSize?: number` and `mimeType?: string`.

- [ ] **Step 1: Add the DTO fields**

In `packages/backend/src/document/document.dto.ts`, import `IsInt` and `Min`
from `class-validator`, then add to **both** `CreateDocumentDto` and
`CreateDocumentInWorkspaceDto`, directly after their `fileId` field:

```ts
  // Blob metadata, accepted only alongside a fileId (the controller drops it
  // otherwise). Advisory display data — never a security decision.
  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  mimeType?: string;
```

- [ ] **Step 2: Thread them through both create paths**

In `packages/backend/src/document/document.controller.ts`, in each of the two
create handlers, after the existing `assertFileIdAllowed(body.type, body.fileId)`
call, build the metadata and spread it:

```ts
    // Blob metadata rides with the blob: without a fileId there is nothing for
    // it to describe, so it is dropped rather than trusted.
    const blobMeta = body.fileId
      ? { fileSize: body.fileSize, mimeType: body.mimeType }
      : {};
```

and add `...blobMeta,` to the object passed to
`this.documentService.createDocument({ ... })`.

- [ ] **Step 3: Return the upload metadata to the client**

In `packages/frontend/src/api/files.ts`, widen the return type:

```ts
/** Upload a blob; returns the stored blob id plus its recorded metadata. */
export async function uploadFile(
  file: File,
): Promise<{ id: string; size: number; mimeType: string }> {
```

and

```ts
  return (await res.json()) as { id: string; size: number; mimeType: string };
```

- [ ] **Step 4: Accept the fields in both create helpers**

In `packages/frontend/src/api/documents.ts`, extend the `createDocument`
payload type with `fileSize?: number;` and `mimeType?: string;`. Do the same
for the `data` parameter of `createWorkspaceDocument` in
`packages/frontend/src/api/workspaces.ts`.

- [ ] **Step 5: Verify the round trip by hand**

Run: `docker compose up -d && pnpm backend migrate && pnpm dev`
Then upload a PDF from the documents list and confirm in psql:

```sql
SELECT title, type, "fileId", "fileSize", "mimeType" FROM "Document"
ORDER BY "createdAt" DESC LIMIT 1;
```

Expected: `fileSize` and `mimeType` are populated for the new row.

- [ ] **Step 6: Run the gate**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/document packages/frontend/src/api
git commit -m "Record blob size and mime type on the document row"
```

---

### Task 5: Fall back to `file`, delete the skipped path, and upload it

**Files:**
- Modify: `packages/frontend/src/app/documents/upload-kind.ts` (whole file)
- Modify: `packages/frontend/src/app/documents/upload-queue.ts:1,12-49,75-99,162-166`
- Modify: `packages/frontend/src/app/documents/upload-panel.tsx:31-32,118`
- Modify: `packages/frontend/src/app/documents/__tests__/upload-kind.test.ts:18-22`
- Modify: `packages/frontend/src/app/documents/__tests__/upload-queue.test.ts:11-16,98-117`
- Modify: `packages/frontend/src/app/documents/__tests__/upload-panel.test.tsx` (drop skipped cases)
- Modify: `packages/frontend/src/app/documents/__tests__/upload-queue-worker.test.ts`

**Interfaces:**
- Consumes: `DocumentType` with `"file"` (Task 1); `uploadFile` returning
  `{ id, size, mimeType }` (Task 4).
- Produces:
  - `classifyUploadKind(fileName: string): UploadKind` — **no longer nullable**
  - `UploadKind` gains `"file"`; `UploadStatus` loses `"skipped"`;
    `UploadItem.kind` narrows to `UploadKind`
  - `SKIP_REASON` is deleted.
  - `UploadDeps["createDoc"]` payload gains `fileSize?` / `mimeType?`, and the
    worker's blob branch handles `pdf | image | file`.

- [ ] **Step 1: Rewrite the failing test**

Replace the third case in
`packages/frontend/src/app/documents/__tests__/upload-kind.test.ts`:

```ts
  it("falls back to file for anything else", () => {
    expect(classifyUploadKind("archive.zip")).toBe("file");
    expect(classifyUploadKind("vector.svg")).toBe("file");
    expect(classifyUploadKind("clip.mp4")).toBe("file");
    expect(classifyUploadKind("noext")).toBe("file");
    expect(classifyUploadKind("trailing.")).toBe("file");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- upload-kind`
Expected: FAIL — receives `null`.

- [ ] **Step 3: Rewrite `upload-kind.ts`**

```ts
/**
 * What a queued row produces — the document type the file becomes.
 *
 * `file` is the fallback for every extension without a richer handler: a blob
 * document with no dedicated viewer. It is a rule, not a stopgap — see
 * docs/design/generic-file-upload.md on `Document.type` as a viewer-routing
 * key. `board` is deliberately absent from `EXT_TO_KIND` because no file maps
 * to it; it exists for externally driven rows (`enqueueExternal`, today the
 * Miro import).
 */
export type UploadKind =
  | "sheet"
  | "doc"
  | "slides"
  | "pdf"
  | "image"
  | "board"
  | "file";

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

export function classifyUploadKind(fileName: string): UploadKind {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "file";
  const ext = fileName.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? "file";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- upload-kind`
Expected: PASS

- [ ] **Step 5: Remove `skipped` from the queue**

In `packages/frontend/src/app/documents/upload-queue.ts`:

Line 1 — drop `SKIP_REASON` from the import:

```ts
import { classifyUploadKind, type UploadKind } from "./upload-kind";
```

`UploadStatus` — delete the `| "skipped"` member.

`UploadItem` — narrow `kind: UploadKind | null;` to `kind: UploadKind;`.

`enqueue` — every file is now processable:

```ts
  const created: UploadItem[] = files.map((file) => ({
    id: `u${++seq}`,
    file,
    fileName: file.name,
    kind: classifyUploadKind(file.name),
    workspaceId,
    folderId,
    status: "pending",
    done: 0,
    total: 0,
  }));
```

`clearFinished` — only `done` is terminal-and-prunable now:

```ts
export function clearFinished(): void {
  replace(items.filter((it) => it.status !== "done"));
}
```

- [ ] **Step 6: Remove `skipped` from the panel**

In `packages/frontend/src/app/documents/upload-panel.tsx`, delete the two-line
`if (item.status === "skipped")` branch at :31, and drop the
`item.status === "skipped" ||` term from the condition at :118.

- [ ] **Step 7: Teach the worker the `file` kind**

This lands in the same task as the classify fallback on purpose: between the
two changes a dropped `.zip` would enqueue as `pending`, match no branch in the
worker's if/else chain, and sit there holding a concurrency slot forever. Tests
would still pass — the breakage is behavioural, so keep it out of the history.

Extend the `createDoc` payload type inside `UploadDeps` with the two metadata
fields Task 4 added to the API:

```ts
  createDoc: (
    workspaceId: string | undefined,
    payload: {
      title: string;
      type: DocumentType;
      fileId?: string;
      fileSize?: number;
      mimeType?: string;
      folderId?: string | null;
    },
  ) => Promise<Document>;
```

Then replace the blob branch (currently `else if (item.kind === "pdf" ||
item.kind === "image")`):

```ts
        } else if (
          item.kind === "pdf" ||
          item.kind === "image" ||
          item.kind === "file"
        ) {
          patchItem(item.id, { status: "uploading" });
          const dot = item.fileName.lastIndexOf(".");
          const ext = dot >= 0 ? item.fileName.slice(dot + 1).toLowerCase() : "";
          const fallback =
            item.kind === "pdf"
              ? "Untitled PDF"
              : item.kind === "image"
              ? "Untitled Image"
              : "Untitled File";
          const title = stripExt(item.fileName, ext, fallback);
          // Upload the blob at most once per item: persist the returned fileId
          // immediately so a retry whose earlier failure was in createDoc reuses
          // the blob instead of orphaning it with a second upload.
          let fileId = item.fileId;
          let size: number | undefined;
          let mimeType: string | undefined;
          if (!fileId) {
            const uploaded = await d.uploadFile(file);
            fileId = uploaded.id;
            size = uploaded.size;
            mimeType = uploaded.mimeType;
            patchItem(item.id, { fileId });
          }
          const created = await getOrCreateDoc(item, {
            title,
            type: item.kind,
            fileId,
            fileSize: size,
            mimeType,
          });
          finish(item.id, created);
        }
```

Note `stripExt(name, "", fallback)` for an extension-less file builds the
regex `\.$` which does not match, so the name passes through unchanged —
`Makefile` stays `Makefile`.

- [ ] **Step 8: Add the worker test**

In `packages/frontend/src/app/documents/__tests__/upload-queue-worker.test.ts`,
following the existing pdf case's structure, add:

```ts
  it("uploads an unknown extension as a file document", async () => {
    const uploadFile = vi.fn().mockResolvedValue({
      id: "blob-1.zip",
      size: 4096,
      mimeType: "application/zip",
    });
    const createDoc = vi
      .fn()
      .mockResolvedValue({ id: "doc-1", type: "file" } as never);
    q.__setDepsForTest({ ...baseDeps, uploadFile, createDoc });

    const [item] = q.enqueue([file("archive.zip")]);
    await q.runWorkerForTest();

    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(createDoc).toHaveBeenCalledWith(undefined, {
      title: "archive",
      type: "file",
      fileId: "blob-1.zip",
      fileSize: 4096,
      mimeType: "application/zip",
    });
    expect(q.getSnapshot().find((i) => i.id === item.id)?.status).toBe("done");
  });
```

Match the existing file's helper names (`baseDeps`, `file`,
`__setDepsForTest`, the worker-drain helper) — read the neighbouring pdf test
and mirror it exactly rather than inventing helpers.

- [ ] **Step 9: Update the queue tests**

In `packages/frontend/src/app/documents/__tests__/upload-queue.test.ts`,
replace the first case:

```ts
  it("enqueues every file as pending, including unknown types", () => {
    const items = q.enqueue([file("a.xlsx"), file("b.zip")]);
    expect(items.map((i) => i.status)).toEqual(["pending", "pending"]);
    expect(items.map((i) => i.kind)).toEqual(["sheet", "file"]);
    expect(items[1].reason).toBeUndefined();
  });
```

and rewrite the `clearFinished` case without the skipped row:

```ts
  it("clearFinished prunes done items but retains pending/in-flight/errored", () => {
    const [done, pending, uploading, errored] = q.enqueue([
      file("a.xlsx"),
      file("c.xlsx"),
      file("d.xlsx"),
      file("e.xlsx"),
    ]);
    q.patchItem(done.id, { status: "done" });
    q.patchItem(uploading.id, { status: "uploading" });
    q.patchItem(errored.id, { status: "error" });

    q.clearFinished();

    const remainingIds = q.getSnapshot().map((i) => i.id);
    expect(remainingIds).not.toContain(done.id);
    expect(remainingIds).toEqual(
      expect.arrayContaining([pending.id, uploading.id, errored.id]),
    );
  });
```

In `__tests__/upload-panel.test.tsx`, delete any case asserting the
"Unsupported" label and adjust fixtures that set `status: "skipped"` to
`"error"` with an explicit `reason`.

- [ ] **Step 10: Run the frontend suite**

Run: `pnpm frontend test`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add packages/frontend/src/app/documents
git commit -m "Upload any file as a file document instead of skipping it"
```

---

### Task 6: Guard the size, then list and pick generic files

**Files:**
- Modify: `packages/frontend/src/app/documents/upload-queue.ts:200-218,364-383`
- Modify: `packages/frontend/src/app/documents/document-list.tsx:168-187,262-290,883,1067`
- Modify: `packages/frontend/src/app/documents/__tests__/upload-queue-worker.test.ts`
- Create: `packages/frontend/src/app/documents/file-meta.ts`
- Create: `packages/frontend/src/app/documents/__tests__/file-meta.test.ts`

**Interfaces:**
- Consumes: `classifyUploadKind` returning `"file"` (Task 5), `uploadFile`
  returning `{ id, size, mimeType }` (Task 4), `isBlobBacked` (Task 1).
- Produces: `formatFileSize(bytes: number | undefined): string` and
  `uploadSizeError(kind: UploadKind, bytes: number): string | undefined` from
  `file-meta.ts`. `formatFileSize` is reused by Task 7's file card.

**Note on retry coverage:** the spec's "retry reuses the stored `fileId`" test
already exists for PDF at
`packages/frontend/src/app/documents/__tests__/upload-queue-worker.test.ts:377`,
and the `file` kind goes through the identical branch — no new test needed.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/app/documents/__tests__/file-meta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatFileSize } from "@/app/documents/file-meta";

describe("formatFileSize", () => {
  it("scales to the largest unit that keeps the number small", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("renders an em dash when the size is unknown", () => {
    expect(formatFileSize(undefined)).toBe("—");
  });
});

describe("uploadSizeError", () => {
  it("passes anything within the cap", () => {
    expect(uploadSizeError("file", 1024)).toBeUndefined();
    expect(uploadSizeError("image", 1024)).toBeUndefined();
  });

  it("holds images to the tighter cap", () => {
    expect(uploadSizeError("image", 30 * 1024 * 1024)).toBe(
      "File is larger than the 25 MB limit",
    );
    expect(uploadSizeError("file", 30 * 1024 * 1024)).toBeUndefined();
  });

  it("rejects anything past the shared cap", () => {
    expect(uploadSizeError("file", 51 * 1024 * 1024)).toBe(
      "File is larger than the 50 MB limit",
    );
  });
});
```

Import both from `@/app/documents/file-meta` at the top of the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- file-meta`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `packages/frontend/src/app/documents/file-meta.ts`:

```ts
const UNITS = ["B", "KB", "MB", "GB"] as const;

/**
 * Human-readable byte size for the documents list and the file card. Returns
 * an em dash for documents predating the `fileSize` column, which is why the
 * argument is optional rather than the callers each guarding.
 */
export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** Mirrors the backend caps in packages/backend/src/file/file.constants.ts. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Why this file cannot be uploaded, or undefined if it can.
 *
 * Checked at enqueue time so an over-cap file never goes over the wire — the
 * backend would reject it anyway, but only after the whole body was sent.
 * That was tolerable when uploads were capped-by-construction to a handful of
 * document formats; with arbitrary files accepted, a multi-gigabyte video
 * would otherwise be uploaded in full before failing.
 */
export function uploadSizeError(
  kind: UploadKind,
  bytes: number,
): string | undefined {
  const cap = kind === "image" ? MAX_IMAGE_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (bytes <= cap) return undefined;
  return `File is larger than the ${cap / 1024 / 1024} MB limit`;
}
```

Import `type UploadKind` from `./upload-kind` at the top of `file-meta.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- file-meta`
Expected: PASS

- [ ] **Step 5: Reject over-cap files at enqueue time**

In `packages/frontend/src/app/documents/upload-queue.ts`, import
`uploadSizeError` from `./file-meta` and re-do the `enqueue` body Task 5 wrote
so an over-cap file never reaches the worker:

```ts
  const created: UploadItem[] = files.map((file) => {
    const kind = classifyUploadKind(file.name);
    // Fail over-cap files here rather than after uploading the whole body.
    const reason = uploadSizeError(kind, file.size);
    return {
      id: `u${++seq}`,
      // An item that will never run should not pin its File blob in memory.
      file: reason ? undefined : file,
      fileName: file.name,
      kind,
      workspaceId,
      folderId,
      status: reason ? "error" : "pending",
      done: 0,
      total: 0,
      reason,
    };
  });
```

Dropping the `File` on an over-cap row is what makes retry safe: `isRetryable`
(`upload-queue.ts:436`) is already `item.file !== undefined`, so the panel hides
the retry control and `retry()` no-ops for these rows — no extra guard needed.
Its trailing hint ("— start the import again to retry.") reads acceptably for
an over-cap file; leave it.

The worker branch itself already handles `file` — Task 5 Step 7 added it.

- [ ] **Step 6: Add the enqueue guard test**

In `packages/frontend/src/app/documents/__tests__/upload-queue.test.ts`, add
beside the other enqueue cases (match the existing `file(name)` helper, which
builds a `File`; give it an explicit size — check how the helper is defined and
extend it with a size argument if it does not take one):

```ts
  it("fails an over-cap file at enqueue time without pinning its blob", () => {
    const [item] = q.enqueue([file("huge.zip", 60 * 1024 * 1024)]);
    expect(item.status).toBe("error");
    expect(item.reason).toBe("File is larger than the 50 MB limit");
    expect(item.file).toBeUndefined();
    expect(q.isRetryable(item)).toBe(false);
  });
```

- [ ] **Step 7: Run the queue tests**

Run: `pnpm --filter @wafflebase/frontend test -- upload-queue`
Expected: PASS

- [ ] **Step 8: Add the download action to blob rows**

`TYPE_META` and `TYPE_OPTIONS` already carry their `file` entry — Task 1 had to
add it, because `TYPE_META` is a `Record<DocumentType, …>` and widening the
union without it is a type error *and* a crash on the first `file` row. Do not
re-add them; verify they are present and move on.

In `packages/frontend/src/app/documents/document-list.tsx`:

Import `isBlobBacked` from `./document-list-utils` and replace both scattered
comparisons:

```ts
              {isBlobBacked(doc.type) && (
```

at :883, and in the bulk-download selection at :1067:

```ts
      isBlobBacked(d.type),
```

- [ ] **Step 9: Add the "File upload" menu item**

In `ImportMenuItems`, after the "Upload Image" item:

```ts
      <DropdownMenuItem onClick={() => onImport("")}>
        <FileIcon className="mr-2 h-4 w-4 text-slate-500" />
        File upload
      </DropdownMenuItem>
```

An empty `accept` leaves the picker unfiltered — `pickFiles` assigns it to
`input.accept` verbatim and `""` is the browser's "any file" default.

- [ ] **Step 10: Run the gate**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add packages/frontend/src/app/documents
git commit -m "Upload, list, and pick files of any type"
```

---

### Task 7: The generic file viewer at `/f/:id`

**Files:**
- Create: `packages/frontend/src/app/files/generic-file-view.tsx`
- Modify: `packages/frontend/src/app/files/file-detail.tsx:96-183`
- Test: `packages/frontend/src/app/files/__tests__/generic-file-view.test.tsx` (create)

**Interfaces:**
- Consumes: `formatFileSize` (Task 6), `fileSize`/`mimeType` on `Document`
  (Task 1), the download button already in `file-detail.tsx`.
- Produces: `GenericFileView` — a presentational component taking
  `{ title: string; fileId?: string; fileSize?: number; createdAt?: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/app/files/__tests__/generic-file-view.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GenericFileView } from "@/app/files/generic-file-view";

describe("GenericFileView", () => {
  it("shows the extension, name and size", () => {
    render(
      <GenericFileView
        title="quarterly-report"
        fileId="11111111-2222-3333-4444-555555555555.zip"
        fileSize={2048}
      />,
    );
    expect(screen.getByText("quarterly-report")).toBeInTheDocument();
    expect(screen.getByText("ZIP")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("degrades when there is no extension or size", () => {
    render(
      <GenericFileView
        title="Makefile"
        fileId="11111111-2222-3333-4444-555555555555"
      />,
    );
    expect(screen.getByText("Makefile")).toBeInTheDocument();
    expect(screen.getByText("FILE")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- generic-file-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the view**

Create `packages/frontend/src/app/files/generic-file-view.tsx`:

```tsx
import { File as FileIcon } from "lucide-react";
import { formatFileSize } from "@/app/documents/file-meta";
import { formatRelativeTime } from "@/app/documents/document-list-utils";

/**
 * The body of a `file` document — a blob with no dedicated viewer. Deliberately
 * static: the download control lives in the shell header beside Share, matching
 * the image layout, so this stays presentational and testable without a router
 * or query client.
 */
export function GenericFileView({
  title,
  fileId,
  fileSize,
  createdAt,
}: {
  title: string;
  fileId?: string;
  fileSize?: number;
  createdAt?: string;
}) {
  const ext = fileId?.includes(".")
    ? (fileId.split(".").pop() as string).toUpperCase()
    : "FILE";

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border bg-background p-8 text-center">
        <div className="relative">
          <FileIcon className="h-20 w-20 text-slate-400" strokeWidth={1} />
          <span className="absolute inset-x-0 bottom-4 text-[10px] font-semibold tracking-wider text-slate-600">
            {ext}
          </span>
        </div>
        <div className="min-w-0 w-full">
          <p className="truncate font-medium" title={title}>
            {title}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatFileSize(fileSize)}
            {createdAt ? ` · ${formatRelativeTime(createdAt)}` : ""}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          No preview available. Use Download in the header to save this file.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- generic-file-view`
Expected: PASS

- [ ] **Step 5: Route the third layout**

In `packages/frontend/src/app/files/file-detail.tsx`, add the layout beside
`ImageFileLayout`:

```tsx
function GenericFileLayout({
  documentId,
  title,
  fileId,
  fileSize,
  createdAt,
}: {
  documentId: string;
  title: string;
  fileId?: string;
  fileSize?: number;
  createdAt?: string;
}) {
  return (
    <FileShell
      documentId={documentId}
      headerActions={
        <>
          <DownloadFileButton
            documentId={documentId}
            title={title}
            fileId={fileId}
            label="Download file"
          />
          <ShareDialog documentId={documentId} />
        </>
      }
    >
      <GenericFileView
        title={title}
        fileId={fileId}
        fileSize={fileSize}
        createdAt={createdAt}
      />
    </FileShell>
  );
}
```

Import `GenericFileView` from `./generic-file-view`, and add the branch in
`FileDetail` immediately after the `image` branch (before the `pdf` fallthrough,
so `pdf` stays the only default and no unknown type ever mounts a Yorkie
document):

```tsx
  if (documentData.type === "file") {
    return (
      <GenericFileLayout
        documentId={id!}
        title={documentData.title}
        fileId={documentData.fileId}
        fileSize={documentData.fileSize}
        createdAt={documentData.createdAt}
      />
    );
  }
```

Update the `FileDetail` doc comment to name the three layouts.

- [ ] **Step 6: Run the gate**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/app/files
git commit -m "Show a file card for blob documents with no viewer"
```

---

### Task 8: Fix blob share links (image today, file now)

**Files:**
- Modify: `packages/frontend/src/api/share-links.ts:14-19`
- Modify: `packages/frontend/src/app/shared/shared-document.tsx:717-760`
- Test: `packages/frontend/src/app/shared/__tests__/shared-blob-routing.test.ts` (create)

**Interfaces:**
- Consumes: `isBlobBacked` (Task 1), `GenericFileView` (Task 7), the existing
  `ImageViewer`.
- Produces: `sharedBlobKind(type: string): "pdf" | "blob" | "crdt"` — the pure
  routing decision, exported from `shared-document.tsx` for the test.

**Context:** `GET /share-links/:token` returns `link.document.type` verbatim
(`packages/backend/src/share-link/share-link.controller.ts:74`), so `image`
and `file` already arrive at the client. The frontend union omits `image`, and
the `docKey` ternary falls through to `sheet-${id}` — so an image share link
mounts a spreadsheet today. This task closes that.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/app/shared/__tests__/shared-blob-routing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sharedBlobKind } from "@/app/shared/shared-document";

describe("sharedBlobKind", () => {
  it("routes pdf to its collaborative layout", () => {
    expect(sharedBlobKind("pdf")).toBe("pdf");
  });

  it("routes the viewer-less blob types away from any Yorkie document", () => {
    // Regression: both used to fall through to the `sheet-<id>` fallback and
    // render an empty spreadsheet.
    expect(sharedBlobKind("image")).toBe("blob");
    expect(sharedBlobKind("file")).toBe("blob");
  });

  it("leaves the CRDT types alone", () => {
    for (const type of ["sheet", "doc", "slides", "note", "board"]) {
      expect(sharedBlobKind(type)).toBe("crdt");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- shared-blob-routing`
Expected: FAIL — `sharedBlobKind` is not exported.

- [ ] **Step 3: Widen the resolved-share type**

In `packages/frontend/src/api/share-links.ts`:

```ts
export type ResolvedShareLink = {
  documentId: string;
  role: string;
  title: string;
  type:
    | "sheet"
    | "doc"
    | "slides"
    | "pdf"
    | "note"
    | "board"
    | "image"
    | "file";
};
```

- [ ] **Step 4: Add the routing helper and the blob layout**

In `packages/frontend/src/app/shared/shared-document.tsx`, above
`SharedDocumentInner`:

```ts
/**
 * How a shared document should be mounted.
 *
 * `pdf` has its own Yorkie-backed layout (comments + presence). `image` and
 * `file` are blobs with no CRDT at all, so they must mount NO Yorkie document
 * — before this existed they matched no branch and fell through to the
 * `sheet-<id>` fallback, rendering an empty spreadsheet over a real image.
 */
export function sharedBlobKind(type: string): "pdf" | "blob" | "crdt" {
  if (type === "pdf") return "pdf";
  if (type === "image" || type === "file") return "blob";
  return "crdt";
}
```

Add the layout beside `SharedPdfLayout`:

```tsx
/**
 * Shared layout for blob documents with no CRDT: rendered outside the
 * YorkieProvider entirely, since there is nothing to attach.
 */
function SharedBlobLayout({
  resolved,
  token,
}: {
  resolved: ResolvedShareLink;
  token?: string;
}) {
  return (
    <div className="flex h-svh flex-col">
      <div className="flex h-12 shrink-0 items-center border-b px-4 font-medium">
        {resolved.title}
      </div>
      {resolved.type === "image" ? (
        <ImageViewer documentId={resolved.documentId} token={token} />
      ) : (
        <GenericFileView title={resolved.title} />
      )}
    </div>
  );
}
```

`ImageViewer` currently takes only `documentId`; add an optional `token`
prop that it forwards to `fileUrl(documentId, token)` so an anonymous viewer
can fetch the bytes (`fileUrl` already accepts a token —
`packages/frontend/src/api/files.ts:19`). Its workspace prev/next navigation
calls an authed documents endpoint, so gate that on `!token` — a share viewer
sees the image without the arrows rather than a failed request.

- [ ] **Step 5: Branch before the Yorkie provider**

Replace the existing `if (resolved.type === "pdf")` early return with:

```tsx
  const kind = sharedBlobKind(resolved.type);
  if (kind === "pdf") {
    return (
      <SharedPdfLayout
        resolved={resolved}
        token={token}
        presenceUser={{
          userId: currentUser?.id != null ? String(currentUser.id) : anonUserId,
          username: currentUser?.username || "Anonymous",
          email: currentUser?.email || "",
          photo: currentUser?.photo || "",
        }}
      />
    );
  }
  if (kind === "blob") {
    return <SharedBlobLayout resolved={resolved} token={token} />;
  }
```

Keep the existing comment about mounting before the shared provider wrapper —
it now covers both early returns.

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @wafflebase/frontend test -- shared-blob-routing`
Expected: PASS

- [ ] **Step 7: Smoke both share paths by hand**

Run: `pnpm dev`. Upload a `.png` and a `.zip`, open each, create a view-only
share link from the header, and open both links in a private window.
Expected: the image renders in the image viewer, the zip shows the file card,
and neither shows a spreadsheet grid.

- [ ] **Step 8: Run the gate**

Run: `pnpm verify:fast`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/api/share-links.ts packages/frontend/src/app/shared packages/frontend/src/app/files
git commit -m "Route shared blob documents away from the spreadsheet fallback"
```

---

## Wrap-up

- [ ] Update `packages/backend/README.md`: the `Document` schema table gains
  `fileSize` / `mimeType`, and the `type` row's enum gains `file`.
- [ ] Record lessons in
  `docs/tasks/active/20260806-generic-file-upload-lessons.md`.
- [ ] Run `pnpm verify:self` before pushing (the pre-push hook runs it anyway).
- [ ] Open the PR: title ≤70 chars, body = Summary + Test plan.
- [ ] Dispatch a code review over the full branch diff before merge
      (`superpowers:requesting-code-review` or `/code-review`).

## Review

All 8 tasks implemented and reviewed (18 commits). Each task got a scoped
review; the branch then got a whole-branch review, which blocked on five
defects that the per-task reviews structurally could not see. All five were
fixed and re-reviewed clean.

**Plan corrections made during execution:**

- The `file` classify fallback (Task 5) and the worker branch that handles it
  (originally Task 6) were merged into one task — split, the intermediate
  commit left a dropped `.zip` enqueued forever holding a concurrency slot,
  with the suite green.
- The `TYPE_META`/`TYPE_OPTIONS` `file` entry moved from Task 6 to Task 1.
  `TYPE_META` is a `Record<DocumentType, …>`, so widening the union without it
  was both a type error and a runtime crash of the whole documents list.
- Global Constraints gained the frontend typecheck requirement (below).
- Task 4's manual DB round-trip and Task 8's browser smoke were replaced or
  skipped — no database was available. The substitutes cover the units, not
  the flow; **the end-to-end flow remains unverified by hand.**

**Blocking findings from the whole-branch review, all fixed:**

1. Download filename broken in all three paths — `download-file.ts` returned
   the whole uuid for an extension-less key, `document-list.tsx` dropped the
   `fileId` it had, and the server-side `filename*` used the extension-less
   title.
2. `stripExt` built a `RegExp` from the filename extension — `main.c++` threw
   "Nothing to repeat" and the raw error became the user-facing reason.
3. `fileSize`/`mimeType` were lost on every retry and 429 re-entry.
4. The controller's security wiring was untested — both existing cases used a
   fixed point of the old and new behaviour.
5. Dropping the MIME allow-list armed the unauthenticated `GET /images/:id`
   ContentType echo; that route now derives its type from the id's extension.

**Known limitations (reviewed, consciously deferred):**

- `formatFileSize` shows `"1024.0 KB"` one byte under 1 MB — the unit-promotion
  check runs before rounding.
- The frontend size guard picks its cap from the extension, the backend from
  the MIME, so an image with an unrecognized extension still crosses the wire
  before failing. Both ends still enforce.
- `sharedBlobKind` is a third hand-rolled copy of "is this a blob type",
  alongside the backend `in`-map and the frontend `||`-chain.
- Backend `isBlobBacked` uses `in` against an object literal, so
  `isBlobBacked('constructor')` is `true`. Unreachable over HTTP (the
  `ValidationPipe` + `@IsIn` gate it); `Object.hasOwn` would fix it.
- `SharedBlobLayout` shows no size/extension/date — `ResolvedShareLink` cannot
  supply them without a new share-resolve field.
- The documents list has no size column, so `fileSize` is currently only shown
  on the file card.
- No test covers `image-viewer.tsx`'s `token` forwarding or `enabled: !token`.

**Not fixed, outside this branch:** `packages/frontend` has no typecheck lane.
`pnpm frontend lint` is not type-aware and `vite build` strips types, so
`verify:fast` is green through type errors — `tsc -p tsconfig.app.json` reports
146 pre-existing errors. This branch adds none and clears five. Adding a
`typecheck` script, clearing the backlog, and wiring it into `verify:fast`
deserves its own task.
