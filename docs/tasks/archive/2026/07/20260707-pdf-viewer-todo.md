# PDF Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static `"pdf"` document type — upload a PDF from the documents list, store the original in S3/MinIO, and view it in a pdf.js viewer at `/f/:id`, with serving gated by the document's read policy.

**Architecture:** PDF is the fourth document type but, unlike sheet/doc/slides, has **no Yorkie CRDT** — the original file lives as an S3 blob and the Postgres `Document.fileId` references it. Upload is a new `POST /files` blob endpoint; serving is document-scoped (`GET /documents/:id/file`) reusing the existing JWT + workspace-membership check. The viewer lazy-imports `pdfjs-dist` so it never enters the main bundle. The `pdf-` Yorkie key prefix is reserved (unused in Phase 1) for Phase 2 comments/presence.

**Tech Stack:** NestJS + Prisma + `@aws-sdk/client-s3` (backend), React + react-query + `pdfjs-dist` (frontend), MinIO (dev blob store).

**Design doc:** `docs/design/pdf.md`

## Global Constraints

- Document type string is free-form in Postgres (`Document.type String @default("sheet")`); the value is gated only by the app-layer unions — backend `packages/backend/src/document/document.dto.ts:3` `DOCUMENT_TYPES` and frontend `packages/frontend/src/types/documents.ts:1` `DocumentType`. Both must include `"pdf"`.
- Any new document type MUST be registered in `packages/backend/src/yorkie/yorkie-doc-key.ts` or `yorkieDocKeyPrefix` throws at request time (the documents-list `attachMeta` derives a key for every row).
- File serving is **permission-gated** (JWT + `workspaceService.assertMember`) — never public/immutable like `/images/:id`. Response cache is `private`.
- `pdfjs-dist` MUST be dynamically imported inside the viewer only, so it stays a separate chunk and does not trip the frontend chunk gate (`harness.config.json`, `FRONTEND_CHUNK_LIMIT_KB` / `FRONTEND_CHUNK_COUNT_LIMIT`).
- PDF upload cap: **50 MB**, MIME **`application/pdf`** only.
- Each task ends green on `pnpm verify:fast`. Commit per task. Feature branch off `main` — no direct push.

---

## Task 0: Create the feature branch

- [x] **Step 1: Branch from an up-to-date main**

```bash
git fetch origin
git switch -c pdf-viewer origin/main
```

---

## Task 1: Backend — data model (`fileId` column, `"pdf"` type, Yorkie prefix)

**Files:**
- Create: `packages/backend/prisma/migrations/20260707000000_add_document_file_id/migration.sql`
- Modify: `packages/backend/prisma/schema.prisma:40-50` (Document model)
- Modify: `packages/backend/src/document/document.dto.ts`
- Modify: `packages/backend/src/yorkie/yorkie-doc-key.ts`
- Modify: `packages/backend/src/document/document.controller.ts` (persist `fileId` on create)
- Test: `packages/backend/src/yorkie/yorkie-doc-key.spec.ts`

**Interfaces:**
- Produces: `yorkieDocKeyPrefix('pdf') === 'pdf-'`; `CreateDocumentDto`/`CreateDocumentInWorkspaceDto` accept optional `fileId?: string`; `Document.fileId` persisted on create.

- [x] **Step 1: Write the failing test for the reserved Yorkie prefix**

Create `packages/backend/src/yorkie/yorkie-doc-key.spec.ts`:

```ts
import { yorkieDocKeyPrefix, yorkieDocKey } from './yorkie-doc-key';

describe('yorkie-doc-key', () => {
  it('maps each known type to its prefix', () => {
    expect(yorkieDocKeyPrefix('sheet')).toBe('sheet-');
    expect(yorkieDocKeyPrefix('doc')).toBe('doc-');
    expect(yorkieDocKeyPrefix('slides')).toBe('slides-');
  });

  it('reserves the pdf prefix (Phase 1: registered but unused)', () => {
    expect(yorkieDocKeyPrefix('pdf')).toBe('pdf-');
    expect(yorkieDocKey('pdf', 'abc')).toBe('pdf-abc');
  });

  it('throws for unknown types', () => {
    expect(() => yorkieDocKeyPrefix('bogus')).toThrow('Unknown document type');
  });
});
```

- [x] **Step 2: Run it and confirm the pdf case fails**

Run: `pnpm --filter @wafflebase/backend test yorkie-doc-key`
Expected: FAIL — `yorkieDocKeyPrefix('pdf')` throws "Unknown document type: pdf".

- [x] **Step 3: Register the `pdf` prefix**

In `packages/backend/src/yorkie/yorkie-doc-key.ts`:

```ts
export type DocumentTypeLike = 'sheet' | 'doc' | 'slides' | 'pdf';

export const YORKIE_DOC_KEY_PREFIXES = {
  sheet: 'sheet-',
  doc: 'doc-',
  slides: 'slides-',
  pdf: 'pdf-',
} as const;

export function yorkieDocKeyPrefix(type: string): string {
  switch (type) {
    case 'sheet':
      return YORKIE_DOC_KEY_PREFIXES.sheet;
    case 'doc':
      return YORKIE_DOC_KEY_PREFIXES.doc;
    case 'slides':
      return YORKIE_DOC_KEY_PREFIXES.slides;
    case 'pdf':
      return YORKIE_DOC_KEY_PREFIXES.pdf;
    default:
      throw new Error(`Unknown document type: ${type}`);
  }
}
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @wafflebase/backend test yorkie-doc-key`
Expected: PASS.

- [x] **Step 5: Add `"pdf"` to the DTO type list and add optional `fileId`**

In `packages/backend/src/document/document.dto.ts`:

```ts
const DOCUMENT_TYPES = ['sheet', 'doc', 'slides', 'pdf'] as const;
```

Add to **both** `CreateDocumentDto` and `CreateDocumentInWorkspaceDto`:

```ts
  @IsOptional()
  @IsString()
  @Length(1, 200)
  fileId?: string;
```

- [x] **Step 6: Add the `fileId` column to the Prisma model**

In `packages/backend/prisma/schema.prisma`, add to the `Document` model:

```prisma
  fileId    String?
```

- [x] **Step 7: Write the migration SQL**

Create `packages/backend/prisma/migrations/20260707000000_add_document_file_id/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Document" ADD COLUMN "fileId" TEXT;
```

- [x] **Step 8: Persist `fileId` on document creation**

In `packages/backend/src/document/document.controller.ts`, in both `createInWorkspace` and `createDocument`, add `fileId` to the `createDocument` data:

```ts
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
      fileId: body.fileId,
      author: { connect: { id: userId } },
      workspace: { connect: { id: workspaceId } }, // (or body.workspaceId)
    });
```

- [x] **Step 9: Regenerate the Prisma client and apply the migration**

Run:
```bash
docker compose up -d
pnpm --filter @wafflebase/backend exec prisma generate
pnpm --filter @wafflebase/backend exec prisma migrate deploy
```
Expected: migration `20260707000000_add_document_file_id` applied; `prisma generate` succeeds so `fileId` is on the `Document` type.

- [x] **Step 10: Verify and commit**

Run: `pnpm --filter @wafflebase/backend test yorkie-doc-key && pnpm --filter @wafflebase/backend build`
Expected: PASS + build succeeds.

```bash
git add packages/backend/prisma packages/backend/src/document packages/backend/src/yorkie
git commit -m "feat: add pdf document type and Document.fileId"
```

---

## Task 2: Backend — `FileService` blob storage (PDF-only, 50 MB)

**Files:**
- Create: `packages/backend/src/file/file.config.ts`
- Create: `packages/backend/src/file/file.constants.ts`
- Create: `packages/backend/src/file/file.service.ts`
- Test: `packages/backend/src/file/file.service.spec.ts`

**Interfaces:**
- Produces: `FileService.upload(buffer, mimeType, originalName): Promise<{ id: string }>` (rejects non-`application/pdf`, rejects > 50 MB); `FileService.getObject(id): Promise<{ body: Uint8Array; contentType: string }>`; `FileService.delete(id): Promise<void>`. `VALID_FILE_ID_PATTERN` matches `<uuid>.pdf`.

- [x] **Step 1: Write the failing validation tests**

Create `packages/backend/src/file/file.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileService } from './file.service';

function makeService(): FileService {
  const values: Record<string, unknown> = {
    'file.endpoint': 'http://localhost:9000',
    'file.region': 'us-east-1',
    'file.accessKey': 'minioadmin',
    'file.secretKey': 'minioadmin',
    'file.bucket': 'wafflebase-files',
    'file.maxFileSizeBytes': 50 * 1024 * 1024,
    'file.allowedMimeTypes': ['application/pdf'],
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  return new FileService(config);
}

describe('FileService.upload validation', () => {
  it('rejects a non-pdf mime type', async () => {
    const svc = makeService();
    await expect(
      svc.upload(Buffer.from('x'), 'image/png', 'x.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file over the size cap', async () => {
    const svc = makeService();
    const tooBig = Buffer.alloc(50 * 1024 * 1024 + 1);
    await expect(
      svc.upload(tooBig, 'application/pdf', 'big.pdf'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [x] **Step 2: Run and confirm it fails to compile (no FileService yet)**

Run: `pnpm --filter @wafflebase/backend test file.service`
Expected: FAIL — cannot find `./file.service`.

- [x] **Step 3: Write the config**

Create `packages/backend/src/file/file.config.ts`:

```ts
import { registerAs } from '@nestjs/config';

// Mirrors image.config.ts. MinIO dev defaults only outside production so
// misconfiguration fails fast in prod instead of using predictable creds.
const isDev = process.env.NODE_ENV !== 'production';

export const fileConfig = registerAs('file', () => ({
  endpoint:
    process.env.FILE_STORAGE_ENDPOINT || (isDev ? 'http://localhost:9000' : ''),
  bucket: process.env.FILE_STORAGE_BUCKET || (isDev ? 'wafflebase-files' : ''),
  region: process.env.FILE_STORAGE_REGION || (isDev ? 'us-east-1' : ''),
  accessKey: process.env.FILE_STORAGE_ACCESS_KEY || (isDev ? 'minioadmin' : ''),
  secretKey: process.env.FILE_STORAGE_SECRET_KEY || (isDev ? 'minioadmin' : ''),
  maxFileSizeBytes: 50 * 1024 * 1024, // 50 MB
  allowedMimeTypes: ['application/pdf'],
}));
```

- [x] **Step 4: Write the id-pattern constant**

Create `packages/backend/src/file/file.constants.ts`:

```ts
export const VALID_FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;
```

- [x] **Step 5: Write the service (mirrors ImageService)**

Create `packages/backend/src/file/file.service.ts`:

```ts
import { Injectable, BadRequestException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
};

@Injectable()
export class FileService implements OnModuleInit {
  private s3: S3Client;
  private bucket: string;
  private maxFileSize: number;
  private allowedMimeTypes: string[];

  constructor(private config: ConfigService) {
    const endpoint = this.config.get<string>('file.endpoint')!;
    const region = this.config.get<string>('file.region')!;
    const accessKey = this.config.get<string>('file.accessKey')!;
    const secretKey = this.config.get<string>('file.secretKey')!;
    this.bucket = this.config.get<string>('file.bucket')!;
    this.maxFileSize = this.config.get<number>('file.maxFileSizeBytes')!;
    this.allowedMimeTypes = this.config.get<string[]>('file.allowedMimeTypes')!;

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true, // Required for MinIO
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[FileService] Failed to ensure bucket "${this.bucket}":`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  async upload(
    file: Buffer,
    mimeType: string,
    _originalName: string,
  ): Promise<{ id: string }> {
    if (!this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    if (file.length > this.maxFileSize) {
      throw new BadRequestException(
        `File too large (max ${this.maxFileSize / 1024 / 1024} MB)`,
      );
    }
    const ext = MIME_TO_EXT[mimeType];
    if (!ext) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    const id = `${randomUUID()}.${ext}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: id,
        Body: file,
        ContentType: mimeType,
      }),
    );
    return { id };
  }

  async getObject(
    id: string,
  ): Promise<{ body: Uint8Array; contentType: string }> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: id }),
    );
    const body = response.Body
      ? await (
          response.Body as { transformToByteArray: () => Promise<Uint8Array> }
        ).transformToByteArray()
      : new Uint8Array();
    return {
      body,
      contentType: response.ContentType || 'application/pdf',
    };
  }

  async delete(id: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: id }),
    );
  }
}
```

- [x] **Step 6: Run the tests and confirm they pass**

Run: `pnpm --filter @wafflebase/backend test file.service`
Expected: PASS (both validation branches throw before any S3 call).

- [x] **Step 7: Commit**

```bash
git add packages/backend/src/file
git commit -m "feat: add FileService blob storage for PDF uploads"
```

---

## Task 3: Backend — upload endpoint, document-scoped serving, delete cascade

**Files:**
- Create: `packages/backend/src/file/file.controller.ts`
- Create: `packages/backend/src/file/file.module.ts`
- Modify: `packages/backend/src/app.module.ts` (register `FileModule`)
- Modify: `packages/backend/src/document/document.module.ts` (import `FileModule` so the controller can inject `FileService`)
- Modify: `packages/backend/src/document/document.controller.ts` (serving + delete cascade)
- Test: `packages/backend/src/document/document.controller.spec.ts`

**Interfaces:**
- Consumes: `FileService` (Task 2); `WorkspaceService.assertMember`; `DocumentService.document`/`deleteDocument`.
- Produces: `POST /files` → `{ id: string }`; `GET /documents/:id/file` streams the blob (404 if no `fileId`, 403 if not a member); deleting a PDF document deletes its blob.

- [x] **Step 1: Write the failing serving tests (controller unit)**

Create `packages/backend/src/document/document.controller.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentController } from './document.controller';

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    end: jest.fn(),
  };
}

const req = { user: { id: '1' } } as never;

describe('DocumentController.getDocumentFile', () => {
  it('404s when the document has no fileId', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: null,
      }),
    };
    const workspaceService = { assertMember: jest.fn().mockResolvedValue({}) };
    const fileService = { getObject: jest.fn() };
    const ctrl = new DocumentController(
      documentService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      fileService as never,
    );
    await expect(
      ctrl.getDocumentFile('d1', req, makeRes() as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fileService.getObject).not.toHaveBeenCalled();
  });

  it('rejects a non-member before touching storage', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: 'f.pdf',
      }),
    };
    const workspaceService = {
      assertMember: jest.fn().mockRejectedValue(new ForbiddenException()),
    };
    const fileService = { getObject: jest.fn() };
    const ctrl = new DocumentController(
      documentService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      fileService as never,
    );
    await expect(
      ctrl.getDocumentFile('d1', req, makeRes() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fileService.getObject).not.toHaveBeenCalled();
  });

  it('streams the blob with a private cache header for a member', async () => {
    const documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'd1',
        workspaceId: 'w1',
        type: 'pdf',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      }),
    };
    const workspaceService = { assertMember: jest.fn().mockResolvedValue({}) };
    const fileService = {
      getObject: jest.fn().mockResolvedValue({
        body: new Uint8Array([1, 2, 3]),
        contentType: 'application/pdf',
      }),
    };
    const ctrl = new DocumentController(
      documentService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      fileService as never,
    );
    const res = makeRes();
    await ctrl.getDocumentFile('d1', req, res as never);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Cache-Control']).toContain('private');
    expect(res.end).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @wafflebase/backend test document.controller`
Expected: FAIL — `getDocumentFile` does not exist / constructor arity mismatch.

- [x] **Step 3: Create the upload controller**

Create `packages/backend/src/file/file.controller.ts`:

```ts
import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileService } from './file.service';

@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ id: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.fileService.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }
}
```

- [x] **Step 4: Create the module and register it**

Create `packages/backend/src/file/file.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { fileConfig } from './file.config';
import { FileService } from './file.service';
import { FileController } from './file.controller';

@Module({
  imports: [ConfigModule.forFeature(fileConfig)],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
```

In `packages/backend/src/app.module.ts`, import `FileModule` and add it to the `imports` array (next to `ImageModule`).

In `packages/backend/src/document/document.module.ts`, add `FileModule` to that module's `imports` so `DocumentController` can inject `FileService`.

- [x] **Step 5: Add serving + delete cascade to DocumentController**

In `packages/backend/src/document/document.controller.ts`:

Add imports:
```ts
import { Get, Res } from '@nestjs/common'; // Get already imported; add Res
import type { Response } from 'express';
import { FileService } from '../file/file.service';
import { VALID_FILE_ID_PATTERN } from '../file/file.constants';
```

Inject `FileService` (add as the 4th constructor param — the test relies on this order):
```ts
  constructor(
    private readonly documentService: DocumentService,
    private readonly workspaceService: WorkspaceService,
    private readonly yorkieAdminService: YorkieAdminService,
    private readonly fileService: FileService,
  ) {}
```

Add the serving handler (place it above `@Get('documents/:id')` so the more specific route is registered first):
```ts
  @Get('documents/:id/file')
  async getDocumentFile(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const doc = await this.documentService.document({ id });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    // Same read gate as GET /documents/:id — the file inherits the
    // document's access policy.
    await this.workspaceService.assertMember(
      doc.workspaceId,
      Number(req.user.id),
    );
    if (!doc.fileId || !VALID_FILE_ID_PATTERN.test(doc.fileId)) {
      throw new NotFoundException('Document has no file');
    }
    const { body, contentType } = await this.fileService.getObject(doc.fileId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(Buffer.from(body));
  }
```

In `deleteDocument`, after the successful delete, remove the blob:
```ts
    const deleted = await this.documentService.deleteDocument({ id });
    if (doc.fileId && VALID_FILE_ID_PATTERN.test(doc.fileId)) {
      await this.fileService.delete(doc.fileId).catch(() => undefined);
    }
    return deleted;
```

- [x] **Step 6: Run the tests and confirm they pass**

Run: `pnpm --filter @wafflebase/backend test document.controller file.service`
Expected: PASS.

- [x] **Step 7: Verify build + commit**

Run: `pnpm --filter @wafflebase/backend build`
Expected: succeeds.

```bash
git add packages/backend/src/file packages/backend/src/app.module.ts packages/backend/src/document
git commit -m "feat: serve pdf blobs via document-gated /documents/:id/file"
```

---

## Task 4: Frontend — types + API helpers (upload, file URL, create with fileId)

**Files:**
- Modify: `packages/frontend/src/types/documents.ts`
- Create: `packages/frontend/src/api/files.ts`
- Modify: `packages/frontend/src/api/documents.ts` (createDocument accepts `fileId`)
- Test: `packages/frontend/src/api/files.test.ts`

**Interfaces:**
- Produces: `DocumentType` includes `"pdf"`; `uploadPdf(file: File): Promise<{ id: string }>`; `pdfFileUrl(documentId: string): string`; `createDocument`/`createWorkspaceDocument` payload accepts optional `fileId`.

- [x] **Step 1: Write the failing test for the upload helper + file URL**

Create `packages/frontend/src/api/files.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchWithAuth = vi.fn();
vi.mock('./auth', () => ({ fetchWithAuth: (...a: unknown[]) => fetchWithAuth(...a) }));

import { uploadPdf, pdfFileUrl } from './files';

describe('files api', () => {
  beforeEach(() => fetchWithAuth.mockReset());

  it('POSTs multipart form data and returns the id', async () => {
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ id: 'x.pdf' }) });
    const file = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' });
    const res = await uploadPdf(file);
    expect(res).toEqual({ id: 'x.pdf' });
    const [url, opts] = fetchWithAuth.mock.calls[0];
    expect(String(url)).toMatch(/\/files$/);
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('throws on a non-ok response', async () => {
    fetchWithAuth.mockResolvedValue({ ok: false, status: 413, statusText: 'Too Large' });
    const file = new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' });
    await expect(uploadPdf(file)).rejects.toThrow(/413/);
  });

  it('builds a document-scoped file url', () => {
    expect(pdfFileUrl('d1')).toMatch(/\/documents\/d1\/file$/);
  });
});
```

- [x] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @wafflebase/frontend test files.test`
Expected: FAIL — cannot resolve `./files`.

- [x] **Step 3: Add `"pdf"` to the DocumentType union**

In `packages/frontend/src/types/documents.ts`:
```ts
export type DocumentType = "sheet" | "doc" | "slides" | "pdf";
```

- [x] **Step 4: Create the files api helper**

Create `packages/frontend/src/api/files.ts`:

```ts
import { fetchWithAuth } from "./auth";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

/** Upload a PDF blob; returns the stored blob id. */
export async function uploadPdf(file: File): Promise<{ id: string }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await fetchWithAuth(`${BACKEND_BASE}/files`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`PDF upload failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as { id: string };
}

/** Document-scoped, permission-gated URL that streams the stored PDF. */
export function pdfFileUrl(documentId: string): string {
  return `${BACKEND_BASE}/documents/${documentId}/file`;
}
```

- [x] **Step 5: Thread `fileId` through createDocument**

In `packages/frontend/src/api/documents.ts`, extend the `createDocument` payload type to include `fileId?: string` and pass it through in the POST body. Do the same for `createWorkspaceDocument` in `packages/frontend/src/api/workspaces.ts`. (Find the existing `{ title: string; type?: DocumentType }` payload type and add `fileId?: string`.)

- [x] **Step 6: Run the tests and confirm they pass**

Run: `pnpm --filter @wafflebase/frontend test files.test`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/frontend/src/types packages/frontend/src/api
git commit -m "feat: frontend api helpers for pdf upload and file url"
```

---

## Task 5: Frontend — documents list "Upload PDF" + type meta/filter/path

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx`
- Test: `packages/frontend/src/app/documents/document-list-utils.test.ts` (or the file that already tests `getDocumentPath`; create a focused test if none)

**Interfaces:**
- Consumes: `uploadPdf` (Task 4); `pickFile` from `@/app/docs/export-utils`.
- Produces: `getDocumentPath({ type: "pdf", id })` → `/f/:id`; a "New → Upload PDF" menu action.

- [x] **Step 1: Write the failing test for the pdf path**

If `getDocumentPath` is not exported/tested, first export it from `document-list.tsx` (or move it into `document-list-utils.ts` alongside `matchesTypes` and re-import). Then add to the utils test file:

```ts
import { getDocumentPath } from "./document-list-utils";

it("routes pdf documents to /f/:id", () => {
  expect(getDocumentPath({ id: "d1", type: "pdf" })).toBe("/f/d1");
});
```

- [x] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @wafflebase/frontend test document-list-utils`
Expected: FAIL — pdf falls through to the sheet default `/s/d1`.

- [x] **Step 3: Add the pdf branch to `getDocumentPath`**

```ts
    case "pdf":
      return `/f/${doc.id}`;
```

- [x] **Step 4: Add the pdf type-meta entry and filter chip**

In `document-list.tsx`, import a PDF icon from `lucide-react` (e.g. `FileType2` — pick an unused one) and add to `TYPE_META`:
```ts
  pdf: { label: "PDF", Icon: FileType2, color: "text-red-500" },
```
Add `"pdf"` to `TYPE_OPTIONS`:
```ts
const TYPE_OPTIONS: ReadonlyArray<DocumentType> = ["sheet", "doc", "slides", "pdf"];
```

- [x] **Step 5: Add the "Upload PDF" handler**

Mirror `handleImportDocx` but upload the original instead of parsing. Add near the other import handlers:
```tsx
  const handleUploadPdf = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const file = await pickFile("application/pdf");
      if (!file) return;
      const { id: fileId } = await uploadPdf(file);
      const title = file.name.replace(/\.pdf$/i, "") || "Untitled PDF";
      const payload = { title, type: "pdf" as const, fileId };
      const created = workspaceId
        ? await createWorkspaceDocument(workspaceId, payload)
        : await createDocument(payload);
      navigate(getDocumentPath(created));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PDF upload failed");
    } finally {
      setImporting(false);
    }
  };
```
Add imports: `import { uploadPdf } from "@/api/files";` and `import { pickFile } from "@/app/docs/export-utils";` (if not already imported).

- [x] **Step 6: Add the menu item to both New menus**

In both the main dropdown (~lines 608-668) and the empty-state copy (~lines 734-796), add:
```tsx
            <DropdownMenuItem disabled={importing} onClick={handleUploadPdf}>
              <FileType2 className="mr-2 h-4 w-4 text-red-500" />
              Upload PDF
            </DropdownMenuItem>
```

- [x] **Step 7: Run tests + typecheck and confirm pass**

Run: `pnpm --filter @wafflebase/frontend test document-list-utils && pnpm verify:fast`
Expected: PASS (TS forces the `pdf` key on `TYPE_META` — confirm it compiles).

- [x] **Step 8: Commit**

```bash
git add packages/frontend/src/app/documents
git commit -m "feat: add Upload PDF action and pdf type to documents list"
```

---

## Task 6: Frontend — `PdfDetail` viewer (pdf.js) + `/f/:id` route

**Files:**
- Modify: `packages/frontend/package.json` (add `pdfjs-dist`)
- Create: `packages/frontend/src/app/files/pdf-viewer.tsx` (pdf.js rendering, dynamic import)
- Create: `packages/frontend/src/app/files/file-detail.tsx` (auth gate + app shell)
- Modify: `packages/frontend/src/App.tsx` (lazy import + `/f/:id` route)
- Test: `packages/frontend/src/app/files/pdf-viewer.test.tsx`

**Interfaces:**
- Consumes: `pdfFileUrl` (Task 4); `fetchDocument` from `@/api/documents`; app-shell components (`SidebarProvider`, `SidebarInset`, `AppSidebar`, `SiteHeader`, `Loader`) as used by `docs-detail.tsx`.
- Produces: route `/f/:id` renders the stored PDF read-only.

- [x] **Step 1: Add the dependency**

Run: `pnpm --filter @wafflebase/frontend add pdfjs-dist`
Expected: `pdfjs-dist` appears in `packages/frontend/package.json` dependencies.

- [x] **Step 2: Write the failing viewer test (pdfjs mocked)**

Create `packages/frontend/src/app/files/pdf-viewer.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

// Mock pdfjs-dist so the test never loads the real worker.
vi.mock("pdfjs-dist", () => {
  const page = {
    getViewport: () => ({ width: 100, height: 140, scale: 1 }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page }),
    }),
  };
});
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "worker.js" }));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  arrayBuffer: async () => new ArrayBuffer(8),
}) as never;

import { PdfViewer } from "./pdf-viewer";

describe("PdfViewer", () => {
  it("renders a canvas for each page after loading", async () => {
    const { container } = render(<PdfViewer fileUrl="/documents/d1/file" />);
    await waitFor(() =>
      expect(container.querySelectorAll("canvas").length).toBeGreaterThan(0),
    );
  });
});
```

- [x] **Step 3: Run and confirm it fails**

Run: `pnpm --filter @wafflebase/frontend test pdf-viewer`
Expected: FAIL — cannot resolve `./pdf-viewer`.

- [x] **Step 4: Write the PdfViewer (dynamic pdfjs import + canvas render)**

Create `packages/frontend/src/app/files/pdf-viewer.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

/**
 * Renders a PDF read-only. `pdfjs-dist` is imported dynamically so the
 * (large) library + its worker stay in a lazy chunk, off the main bundle
 * and clear of the frontend chunk gate.
 */
export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
          .default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;

        const res = await fetch(fileUrl, { credentials: "include" });
        if (!res.ok) throw new Error(`Failed to load PDF (${res.status})`);
        const data = await res.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        for (let n = 1; n <= pdf.numPages; n++) {
          const pdfPage = await pdf.getPage(n);
          if (cancelled) return;
          const viewport = pdfPage.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto my-4 shadow";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          container.appendChild(canvas);
          await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "PDF error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  if (error) {
    return <div className="p-8 text-center text-red-500">{error}</div>;
  }
  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-muted/30 p-4"
      data-testid="pdf-pages"
    />
  );
}
```

Note: the `?url` worker import is Vite-idiomatic; if the installed `pdfjs-dist` version ships the worker at a different path, adjust the specifier to the built worker file that exists under `node_modules/pdfjs-dist/build/` and update the test mock to match.

- [x] **Step 5: Run the viewer test and confirm it passes**

Run: `pnpm --filter @wafflebase/frontend test pdf-viewer`
Expected: PASS (mocked pdfjs yields one canvas).

- [x] **Step 6: Write the FileDetail shell**

Create `packages/frontend/src/app/files/file-detail.tsx`, mirroring the `DocsDetail`/`DocsLayout` skeleton from `packages/frontend/src/app/docs/docs-detail.tsx` but read-only and **without** the Yorkie `DocumentProvider`:

- Auth gate: `useQuery(["me"], fetchMe)` → `<Loader />` / `<Navigate to="/login" replace />`.
- `const { id } = useParams();`
- `useQuery(["document", id], () => fetchDocument(id!))` for title/workspaceId; on error `toast.error("Document not found")` + navigate to `/documents`.
- App shell: `<SidebarProvider><AppSidebar .../><SidebarInset><SiteHeader title={documentData?.title ?? "Loading..."}>` (no rename, no ShareDialog in Phase 1) `</SiteHeader>` then `<div className="flex flex-1 flex-col min-h-0 overflow-hidden"><PdfViewer fileUrl={pdfFileUrl(id!)} /></div></SidebarInset></SidebarProvider>`.
- Import `pdfFileUrl` from `@/api/files` and `PdfViewer` from `./pdf-viewer`.
- Default-export the component.

- [x] **Step 7: Wire the route**

In `packages/frontend/src/App.tsx`, add near the other lazy detail imports (~line 25):
```tsx
const FileDetail = lazy(() => import("@/app/files/file-detail"));
```
Add inside the `<PrivateRoute>` block, right after the `/s/:id` route (~line 83):
```tsx
                  <Route path="/f/:id" element={<FileDetail />} />
```

- [x] **Step 8: Verify build, chunk gate, and full fast lane**

Run: `pnpm verify:self`
Expected: PASS — builds succeed and the frontend chunk gate stays green (confirms `pdfjs-dist` landed in a lazy chunk, not the main bundle). If the chunk gate trips, verify the `pdfjs-dist` import is `await import(...)` inside `PdfViewer` and not statically imported anywhere.

- [x] **Step 9: Commit**

```bash
git add packages/frontend/package.json packages/frontend/src/app/files packages/frontend/src/App.tsx pnpm-lock.yaml
git commit -m "feat: add pdf.js viewer at /f/:id"
```

---

## Task 7: End-to-end smoke + review + docs

- [x] **Step 1: Manual smoke in `pnpm dev`**

`docker compose up -d` then `pnpm dev`. In the documents list: New → Upload PDF → pick a small PDF → lands on `/f/:id` and renders pages. Confirm: the row shows the PDF type/filter chip; deleting the document succeeds; opening the file URL while logged out (or as a non-member) is rejected.

- [x] **Step 2: Branch code review**

Run `/code-review` (or `superpowers:requesting-code-review`) over the full branch diff. Apply blocking findings; note non-blocking as known limitations.

- [x] **Step 3: Capture lessons + archive**

Fill in `docs/tasks/active/20260707-pdf-viewer-lessons.md`, then `pnpm tasks:archive && pnpm tasks:index`. Commit task docs together.

- [x] **Step 4: Open the PR**

`git fetch && git rebase origin/main`, push, open PR (title ≤70 chars; body = Summary + Test plan).

---

## Review

Shipped as PR #451 ("Add PDF viewer document type (upload, blob storage,
/f/:id)") — the full Phase 1 plan above.

- **Data model** — `Document.fileId` column (migration
  `20260707000000_add_document_file_id`), `"pdf"` added to the backend DTO
  and frontend `DocumentType` unions, and the `pdf-` prefix reserved in
  `yorkie-doc-key.ts` (registered but unused in Phase 1) so the
  documents-list key derivation never throws for a PDF row.
- **Blob storage** — `FileService` (S3/MinIO via `@aws-sdk/client-s3`,
  mirrors `ImageService`): `application/pdf`-only, 50 MB cap, dev-default
  MinIO creds refused outside `NODE_ENV=production`. `POST /files` uploads
  and returns an opaque `<uuid>.pdf` id.
- **Permission-gated serving** — `GET /documents/:id/file` reuses the
  document's own read gate (`assertMember`), so the file inherits the
  document's access policy with no parallel permission logic; there is
  deliberately no read-by-blob-id route. Deleting a PDF document cascades a
  best-effort blob delete.
- **Viewer** — `PdfViewer` dynamically `import()`s `pdfjs-dist` (worker as a
  `?url` `.mjs` asset) so the ~444 KB engine stays in a lazy chunk off the
  main bundle; the chunk gate change was a count-only bump (112→115) with
  the KB cap unchanged, confirming nothing leaked. `FileDetail` mounts it at
  `/f/:id` read-only (no Yorkie `DocumentProvider`). Documents list gained a
  "New → Upload PDF" action and a PDF type chip.

Review-caught fixes folded in before merge (detailed in the lessons file):
pdf.js forbids concurrent `render()` on one canvas (keep + `cancel()` the
`RenderTask`, catch `RenderingCancelledException`) and the
`PDFDocumentProxy` must be `destroy()`ed on unmount to avoid leaking the
worker; the named `import { version }` in `root.ts`; and frontend tests
must live under `tests/**` (colocated `src/**` specs never run).

**Phase 2 deferred** (`pdf-` Yorkie key already reserved): comments +
presence, anonymous/share-token viewing (needs a token-accepting serving
path), and the non-blocking hardening follow-ups logged in the lessons file
(magic-byte `%PDF` sniff, blob-ownership record, `NoSuchKey`→404,
`FileService` S3-mock tests, viewer zoom/download controls).
