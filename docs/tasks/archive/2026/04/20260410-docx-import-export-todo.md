# DOCX Import / Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import .docx files into the Docs editor and export documents back to .docx format.

**Architecture:** Three-phase approach — first add prerequisite features (inline images with S3 storage, web font loading), then build DOCX import (JSZip + DOMParser in the browser), then DOCX export (XML generation + JSZip packaging). All conversion logic lives in `packages/docs/src/import/` and `packages/docs/src/export/`, keeping it isomorphic and close to the model types.

**Tech Stack:** JSZip (zip/unzip), DOMParser (XML parsing), @aws-sdk/client-s3 (image storage), MinIO (dev S3), NestJS (image API), Canvas 2D (image rendering)

**Spec:** `docs/design/docs/docs-docx-import-export.md`

---

## Phase 1 — Prerequisite Features

### Task 1: Add ImageData type and image field to InlineStyle

**Files:**
- Modify: `packages/docs/src/model/types.ts`
- Test: `packages/docs/test/model/types.test.ts`

- [x] **Step 1: Write the failing test**

Add to `packages/docs/test/model/types.test.ts`:

```typescript
describe('ImageData on InlineStyle', () => {
  it('should allow creating an inline with image data', () => {
    const inline: Inline = {
      text: '\uFFFC',
      style: {
        image: {
          src: 'https://example.com/image.png',
          width: 200,
          height: 150,
          alt: 'Test image',
        },
      },
    };
    expect(inline.style.image).toBeDefined();
    expect(inline.style.image!.src).toBe('https://example.com/image.png');
    expect(inline.style.image!.width).toBe(200);
    expect(inline.style.image!.height).toBe(150);
    expect(inline.style.image!.alt).toBe('Test image');
  });

  it('should compare inline styles with image data', () => {
    const a: InlineStyle = {
      image: { src: 'a.png', width: 100, height: 100 },
    };
    const b: InlineStyle = {
      image: { src: 'a.png', width: 100, height: 100 },
    };
    const c: InlineStyle = {
      image: { src: 'b.png', width: 100, height: 100 },
    };
    expect(inlineStylesEqual(a, b)).toBe(true);
    expect(inlineStylesEqual(a, c)).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm test -- --run test/model/types.test.ts`
Expected: FAIL — `image` property does not exist on `InlineStyle`

- [x] **Step 3: Add ImageData type and image field**

In `packages/docs/src/model/types.ts`, add after the `InlineStyle` interface:

```typescript
/**
 * Image data for inline image elements.
 */
export interface ImageData {
  src: string;
  width: number;
  height: number;
  alt?: string;
}
```

Add `image` field to `InlineStyle`:

```typescript
export interface InlineStyle {
  // ... existing fields ...
  pageNumber?: boolean;
  image?: ImageData;
}
```

Update `inlineStylesEqual` to compare `image`:

```typescript
export function inlineStylesEqual(a: InlineStyle, b: InlineStyle): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    a.superscript === b.superscript &&
    a.subscript === b.subscript &&
    a.href === b.href &&
    a.pageNumber === b.pageNumber &&
    imageDataEqual(a.image, b.image)
  );
}

function imageDataEqual(a: ImageData | undefined, b: ImageData | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.src === b.src && a.width === b.width && a.height === b.height && a.alt === b.alt;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm test -- --run test/model/types.test.ts`
Expected: PASS

- [x] **Step 5: Run full typecheck**

Run: `cd packages/docs && pnpm typecheck`
Expected: PASS — no existing code breaks

- [x] **Step 6: Commit**

```bash
git add packages/docs/src/model/types.ts packages/docs/test/model/types.test.ts
git commit -m "Add ImageData type and image field to InlineStyle"
```

---

### Task 2: Add image inline support to Doc model

**Files:**
- Modify: `packages/docs/src/model/document.ts`
- Test: `packages/docs/test/model/document.test.ts`

- [x] **Step 1: Write the failing test**

Add to `packages/docs/test/model/document.test.ts`:

```typescript
describe('image inlines', () => {
  it('should insert an image inline into a block', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    doc.insertText({ blockId, offset: 0 }, 'Hello');

    const imageInline: Inline = {
      text: '\uFFFC',
      style: {
        image: { src: '/images/test.png', width: 200, height: 100 },
      },
    };
    doc.insertImageInline(blockId, 5, imageInline);

    const block = doc.document.blocks[0];
    expect(getBlockText(block)).toBe('Hello\uFFFC');
    expect(block.inlines[block.inlines.length - 1].style.image?.src).toBe('/images/test.png');
  });

  it('should delete an image inline with backspace', () => {
    const doc = Doc.create();
    const blockId = doc.document.blocks[0].id;
    const imageInline: Inline = {
      text: '\uFFFC',
      style: {
        image: { src: '/images/test.png', width: 200, height: 100 },
      },
    };
    doc.insertImageInline(blockId, 0, imageInline);
    expect(getBlockText(doc.document.blocks[0])).toBe('\uFFFC');

    doc.deleteText({ blockId, offset: 0 }, 1);
    expect(getBlockText(doc.document.blocks[0])).toBe('');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm test -- --run test/model/document.test.ts`
Expected: FAIL — `insertImageInline` does not exist on `Doc`

- [x] **Step 3: Implement insertImageInline on Doc**

Add to `packages/docs/src/model/document.ts`:

```typescript
/**
 * Insert an image inline at the given offset within a block.
 * The image inline uses \uFFFC as its text character.
 */
insertImageInline(blockId: string, offset: number, imageInline: Inline): void {
  this.store.snapshot();
  const block = this.getBlock(blockId);
  const cloned = cloneBlock(block);

  // Split inlines at offset, insert the image inline in between
  const before: Inline[] = [];
  const after: Inline[] = [];
  let remaining = offset;
  for (const inline of cloned.inlines) {
    if (remaining >= inline.text.length) {
      before.push(inline);
      remaining -= inline.text.length;
    } else if (remaining > 0) {
      before.push({ text: inline.text.slice(0, remaining), style: { ...inline.style } });
      after.push({ text: inline.text.slice(remaining), style: { ...inline.style } });
      remaining = 0;
    } else {
      after.push(inline);
    }
  }

  cloned.inlines = [...before, imageInline, ...after];
  this.store.updateBlock(blockId, cloned);
  this.refresh();
}
```

Import `cloneBlock` from `../store/block-helpers.js` and `Inline` from `../model/types.js` if not already imported.

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm test -- --run test/model/document.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/model/document.ts packages/docs/test/model/document.test.ts
git commit -m "Add insertImageInline method to Doc model"
```

---

### Task 3: Add image inline support to Yorkie serialization

**Files:**
- Modify: `packages/frontend/src/app/docs/yorkie-doc-store.ts`

- [x] **Step 1: Add image serialization to serializeInlineStyle**

In the `serializeInlineStyle` function, add:

```typescript
if (style.image) {
  attrs['image.src'] = style.image.src;
  attrs['image.width'] = String(style.image.width);
  attrs['image.height'] = String(style.image.height);
  if (style.image.alt) attrs['image.alt'] = style.image.alt;
}
```

- [x] **Step 2: Add image deserialization to parseInlineStyle**

In the `parseInlineStyle` function, add:

```typescript
if ('image.src' in attrs) {
  style.image = {
    src: attrs['image.src'],
    width: Number(attrs['image.width']),
    height: Number(attrs['image.height']),
    alt: attrs['image.alt'] || undefined,
  };
}
```

- [x] **Step 3: Run typecheck**

Run: `pnpm frontend typecheck`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add packages/frontend/src/app/docs/yorkie-doc-store.ts
git commit -m "Add image data serialization to Yorkie doc store"
```

---

### Task 4: Add image rendering to layout and canvas

**Files:**
- Modify: `packages/docs/src/view/layout.ts`
- Modify: `packages/docs/src/view/doc-canvas.ts`
- Modify: `packages/docs/src/view/editor.ts`

This task modifies the view layer which uses Canvas 2D and doesn't have unit-testable functions for image rendering (requires a browser DOM). It will be verified via manual testing and the existing visual test infrastructure.

- [x] **Step 1: Add image measurement to layout.ts**

In the word-wrap logic inside `computeLayout` (or the inline measurement function), add image handling before `measureText`:

```typescript
// When computing run width for an inline:
if (inline.style.image) {
  const img = inline.style.image;
  const maxWidth = contentWidth; // available width in the line
  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const displayWidth = img.width * scale;
  const displayHeight = img.height * scale;
  // Treat as a single unbreakable run with these dimensions
  // Set run.width = displayWidth, line.height = max(line.height, displayHeight)
}
```

The exact insertion point depends on the word-wrap loop structure. The key principle: an image inline produces a single `LayoutRun` that cannot be word-broken, with width and height taken from `image.width`/`image.height` (scaled down if wider than content area).

- [x] **Step 2: Add ImageCache and image drawing to doc-canvas.ts**

Add at module level in `doc-canvas.ts`:

```typescript
const imageCache = new Map<string, HTMLImageElement>();

function getOrLoadImage(
  src: string,
  onLoad: () => void,
): HTMLImageElement | null {
  const cached = imageCache.get(src);
  if (cached && cached.complete) return cached;
  if (!cached) {
    const img = new Image();
    img.onload = onLoad;
    img.src = src;
    imageCache.set(src, img);
  }
  return null;
}
```

In the run rendering loop (where `ctx.fillText` is called), add before the text draw:

```typescript
if (run.inline.style.image) {
  const img = getOrLoadImage(run.inline.style.image.src, () => {
    // Trigger re-render when image loads
    this.render(/* pass current args */);
  });
  if (img) {
    ctx.drawImage(img, run.x + pageXOffset, run.y + lineY, run.width, lineHeight);
  }
  continue; // Skip text rendering for image runs
}
```

- [x] **Step 3: Wire re-render callback in editor.ts**

Ensure the editor's render method is accessible for the image onload callback. The `DocCanvas` already has access to the render pipeline through the editor. Store a `requestRender` callback that the canvas can invoke.

- [x] **Step 4: Run typecheck and verify**

Run: `cd packages/docs && pnpm typecheck`
Expected: PASS

Run: `pnpm verify:fast`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/layout.ts packages/docs/src/view/doc-canvas.ts packages/docs/src/view/editor.ts
git commit -m "Add image inline rendering to layout and canvas"
```

---

### Task 5: Add MinIO to docker-compose and create ImageModule backend

**Files:**
- Modify: `docker-compose.yaml`
- Create: `packages/backend/src/image/image.module.ts`
- Create: `packages/backend/src/image/image.service.ts`
- Create: `packages/backend/src/image/image.controller.ts`
- Create: `packages/backend/src/image/image.config.ts`
- Modify: `packages/backend/src/app.module.ts`
- Test: `packages/backend/test/image.service.spec.ts`

- [x] **Step 1: Add MinIO service to docker-compose.yaml**

Append to `docker-compose.yaml`:

```yaml
  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes:
      - minio-data:/data

volumes:
  minio-data:
```

- [x] **Step 2: Create image.config.ts**

Create `packages/backend/src/image/image.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';

export const imageConfig = registerAs('image', () => ({
  endpoint: process.env.IMAGE_STORAGE_ENDPOINT || 'http://localhost:9000',
  bucket: process.env.IMAGE_STORAGE_BUCKET || 'wafflebase-images',
  region: process.env.IMAGE_STORAGE_REGION || 'us-east-1',
  accessKey: process.env.IMAGE_STORAGE_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.IMAGE_STORAGE_SECRET_KEY || 'minioadmin',
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
}));
```

- [x] **Step 3: Create image.service.ts**

Create `packages/backend/src/image/image.service.ts`:

```typescript
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

@Injectable()
export class ImageService implements OnModuleInit {
  private s3: S3Client;
  private bucket: string;
  private maxFileSize: number;
  private allowedMimeTypes: string[];

  constructor(private config: ConfigService) {
    const endpoint = this.config.get<string>('image.endpoint')!;
    const region = this.config.get<string>('image.region')!;
    const accessKey = this.config.get<string>('image.accessKey')!;
    const secretKey = this.config.get<string>('image.secretKey')!;
    this.bucket = this.config.get<string>('image.bucket')!;
    this.maxFileSize = this.config.get<number>('image.maxFileSizeBytes')!;
    this.allowedMimeTypes = this.config.get<string[]>('image.allowedMimeTypes')!;

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
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async upload(
    file: Buffer,
    mimeType: string,
    originalName: string,
  ): Promise<{ id: string; url: string }> {
    if (!this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(`Unsupported file type: ${mimeType}`);
    }
    if (file.length > this.maxFileSize) {
      throw new BadRequestException(`File too large (max ${this.maxFileSize / 1024 / 1024} MB)`);
    }

    const ext = originalName.split('.').pop() || 'bin';
    const id = randomUUID();
    const key = `${id}.${ext}`;

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file,
      ContentType: mimeType,
    }));

    return { id: key, url: `/images/${key}` };
  }

  async getObject(id: string): Promise<{ body: ReadableStream; contentType: string }> {
    const response = await this.s3.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: id,
    }));
    return {
      body: response.Body as unknown as ReadableStream,
      contentType: response.ContentType || 'application/octet-stream',
    };
  }

  async delete(id: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: id,
    }));
  }
}
```

- [x] **Step 4: Create image.controller.ts**

Create `packages/backend/src/image/image.controller.ts`:

```typescript
import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ImageService } from './image.service';
import type { Response } from 'express';

@Controller('images')
export class ImageController {
  constructor(private readonly imageService: ImageService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ id: string; url: string }> {
    return this.imageService.upload(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }

  @Get(':id')
  async get(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { body, contentType } = await this.imageService.getObject(id);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const reader = (body as any).getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(value);
      await pump();
    };
    await pump();
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    await this.imageService.delete(id);
    return { deleted: true };
  }
}
```

- [x] **Step 5: Create image.module.ts**

Create `packages/backend/src/image/image.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ImageController } from './image.controller';
import { ImageService } from './image.service';
import { imageConfig } from './image.config';

@Module({
  imports: [ConfigModule.forFeature(imageConfig)],
  controllers: [ImageController],
  providers: [ImageService],
  exports: [ImageService],
})
export class ImageModule {}
```

- [x] **Step 6: Register ImageModule in AppModule**

In `packages/backend/src/app.module.ts`, add import and register:

```typescript
import { ImageModule } from './image/image.module';

@Module({
  imports: [
    // ... existing imports ...
    ImageModule,
  ],
})
export class AppModule {}
```

- [x] **Step 7: Install @aws-sdk/client-s3 dependency**

Run: `cd packages/backend && pnpm add @aws-sdk/client-s3`

- [x] **Step 8: Run backend typecheck and tests**

Run: `pnpm backend test`
Expected: PASS (existing tests still pass)

Run: `pnpm verify:fast`
Expected: PASS

- [x] **Step 9: Commit**

```bash
git add docker-compose.yaml packages/backend/src/image/ packages/backend/src/app.module.ts packages/backend/package.json pnpm-lock.yaml
git commit -m $'Add ImageModule with S3-compatible storage backend\n\nMinIO for dev environment, configurable S3 endpoint for production.\nSupports upload, serve, and delete of image resources.'
```

---

### Task 6: Add font registry and web font loading

**Files:**
- Create: `packages/docs/src/view/fonts.ts`
- Test: `packages/docs/test/view/fonts.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/docs/test/view/fonts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { FontRegistry, resolveFontFamily } from '../../src/view/fonts.js';

describe('FontRegistry', () => {
  it('should resolve known Korean font to fallback chain', () => {
    expect(resolveFontFamily('맑은 고딕')).toBe("'Malgun Gothic', 'Noto Sans KR', sans-serif");
  });

  it('should resolve HY헤드라인M to Noto Sans KR fallback', () => {
    expect(resolveFontFamily('HY헤드라인M')).toBe("'Noto Sans KR', sans-serif");
  });

  it('should return standard fonts as-is with fallback', () => {
    expect(resolveFontFamily('Arial')).toBe("'Arial', sans-serif");
  });

  it('should return unknown fonts with generic fallback', () => {
    expect(resolveFontFamily('SomeRandomFont')).toBe("'SomeRandomFont', sans-serif");
  });

  it('should resolve 바탕 to serif chain', () => {
    expect(resolveFontFamily('바탕')).toBe("'Batang', 'Noto Serif KR', serif");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm test -- --run test/view/fonts.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement font registry**

Create `packages/docs/src/view/fonts.ts`:

```typescript
/**
 * Font registry — maps font family names to web-safe fallback chains
 * and handles on-demand font loading via the CSS Font Loading API.
 */

const FONT_MAP: Record<string, string> = {
  '맑은 고딕': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  'Malgun Gothic': "'Malgun Gothic', 'Noto Sans KR', sans-serif",
  '바탕': "'Batang', 'Noto Serif KR', serif",
  'Batang': "'Batang', 'Noto Serif KR', serif",
  'HY헤드라인M': "'Noto Sans KR', sans-serif",
  'Arial': "'Arial', sans-serif",
  'Tahoma': "'Tahoma', sans-serif",
};

const SERIF_FONTS = new Set(['바탕', 'Batang', 'Noto Serif KR', 'Times New Roman', 'Georgia']);

/**
 * Resolve a font family name to a CSS fallback chain string.
 */
export function resolveFontFamily(family: string): string {
  const mapped = FONT_MAP[family];
  if (mapped) return mapped;

  const generic = SERIF_FONTS.has(family) ? 'serif' : 'sans-serif';
  return `'${family}', ${generic}`;
}

type FontStatus = 'pending' | 'loading' | 'loaded' | 'error';

/**
 * FontRegistry manages on-demand web font loading and notifies
 * listeners when fonts finish loading (to trigger re-layout).
 */
export class FontRegistry {
  private status = new Map<string, FontStatus>();
  private listeners: Array<() => void> = [];

  /**
   * Register a callback to be called when any font finishes loading.
   */
  onFontLoaded(cb: () => void): void {
    this.listeners.push(cb);
  }

  /**
   * Ensure a font is loaded. If not yet loaded, triggers async loading
   * and calls listeners when done.
   */
  async ensureFont(family: string): Promise<void> {
    if (typeof document === 'undefined') return; // SSR guard
    const key = family;
    const current = this.status.get(key);
    if (current === 'loaded' || current === 'loading') return;

    if (document.fonts.check(`12px "${family}"`)) {
      this.status.set(key, 'loaded');
      return;
    }

    this.status.set(key, 'loading');
    try {
      await document.fonts.load(`12px "${family}"`);
      this.status.set(key, 'loaded');
      this.listeners.forEach((cb) => cb());
    } catch {
      this.status.set(key, 'error');
    }
  }

  getFontStatus(family: string): FontStatus {
    return this.status.get(family) ?? 'pending';
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm test -- --run test/view/fonts.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/view/fonts.ts packages/docs/test/view/fonts.test.ts
git commit -m "Add font registry with Korean font fallback chains"
```

---

## Phase 2 — DOCX Import

### Task 7: Add unit conversion utilities

**Files:**
- Create: `packages/docs/src/import/units.ts`
- Test: `packages/docs/test/import/units.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/docs/test/import/units.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { twipsToPx, emusToPx, halfPointsToPoints, pxToTwips, pxToEmus, pointsToHalfPoints } from '../../src/import/units.js';

describe('OOXML unit conversions', () => {
  it('should convert twips to px', () => {
    expect(twipsToPx(1440)).toBeCloseTo(96, 1);    // 1 inch
    expect(twipsToPx(720)).toBeCloseTo(48, 1);      // 0.5 inch
  });

  it('should convert EMUs to px', () => {
    expect(emusToPx(914400)).toBeCloseTo(96, 1);    // 1 inch
    expect(emusToPx(457200)).toBeCloseTo(48, 1);     // 0.5 inch
  });

  it('should convert half-points to points', () => {
    expect(halfPointsToPoints(24)).toBe(12);
    expect(halfPointsToPoints(30)).toBe(15);
  });

  it('should convert px to twips (reverse)', () => {
    expect(pxToTwips(96)).toBeCloseTo(1440, 1);
  });

  it('should convert px to EMUs (reverse)', () => {
    expect(pxToEmus(96)).toBeCloseTo(914400, 1);
  });

  it('should convert points to half-points (reverse)', () => {
    expect(pointsToHalfPoints(12)).toBe(24);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm test -- --run test/import/units.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement unit conversions**

Create `packages/docs/src/import/units.ts`:

```typescript
/**
 * OOXML ↔ CSS px unit conversions.
 *
 * 1 inch = 1440 twips = 914400 EMUs = 72 points = 96 CSS px
 */

/** Twips (1/1440 inch) → CSS pixels (1/96 inch). */
export function twipsToPx(twips: number): number {
  return twips * 96 / 1440;
}

/** CSS pixels → twips. */
export function pxToTwips(px: number): number {
  return px * 1440 / 96;
}

/** EMUs (1/914400 inch) → CSS pixels. */
export function emusToPx(emus: number): number {
  return emus * 96 / 914400;
}

/** CSS pixels → EMUs. */
export function pxToEmus(px: number): number {
  return px * 914400 / 96;
}

/** OOXML half-points → points. */
export function halfPointsToPoints(halfPts: number): number {
  return halfPts / 2;
}

/** Points → OOXML half-points. */
export function pointsToHalfPoints(pts: number): number {
  return pts * 2;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm test -- --run test/import/units.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/import/units.ts packages/docs/test/import/units.test.ts
git commit -m "Add OOXML unit conversion utilities"
```

---

### Task 8: Implement DOCX style mapping (OOXML → Docs model)

**Files:**
- Create: `packages/docs/src/import/docx-style-map.ts`
- Test: `packages/docs/test/import/docx-style-map.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/docs/test/import/docx-style-map.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapRunProperties, mapParagraphProperties, mapTableCellProperties, mapHighlightColor } from '../../src/import/docx-style-map.js';

describe('mapRunProperties', () => {
  it('should map bold', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:b/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.bold).toBe(true);
  });

  it('should map font size from half-points', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:sz w:val="24"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.fontSize).toBe(12);
  });

  it('should map font family', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:rFonts w:ascii="Arial"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.fontFamily).toBe('Arial');
  });

  it('should map text color', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:color w:val="FF0000"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.color).toBe('#FF0000');
  });

  it('should map underline, italic, strikethrough', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:i/><w:u w:val="single"/><w:strike/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.italic).toBe(true);
    expect(style.underline).toBe(true);
    expect(style.strikethrough).toBe(true);
  });

  it('should map superscript', () => {
    const xml = '<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:vertAlign w:val="superscript"/></w:rPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const style = mapRunProperties(el);
    expect(style.superscript).toBe(true);
  });
});

describe('mapParagraphProperties', () => {
  it('should map center alignment', () => {
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:jc w:val="center"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.alignment).toBe('center');
  });

  it('should map "both" to justify', () => {
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:jc w:val="both"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.alignment).toBe('justify');
  });

  it('should map spacing to marginTop and marginBottom', () => {
    const xml = '<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:spacing w:before="120" w:after="240"/></w:pPr>';
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = mapParagraphProperties(el);
    expect(result.blockStyle.marginTop).toBeCloseTo(8, 0);
    expect(result.blockStyle.marginBottom).toBeCloseTo(16, 0);
  });
});

describe('mapHighlightColor', () => {
  it('should map named highlight colors', () => {
    expect(mapHighlightColor('yellow')).toBe('#FFFF00');
    expect(mapHighlightColor('red')).toBe('#FF0000');
    expect(mapHighlightColor('green')).toBe('#00FF00');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm test -- --run test/import/docx-style-map.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement style mapping**

Create `packages/docs/src/import/docx-style-map.ts`:

```typescript
import type { InlineStyle, BlockStyle } from '../model/types.js';
import { DEFAULT_BLOCK_STYLE } from '../model/types.js';
import { twipsToPx, halfPointsToPoints } from './units.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function getW(el: Element, localName: string): Element | null {
  return el.getElementsByTagNameNS(W, localName)[0] ?? null;
}

function getWAttr(el: Element, attr: string): string | null {
  return el.getAttributeNS(W, attr) || el.getAttribute(`w:${attr}`);
}

/**
 * Map <w:rPr> element to InlineStyle.
 */
export function mapRunProperties(rPr: Element): InlineStyle {
  const style: InlineStyle = {};

  if (getW(rPr, 'b')) style.bold = true;
  if (getW(rPr, 'i')) style.italic = true;
  if (getW(rPr, 'strike')) style.strikethrough = true;

  const u = getW(rPr, 'u');
  if (u) {
    const val = getWAttr(u, 'val');
    if (val && val !== 'none') style.underline = true;
  }

  const sz = getW(rPr, 'sz');
  if (sz) {
    const val = getWAttr(sz, 'val');
    if (val) style.fontSize = halfPointsToPoints(parseInt(val, 10));
  }

  const rFonts = getW(rPr, 'rFonts');
  if (rFonts) {
    const font = getWAttr(rFonts, 'ascii') || getWAttr(rFonts, 'eastAsia') || getWAttr(rFonts, 'hAnsi');
    if (font) style.fontFamily = font;
  }

  const color = getW(rPr, 'color');
  if (color) {
    const val = getWAttr(color, 'val');
    if (val && val !== 'auto') style.color = `#${val}`;
  }

  const highlight = getW(rPr, 'highlight');
  if (highlight) {
    const val = getWAttr(highlight, 'val');
    if (val) style.backgroundColor = mapHighlightColor(val);
  }

  const shd = getW(rPr, 'shd');
  if (shd && !style.backgroundColor) {
    const fill = getWAttr(shd, 'fill');
    if (fill && fill !== 'auto') style.backgroundColor = `#${fill}`;
  }

  const vertAlign = getW(rPr, 'vertAlign');
  if (vertAlign) {
    const val = getWAttr(vertAlign, 'val');
    if (val === 'superscript') style.superscript = true;
    if (val === 'subscript') style.subscript = true;
  }

  return style;
}

/**
 * Map <w:pPr> element to block style + block type metadata.
 */
export function mapParagraphProperties(pPr: Element): {
  blockStyle: BlockStyle;
  headingLevel?: number;
  blockType?: string;
} {
  const blockStyle: BlockStyle = { ...DEFAULT_BLOCK_STYLE };
  let headingLevel: number | undefined;
  let blockType: string | undefined;

  const jc = getW(pPr, 'jc');
  if (jc) {
    const val = getWAttr(jc, 'val');
    if (val === 'center') blockStyle.alignment = 'center';
    else if (val === 'right') blockStyle.alignment = 'right';
    else if (val === 'both') blockStyle.alignment = 'justify';
    else blockStyle.alignment = 'left';
  }

  const spacing = getW(pPr, 'spacing');
  if (spacing) {
    const before = getWAttr(spacing, 'before');
    if (before) blockStyle.marginTop = twipsToPx(parseInt(before, 10));
    const after = getWAttr(spacing, 'after');
    if (after) blockStyle.marginBottom = twipsToPx(parseInt(after, 10));
    const line = getWAttr(spacing, 'line');
    if (line) {
      const lineVal = parseInt(line, 10);
      // line value of 240 = single spacing (1.0)
      if (lineVal > 0) blockStyle.lineHeight = lineVal / 240;
    }
  }

  const ind = getW(pPr, 'ind');
  if (ind) {
    const firstLine = getWAttr(ind, 'firstLine');
    if (firstLine) blockStyle.textIndent = twipsToPx(parseInt(firstLine, 10));
    const left = getWAttr(ind, 'left');
    if (left) blockStyle.marginLeft = twipsToPx(parseInt(left, 10));
  }

  const pStyle = getW(pPr, 'pStyle');
  if (pStyle) {
    const val = getWAttr(pStyle, 'val');
    if (val) {
      // Common heading style IDs
      const headingMatch = val.match(/^(?:Heading|heading)(\d)$/);
      if (headingMatch) {
        headingLevel = parseInt(headingMatch[1], 10);
        blockType = 'heading';
      }
      // Korean style IDs are sometimes just numbers
      if (/^\d$/.test(val)) {
        headingLevel = parseInt(val, 10);
        blockType = 'heading';
      }
    }
  }

  return { blockStyle, headingLevel, blockType };
}

/**
 * Map <w:tcPr> to cell background and border styles.
 */
export function mapTableCellProperties(tcPr: Element): {
  backgroundColor?: string;
  borderTop?: { width: number; color: string; style: 'solid' | 'none' };
  borderBottom?: { width: number; color: string; style: 'solid' | 'none' };
  borderLeft?: { width: number; color: string; style: 'solid' | 'none' };
  borderRight?: { width: number; color: string; style: 'solid' | 'none' };
  colSpan?: number;
  vMerge?: 'restart' | 'continue';
} {
  const result: ReturnType<typeof mapTableCellProperties> = {};

  const shd = getW(tcPr, 'shd');
  if (shd) {
    const fill = getWAttr(shd, 'fill');
    if (fill && fill !== 'auto') result.backgroundColor = `#${fill}`;
  }

  const gridSpan = getW(tcPr, 'gridSpan');
  if (gridSpan) {
    const val = getWAttr(gridSpan, 'val');
    if (val) result.colSpan = parseInt(val, 10);
  }

  const vMerge = getW(tcPr, 'vMerge');
  if (vMerge) {
    const val = getWAttr(vMerge, 'val');
    result.vMerge = val === 'restart' ? 'restart' : 'continue';
  }

  const tcBorders = getW(tcPr, 'tcBorders');
  if (tcBorders) {
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const borderEl = getW(tcBorders, side);
      if (borderEl) {
        const sz = getWAttr(borderEl, 'sz');
        const color = getWAttr(borderEl, 'color');
        const val = getWAttr(borderEl, 'val');
        const key = `border${side.charAt(0).toUpperCase() + side.slice(1)}` as const;
        result[key] = {
          width: sz ? parseInt(sz, 10) / 8 : 1, // eighths of a point → px approximation
          color: color && color !== 'auto' ? `#${color}` : '#000000',
          style: val === 'none' || val === 'nil' ? 'none' : 'solid',
        };
      }
    }
  }

  return result;
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#FFFF00',
  green: '#00FF00',
  cyan: '#00FFFF',
  magenta: '#FF00FF',
  blue: '#0000FF',
  red: '#FF0000',
  darkBlue: '#00008B',
  darkCyan: '#008B8B',
  darkGreen: '#006400',
  darkMagenta: '#8B008B',
  darkRed: '#8B0000',
  darkYellow: '#808000',
  darkGray: '#A9A9A9',
  lightGray: '#D3D3D3',
  black: '#000000',
  white: '#FFFFFF',
};

export function mapHighlightColor(name: string): string {
  return HIGHLIGHT_COLORS[name] ?? '#FFFF00';
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm test -- --run test/import/docx-style-map.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/import/docx-style-map.ts packages/docs/test/import/docx-style-map.test.ts
git commit -m "Add DOCX-to-Docs style mapping functions"
```

---

### Task 9: Implement DOCX XML parser utilities

**Files:**
- Create: `packages/docs/src/import/docx-parser.ts`
- Test: `packages/docs/test/import/docx-parser.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/docs/test/import/docx-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseRelationships, parseParagraph, parsePageSetup } from '../../src/import/docx-parser.js';

describe('parseRelationships', () => {
  it('should parse document.xml.rels into rId → target map', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
    </Relationships>`;
    const rels = parseRelationships(xml);
    expect(rels.get('rId1')).toEqual({ target: 'media/image1.png', type: 'image' });
    expect(rels.get('rId2')).toEqual({ target: 'header1.xml', type: 'header' });
  });
});

describe('parseParagraph', () => {
  it('should extract text runs from a paragraph', () => {
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:r><w:t>Hello</w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> World</w:t></w:r>
    </w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines).toHaveLength(2);
    expect(result.inlines[0].text).toBe('Hello');
    expect(result.inlines[0].style.bold).toBeUndefined();
    expect(result.inlines[1].text).toBe(' World');
    expect(result.inlines[1].style.bold).toBe(true);
  });

  it('should handle empty paragraphs', () => {
    const xml = `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:p>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const result = parseParagraph(el);
    expect(result.inlines).toHaveLength(1);
    expect(result.inlines[0].text).toBe('');
  });
});

describe('parsePageSetup', () => {
  it('should parse sectPr into PageSetup', () => {
    const xml = `<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/>
    </w:sectPr>`;
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const setup = parsePageSetup(el);
    // A4 paper: 11906 twips wide ≈ 794 px
    expect(setup.paperSize.width).toBeCloseTo(794, 0);
    expect(setup.paperSize.height).toBeCloseTo(1123, 0);
    expect(setup.margins.top).toBeCloseTo(96, 0);
    expect(setup.margins.left).toBeCloseTo(72, 0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm test -- --run test/import/docx-parser.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement parser utilities**

Create `packages/docs/src/import/docx-parser.ts`:

```typescript
import type { Inline, InlineStyle, BlockStyle, Block, PageSetup, PageMargins, PaperSize } from '../model/types.js';
import { DEFAULT_BLOCK_STYLE, generateBlockId } from '../model/types.js';
import { mapRunProperties, mapParagraphProperties } from './docx-style-map.js';
import { twipsToPx } from './units.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';

export interface RelEntry {
  target: string;
  type: string;
}

/**
 * Parse a .rels XML file into a Map of relationship ID → target + type.
 */
export function parseRelationships(xml: string): Map<string, RelEntry> {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const rels = new Map<string, RelEntry>();
  const elements = doc.getElementsByTagNameNS(RELS, 'Relationship');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const id = el.getAttribute('Id') || '';
    const target = el.getAttribute('Target') || '';
    const fullType = el.getAttribute('Type') || '';
    // Extract short type from the full URI
    const type = fullType.split('/').pop() || '';
    rels.set(id, { target, type });
  }
  return rels;
}

/**
 * Parse a <w:p> element into inlines and block metadata.
 */
export function parseParagraph(pEl: Element): {
  inlines: Inline[];
  blockStyle: BlockStyle;
  blockType: string;
  headingLevel?: number;
  imageRefs: Array<{ rId: string; cx: number; cy: number }>;
} {
  let blockStyle: BlockStyle = { ...DEFAULT_BLOCK_STYLE };
  let blockType = 'paragraph';
  let headingLevel: number | undefined;
  const imageRefs: Array<{ rId: string; cx: number; cy: number }> = [];

  const pPr = pEl.getElementsByTagNameNS(W, 'pPr')[0];
  if (pPr) {
    const mapped = mapParagraphProperties(pPr);
    blockStyle = mapped.blockStyle;
    if (mapped.blockType) blockType = mapped.blockType;
    if (mapped.headingLevel) headingLevel = mapped.headingLevel;
  }

  const inlines: Inline[] = [];
  const runs = pEl.getElementsByTagNameNS(W, 'r');
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    // Check if this run is a direct child (not inside a nested element like hyperlink)
    // by verifying its parent is either the paragraph or a hyperlink
    if (r.parentElement !== pEl && r.parentElement?.localName !== 'hyperlink') {
      // Skip runs inside nested structures we don't handle
    }

    let style: InlineStyle = {};
    const rPr = r.getElementsByTagNameNS(W, 'rPr')[0];
    if (rPr) {
      style = mapRunProperties(rPr);
    }

    // Check for drawing (image)
    const drawing = r.getElementsByTagNameNS(W, 'drawing')[0];
    if (drawing) {
      const inlineDrawing = drawing.getElementsByTagNameNS(WP, 'inline')[0];
      if (inlineDrawing) {
        const extent = inlineDrawing.getElementsByTagNameNS(WP, 'extent')[0];
        const cx = extent ? parseInt(extent.getAttribute('cx') || '0', 10) : 0;
        const cy = extent ? parseInt(extent.getAttribute('cy') || '0', 10) : 0;

        const blip = inlineDrawing.getElementsByTagNameNS(A, 'blip')[0];
        const rId = blip?.getAttributeNS(R_NS, 'embed') || blip?.getAttribute('r:embed') || '';

        if (rId) {
          imageRefs.push({ rId, cx, cy });
          // Placeholder — the importer will fill in the actual URL after upload
          inlines.push({
            text: '\uFFFC',
            style: { ...style, image: { src: `__pending__:${rId}`, width: 0, height: 0 } },
          });
        }
      }
      continue;
    }

    // Regular text
    const textEls = r.getElementsByTagNameNS(W, 't');
    let text = '';
    for (let j = 0; j < textEls.length; j++) {
      text += textEls[j].textContent || '';
    }

    // Tab and break elements
    const tabs = r.getElementsByTagNameNS(W, 'tab');
    if (tabs.length > 0) text += '\t';
    const brs = r.getElementsByTagNameNS(W, 'br');
    if (brs.length > 0) text += '\n';

    if (text) {
      inlines.push({ text, style });
    }
  }

  // Ensure at least one inline (empty paragraphs)
  if (inlines.length === 0) {
    inlines.push({ text: '', style: {} });
  }

  return { inlines, blockStyle, blockType, headingLevel, imageRefs };
}

/**
 * Parse <w:sectPr> into PageSetup.
 */
export function parsePageSetup(sectPr: Element): PageSetup {
  const pgSz = sectPr.getElementsByTagNameNS(W, 'pgSz')[0];
  const pgMar = sectPr.getElementsByTagNameNS(W, 'pgMar')[0];

  let width = 816; // Letter default
  let height = 1056;
  let orientation: 'portrait' | 'landscape' = 'portrait';

  if (pgSz) {
    const w = pgSz.getAttributeNS(W, 'w') || pgSz.getAttribute('w:w');
    const h = pgSz.getAttributeNS(W, 'h') || pgSz.getAttribute('w:h');
    const orient = pgSz.getAttributeNS(W, 'orient') || pgSz.getAttribute('w:orient');
    if (w) width = Math.round(twipsToPx(parseInt(w, 10)));
    if (h) height = Math.round(twipsToPx(parseInt(h, 10)));
    if (orient === 'landscape') orientation = 'landscape';
  }

  const margins: PageMargins = { top: 96, bottom: 96, left: 96, right: 96 };
  if (pgMar) {
    const getMargin = (name: string) => {
      const val = pgMar.getAttributeNS(W, name) || pgMar.getAttribute(`w:${name}`);
      return val ? Math.round(twipsToPx(parseInt(val, 10))) : undefined;
    };
    const t = getMargin('top');     if (t !== undefined) margins.top = t;
    const b = getMargin('bottom');  if (b !== undefined) margins.bottom = b;
    const l = getMargin('left');    if (l !== undefined) margins.left = l;
    const r = getMargin('right');   if (r !== undefined) margins.right = r;
  }

  const paperSize: PaperSize = { name: 'Custom', width, height };

  return { paperSize, orientation, margins };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm test -- --run test/import/docx-parser.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/import/docx-parser.ts packages/docs/test/import/docx-parser.test.ts
git commit -m "Add DOCX XML parser utilities for paragraphs, rels, and page setup"
```

---

### Task 10: Implement DocxImporter main entry point

**Files:**
- Create: `packages/docs/src/import/docx-importer.ts`
- Test: `packages/docs/test/import/docx-importer.test.ts`
- Dependencies: `jszip` (add to packages/docs)

- [x] **Step 1: Install JSZip**

Run: `cd packages/docs && pnpm add jszip`

- [x] **Step 2: Write the failing test**

Create `packages/docs/test/import/docx-importer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DocxImporter } from '../../src/import/docx-importer.js';
import JSZip from 'jszip';

/**
 * Helper to create a minimal .docx zip in memory.
 */
async function createMinimalDocx(bodyXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <w:body>${bodyXml}</w:body>
    </w:document>`;
  zip.file('word/document.xml', docXml);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    </Relationships>`);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    </Types>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('DocxImporter', () => {
  it('should import a simple paragraph', async () => {
    const buffer = await createMinimalDocx(`
      <w:p><w:r><w:t>Hello World</w:t></w:r></w:p>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe('paragraph');
    expect(doc.blocks[0].inlines[0].text).toBe('Hello World');
  });

  it('should import multiple paragraphs', async () => {
    const buffer = await createMinimalDocx(`
      <w:p><w:r><w:t>First</w:t></w:r></w:p>
      <w:p><w:r><w:t>Second</w:t></w:r></w:p>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0].inlines[0].text).toBe('First');
    expect(doc.blocks[1].inlines[0].text).toBe('Second');
  });

  it('should import styled text runs', async () => {
    const buffer = await createMinimalDocx(`
      <w:p>
        <w:r><w:t>Normal </w:t></w:r>
        <w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r>
      </w:p>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks[0].inlines).toHaveLength(2);
    expect(doc.blocks[0].inlines[1].style.bold).toBe(true);
  });

  it('should import a simple table', async () => {
    const buffer = await createMinimalDocx(`
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc>
        </w:tr>
      </w:tbl>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0].type).toBe('table');
    expect(doc.blocks[0].tableData!.rows).toHaveLength(2);
    expect(doc.blocks[0].tableData!.rows[0].cells).toHaveLength(2);
    expect(doc.blocks[0].tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('A1');
  });

  it('should import page setup from sectPr', async () => {
    const buffer = await createMinimalDocx(`
      <w:p><w:r><w:t>Content</w:t></w:r></w:p>
      <w:sectPr>
        <w:pgSz w:w="11906" w:h="16838"/>
        <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
      </w:sectPr>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.pageSetup).toBeDefined();
    expect(doc.pageSetup!.paperSize.width).toBeCloseTo(794, 0);
    expect(doc.pageSetup!.margins.top).toBeCloseTo(96, 0);
  });

  it('should flatten nested tables to text', async () => {
    const buffer = await createMinimalDocx(`
      <w:tbl>
        <w:tblGrid><w:gridCol w:w="8000"/></w:tblGrid>
        <w:tr>
          <w:tc>
            <w:tbl>
              <w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>
              <w:tr><w:tc><w:p><w:r><w:t>Nested</w:t></w:r></w:p></w:tc></w:tr>
            </w:tbl>
          </w:tc>
        </w:tr>
      </w:tbl>
    `);
    const doc = await DocxImporter.import(buffer);
    expect(doc.blocks[0].type).toBe('table');
    // Nested table is flattened — cell should contain a paragraph with "Nested"
    const cellBlocks = doc.blocks[0].tableData!.rows[0].cells[0].blocks;
    const allText = cellBlocks.map(b => b.inlines.map(i => i.text).join('')).join('');
    expect(allText).toContain('Nested');
  });
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `cd packages/docs && pnpm test -- --run test/import/docx-importer.test.ts`
Expected: FAIL — module not found

- [x] **Step 4: Implement DocxImporter**

Create `packages/docs/src/import/docx-importer.ts`:

```typescript
import JSZip from 'jszip';
import type { Document, Block, Inline, TableData, TableRow, TableCell, HeaderFooter } from '../model/types.js';
import { generateBlockId, DEFAULT_BLOCK_STYLE, DEFAULT_CELL_STYLE, DEFAULT_HEADER_MARGIN_FROM_EDGE } from '../model/types.js';
import { parseRelationships, parseParagraph, parsePageSetup, type RelEntry } from './docx-parser.js';
import { mapTableCellProperties } from './docx-style-map.js';
import { emusToPx, twipsToPx } from './units.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

export type ImageUploader = (blob: Blob, filename: string) => Promise<string>;

export class DocxImporter {
  /**
   * Import a .docx ArrayBuffer into a Document.
   *
   * @param buffer - The .docx file as an ArrayBuffer.
   * @param imageUploader - Optional callback to upload images. If not provided,
   *   images are skipped.
   */
  static async import(
    buffer: ArrayBuffer,
    imageUploader?: ImageUploader,
  ): Promise<Document> {
    const zip = await JSZip.loadAsync(buffer);

    // Parse relationships
    const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
    const rels = relsXml ? parseRelationships(relsXml) : new Map<string, RelEntry>();

    // Parse document.xml
    const docXml = await zip.file('word/document.xml')?.async('string');
    if (!docXml) throw new Error('Invalid .docx: missing word/document.xml');
    const xmlDoc = new DOMParser().parseFromString(docXml, 'text/xml');
    const body = xmlDoc.getElementsByTagNameNS(W, 'body')[0];
    if (!body) throw new Error('Invalid .docx: missing w:body');

    // Upload images
    const imageUrls = new Map<string, { src: string; width: number; height: number }>();
    if (imageUploader) {
      await DocxImporter.uploadImages(zip, rels, imageUploader, imageUrls);
    }

    // Walk body children
    const blocks: Block[] = [];
    let pageSetup = undefined;
    for (let i = 0; i < body.childNodes.length; i++) {
      const node = body.childNodes[i];
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.localName === 'p') {
        blocks.push(DocxImporter.convertParagraph(el, imageUrls));
      } else if (el.localName === 'tbl') {
        blocks.push(DocxImporter.convertTable(el, imageUrls, false));
      } else if (el.localName === 'sectPr') {
        pageSetup = parsePageSetup(el);
      }
    }

    // Parse headers and footers
    const header = await DocxImporter.parseHeaderFooter(zip, rels, 'header', imageUrls);
    const footer = await DocxImporter.parseHeaderFooter(zip, rels, 'footer', imageUrls);

    return { blocks, pageSetup, header, footer };
  }

  private static convertParagraph(
    pEl: Element,
    imageUrls: Map<string, { src: string; width: number; height: number }>,
  ): Block {
    const { inlines, blockStyle, blockType, headingLevel } = parseParagraph(pEl);

    // Resolve pending image references
    const resolvedInlines = inlines.map((inline) => {
      if (inline.style.image?.src.startsWith('__pending__:')) {
        const rId = inline.style.image.src.replace('__pending__:', '');
        const img = imageUrls.get(rId);
        if (img) {
          return {
            text: inline.text,
            style: { ...inline.style, image: img },
          };
        }
      }
      return inline;
    });

    const block: Block = {
      id: generateBlockId(),
      type: blockType as Block['type'],
      inlines: resolvedInlines,
      style: blockStyle,
    };
    if (headingLevel) block.headingLevel = headingLevel as Block['headingLevel'];
    return block;
  }

  private static convertTable(
    tblEl: Element,
    imageUrls: Map<string, { src: string; width: number; height: number }>,
    isNested: boolean,
  ): Block {
    // If nested, flatten to a paragraph with text content
    if (isNested) {
      const texts: string[] = [];
      const trs = tblEl.getElementsByTagNameNS(W, 'tr');
      for (let r = 0; r < trs.length; r++) {
        const rowTexts: string[] = [];
        const tcs = trs[r].getElementsByTagNameNS(W, 'tc');
        for (let c = 0; c < tcs.length; c++) {
          const cellText = DocxImporter.extractText(tcs[c]);
          rowTexts.push(cellText);
        }
        texts.push(rowTexts.join(' | '));
      }
      return {
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: texts.join('\n'), style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      };
    }

    // Parse grid columns for widths
    const gridCols = tblEl.getElementsByTagNameNS(W, 'gridCol');
    const colWidthsRaw: number[] = [];
    for (let i = 0; i < gridCols.length; i++) {
      const w = gridCols[i].getAttributeNS(W, 'w') || gridCols[i].getAttribute('w:w');
      colWidthsRaw.push(w ? parseInt(w, 10) : 1);
    }
    const totalWidth = colWidthsRaw.reduce((a, b) => a + b, 0) || 1;
    const columnWidths = colWidthsRaw.map((w) => w / totalWidth);

    // Parse rows — only direct child <w:tr> elements
    const rows: TableRow[] = [];
    const vMergeTracker: Map<number, { startRow: number; count: number }> = new Map();

    for (let i = 0; i < tblEl.childNodes.length; i++) {
      const node = tblEl.childNodes[i];
      if (node.nodeType !== 1 || (node as Element).localName !== 'tr') continue;
      const trEl = node as Element;

      const cells: TableCell[] = [];
      let colIdx = 0;
      for (let j = 0; j < trEl.childNodes.length; j++) {
        const tcNode = trEl.childNodes[j];
        if (tcNode.nodeType !== 1 || (tcNode as Element).localName !== 'tc') continue;
        const tcEl = tcNode as Element;

        // Parse cell properties
        const tcPr = tcEl.getElementsByTagNameNS(W, 'tcPr')[0];
        let colSpan = 1;
        let vMerge: 'restart' | 'continue' | undefined;
        let cellProps: ReturnType<typeof mapTableCellProperties> = {};
        if (tcPr) {
          cellProps = mapTableCellProperties(tcPr);
          if (cellProps.colSpan) colSpan = cellProps.colSpan;
          vMerge = cellProps.vMerge;
        }

        // Handle vertical merge tracking
        if (vMerge === 'restart') {
          vMergeTracker.set(colIdx, { startRow: rows.length, count: 1 });
        } else if (vMerge === 'continue') {
          const tracker = vMergeTracker.get(colIdx);
          if (tracker) tracker.count++;
          // Mark as covered cell
          cells.push({
            blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
            style: { ...DEFAULT_CELL_STYLE },
            colSpan: 0, // Covered
          });
          colIdx += colSpan;
          continue;
        }

        // Parse cell content blocks
        const cellBlocks: Block[] = [];
        for (let k = 0; k < tcEl.childNodes.length; k++) {
          const childNode = tcEl.childNodes[k];
          if (childNode.nodeType !== 1) continue;
          const childEl = childNode as Element;
          if (childEl.localName === 'p') {
            cellBlocks.push(DocxImporter.convertParagraph(childEl, imageUrls));
          } else if (childEl.localName === 'tbl') {
            // Nested table → flatten to text
            cellBlocks.push(DocxImporter.convertTable(childEl, imageUrls, true));
          }
        }
        if (cellBlocks.length === 0) {
          cellBlocks.push({
            id: generateBlockId(),
            type: 'paragraph',
            inlines: [{ text: '', style: {} }],
            style: { ...DEFAULT_BLOCK_STYLE },
          });
        }

        cells.push({
          blocks: cellBlocks,
          style: {
            ...DEFAULT_CELL_STYLE,
            backgroundColor: cellProps.backgroundColor,
            borderTop: cellProps.borderTop,
            borderBottom: cellProps.borderBottom,
            borderLeft: cellProps.borderLeft,
            borderRight: cellProps.borderRight,
          },
          colSpan: colSpan > 1 ? colSpan : undefined,
        });
        colIdx += colSpan;
      }
      rows.push({ cells });
    }

    // Resolve vMerge rowSpan values
    for (const [colIdx, tracker] of vMergeTracker) {
      if (tracker.count > 1 && rows[tracker.startRow]) {
        const cell = rows[tracker.startRow].cells[colIdx];
        if (cell) cell.rowSpan = tracker.count;
      }
    }

    const tableData: TableData = { rows, columnWidths };

    return {
      id: generateBlockId(),
      type: 'table',
      inlines: [],
      style: { ...DEFAULT_BLOCK_STYLE },
      tableData,
    };
  }

  private static extractText(el: Element): string {
    const texts: string[] = [];
    const tEls = el.getElementsByTagNameNS(W, 't');
    for (let i = 0; i < tEls.length; i++) {
      texts.push(tEls[i].textContent || '');
    }
    return texts.join('');
  }

  private static async uploadImages(
    zip: JSZip,
    rels: Map<string, RelEntry>,
    uploader: ImageUploader,
    imageUrls: Map<string, { src: string; width: number; height: number }>,
  ): Promise<void> {
    for (const [rId, rel] of rels) {
      if (rel.type !== 'image') continue;
      const path = `word/${rel.target}`;
      const file = zip.file(path);
      if (!file) continue;

      const data = await file.async('blob');
      const ext = rel.target.split('.').pop() || 'png';
      const filename = `${rId}.${ext}`;
      const url = await uploader(data, filename);

      // We'll set dimensions later when resolving
      imageUrls.set(rId, { src: url, width: 0, height: 0 });
    }
  }

  private static async parseHeaderFooter(
    zip: JSZip,
    rels: Map<string, RelEntry>,
    type: 'header' | 'footer',
    imageUrls: Map<string, { src: string; width: number; height: number }>,
  ): Promise<HeaderFooter | undefined> {
    // Find the default (type 2, "default") header/footer relationship
    let targetFile: string | undefined;
    for (const [, rel] of rels) {
      if (rel.type === type) {
        targetFile = rel.target;
        break;
      }
    }
    if (!targetFile) return undefined;

    const xml = await zip.file(`word/${targetFile}`)?.async('string');
    if (!xml) return undefined;

    const xmlDoc = new DOMParser().parseFromString(xml, 'text/xml');
    const rootTag = type === 'header' ? 'hdr' : 'ftr';
    const root = xmlDoc.getElementsByTagNameNS(W, rootTag)[0];
    if (!root) return undefined;

    const blocks: Block[] = [];
    for (let i = 0; i < root.childNodes.length; i++) {
      const node = root.childNodes[i];
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.localName === 'p') {
        blocks.push(DocxImporter.convertParagraph(el, imageUrls));
      }
    }

    if (blocks.length === 0) return undefined;

    return { blocks, marginFromEdge: DEFAULT_HEADER_MARGIN_FROM_EDGE };
  }
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `cd packages/docs && pnpm test -- --run test/import/docx-importer.test.ts`
Expected: PASS

- [x] **Step 6: Run full test suite**

Run: `pnpm verify:fast`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add packages/docs/src/import/ packages/docs/test/import/ packages/docs/package.json pnpm-lock.yaml
git commit -m $'Implement DocxImporter for .docx to Document conversion\n\nSupports paragraphs, styled text, tables with cell merge,\npage setup, headers/footers, and nested table flattening.\nImages are uploaded via a pluggable callback.'
```

---

## Phase 3 — DOCX Export

### Task 11: Implement DOCX export style mapping (Docs → OOXML)

**Files:**
- Create: `packages/docs/src/export/docx-style-map.ts`
- Test: `packages/docs/test/export/docx-style-map.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/docs/test/export/docx-style-map.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildRunPropertiesXml, buildParagraphPropertiesXml } from '../../src/export/docx-style-map.js';

describe('buildRunPropertiesXml', () => {
  it('should generate bold tag', () => {
    const xml = buildRunPropertiesXml({ bold: true });
    expect(xml).toContain('<w:b/>');
  });

  it('should generate font size in half-points', () => {
    const xml = buildRunPropertiesXml({ fontSize: 12 });
    expect(xml).toContain('<w:sz w:val="24"/>');
    expect(xml).toContain('<w:szCs w:val="24"/>');
  });

  it('should generate font family', () => {
    const xml = buildRunPropertiesXml({ fontFamily: 'Arial' });
    expect(xml).toContain('w:ascii="Arial"');
  });

  it('should generate color', () => {
    const xml = buildRunPropertiesXml({ color: '#FF0000' });
    expect(xml).toContain('<w:color w:val="FF0000"/>');
  });

  it('should return empty string for empty style', () => {
    const xml = buildRunPropertiesXml({});
    expect(xml).toBe('');
  });
});

describe('buildParagraphPropertiesXml', () => {
  it('should generate center alignment', () => {
    const xml = buildParagraphPropertiesXml({ alignment: 'center', lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 });
    expect(xml).toContain('<w:jc w:val="center"/>');
  });

  it('should generate justify as "both"', () => {
    const xml = buildParagraphPropertiesXml({ alignment: 'justify', lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 });
    expect(xml).toContain('<w:jc w:val="both"/>');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm test -- --run test/export/docx-style-map.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Implement export style mapping**

Create `packages/docs/src/export/docx-style-map.ts`:

```typescript
import type { InlineStyle, BlockStyle } from '../model/types.js';
import { pointsToHalfPoints, pxToTwips } from '../import/units.js';

/**
 * Build <w:rPr>...</w:rPr> XML from InlineStyle.
 * Returns empty string if no properties to set.
 */
export function buildRunPropertiesXml(style: InlineStyle): string {
  const parts: string[] = [];

  if (style.fontFamily) {
    parts.push(`<w:rFonts w:ascii="${style.fontFamily}" w:hAnsi="${style.fontFamily}" w:eastAsia="${style.fontFamily}"/>`);
  }
  if (style.bold) parts.push('<w:b/>');
  if (style.italic) parts.push('<w:i/>');
  if (style.underline) parts.push('<w:u w:val="single"/>');
  if (style.strikethrough) parts.push('<w:strike/>');
  if (style.fontSize) {
    const hp = pointsToHalfPoints(style.fontSize);
    parts.push(`<w:sz w:val="${hp}"/>`);
    parts.push(`<w:szCs w:val="${hp}"/>`);
  }
  if (style.color) {
    const hex = style.color.replace('#', '');
    parts.push(`<w:color w:val="${hex}"/>`);
  }
  if (style.backgroundColor) {
    const hex = style.backgroundColor.replace('#', '');
    parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`);
  }
  if (style.superscript) parts.push('<w:vertAlign w:val="superscript"/>');
  if (style.subscript) parts.push('<w:vertAlign w:val="subscript"/>');

  if (parts.length === 0) return '';
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

/**
 * Build <w:pPr>...</w:pPr> XML from BlockStyle.
 */
export function buildParagraphPropertiesXml(
  style: BlockStyle,
  headingLevel?: number,
): string {
  const parts: string[] = [];

  if (headingLevel) {
    parts.push(`<w:pStyle w:val="Heading${headingLevel}"/>`);
  }

  const align = style.alignment === 'justify' ? 'both' : style.alignment;
  if (align !== 'left') {
    parts.push(`<w:jc w:val="${align}"/>`);
  }

  const spacingParts: string[] = [];
  if (style.marginTop > 0) spacingParts.push(`w:before="${Math.round(pxToTwips(style.marginTop))}"`);
  if (style.marginBottom > 0) spacingParts.push(`w:after="${Math.round(pxToTwips(style.marginBottom))}"`);
  if (style.lineHeight !== 1.5) spacingParts.push(`w:line="${Math.round(style.lineHeight * 240)}"`);
  if (spacingParts.length > 0) parts.push(`<w:spacing ${spacingParts.join(' ')}/>`);

  const indParts: string[] = [];
  if (style.textIndent > 0) indParts.push(`w:firstLine="${Math.round(pxToTwips(style.textIndent))}"`);
  if (style.marginLeft > 0) indParts.push(`w:left="${Math.round(pxToTwips(style.marginLeft))}"`);
  if (indParts.length > 0) parts.push(`<w:ind ${indParts.join(' ')}/>`);

  if (parts.length === 0) return '';
  return `<w:pPr>${parts.join('')}</w:pPr>`;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd packages/docs && pnpm test -- --run test/export/docx-style-map.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/docs/src/export/docx-style-map.ts packages/docs/test/export/docx-style-map.test.ts
git commit -m "Add Docs-to-OOXML style mapping for export"
```

---

### Task 12: Implement DocxExporter

**Files:**
- Create: `packages/docs/src/export/docx-exporter.ts`
- Create: `packages/docs/src/export/docx-templates.ts`
- Test: `packages/docs/test/export/docx-exporter.test.ts`

- [x] **Step 1: Write the failing tests**

Create `packages/docs/test/export/docx-exporter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DocxExporter } from '../../src/export/docx-exporter.js';
import { DocxImporter } from '../../src/import/docx-importer.js';
import type { Document } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE, DEFAULT_PAGE_SETUP, generateBlockId } from '../../src/model/types.js';

describe('DocxExporter', () => {
  it('should export a simple paragraph and re-import it', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'Hello World', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const blob = await DocxExporter.export(doc);
    expect(blob.size).toBeGreaterThan(0);

    // Re-import and verify round-trip
    const buffer = await blob.arrayBuffer();
    const reimported = await DocxImporter.import(buffer);
    expect(reimported.blocks).toHaveLength(1);
    expect(reimported.blocks[0].inlines[0].text).toBe('Hello World');
  });

  it('should export styled text', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [
          { text: 'Normal ', style: {} },
          { text: 'Bold', style: { bold: true } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const buffer = await blob.arrayBuffer();
    const reimported = await DocxImporter.import(buffer);
    expect(reimported.blocks[0].inlines).toHaveLength(2);
    expect(reimported.blocks[0].inlines[1].style.bold).toBe(true);
  });

  it('should export a table', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'table',
        inlines: [],
        style: { ...DEFAULT_BLOCK_STYLE },
        tableData: {
          rows: [{
            cells: [
              { blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: 'A1', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], style: {} },
              { blocks: [{ id: generateBlockId(), type: 'paragraph', inlines: [{ text: 'B1', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }], style: {} },
            ],
          }],
          columnWidths: [0.5, 0.5],
        },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const buffer = await blob.arrayBuffer();
    const reimported = await DocxImporter.import(buffer);
    expect(reimported.blocks[0].type).toBe('table');
    expect(reimported.blocks[0].tableData!.rows[0].cells[0].blocks[0].inlines[0].text).toBe('A1');
  });

  it('should produce a valid .docx zip', async () => {
    const doc: Document = {
      blocks: [{
        id: generateBlockId(),
        type: 'paragraph',
        inlines: [{ text: 'Test', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }],
    };

    const blob = await DocxExporter.export(doc);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('_rels/.rels')).not.toBeNull();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd packages/docs && pnpm test -- --run test/export/docx-exporter.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Create XML template strings**

Create `packages/docs/src/export/docx-templates.ts`:

```typescript
/**
 * Static OOXML boilerplate templates for .docx export.
 */

export const CONTENT_TYPES = (extras: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="gif" ContentType="image/gif"/>
  <Default Extension="webp" ContentType="image/webp"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
${extras}</Types>`;

export const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr>
  </w:style>
</w:styles>`;

export const DOC_RELS = (extras: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${extras}</Relationships>`;
```

- [x] **Step 4: Implement DocxExporter**

Create `packages/docs/src/export/docx-exporter.ts`:

```typescript
import JSZip from 'jszip';
import type { Document, Block, Inline, TableData, PageSetup, HeaderFooter } from '../model/types.js';
import { DEFAULT_PAGE_SETUP } from '../model/types.js';
import { buildRunPropertiesXml, buildParagraphPropertiesXml } from './docx-style-map.js';
import { pxToTwips, pxToEmus, pointsToHalfPoints } from '../import/units.js';
import { CONTENT_TYPES, ROOT_RELS, STYLES, DOC_RELS } from './docx-templates.js';

export type ImageFetcher = (url: string) => Promise<Blob>;

export class DocxExporter {
  /**
   * Export a Document to a .docx Blob.
   */
  static async export(
    doc: Document,
    imageFetcher?: ImageFetcher,
  ): Promise<Blob> {
    const zip = new JSZip();
    const imageEntries: Array<{ rId: string; path: string; ext: string }> = [];
    let rIdCounter = 10; // Start after reserved IDs

    // Collect and fetch images
    if (imageFetcher) {
      for (const block of doc.blocks) {
        await DocxExporter.collectImages(block, imageFetcher, zip, imageEntries, () => `rId${rIdCounter++}`);
      }
    }

    // Build header/footer
    const hfRels: string[] = [];
    const hfContentTypes: string[] = [];
    let headerRId: string | undefined;
    let footerRId: string | undefined;

    if (doc.header && doc.header.blocks.length > 0) {
      headerRId = `rId${rIdCounter++}`;
      const headerXml = DocxExporter.buildHeaderFooterXml(doc.header, 'header');
      zip.file('word/header1.xml', headerXml);
      hfRels.push(`  <Relationship Id="${headerRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`);
      hfContentTypes.push(`  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`);
    }
    if (doc.footer && doc.footer.blocks.length > 0) {
      footerRId = `rId${rIdCounter++}`;
      const footerXml = DocxExporter.buildHeaderFooterXml(doc.footer, 'footer');
      zip.file('word/footer1.xml', footerXml);
      hfRels.push(`  <Relationship Id="${footerRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`);
      hfContentTypes.push(`  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`);
    }

    // Build document.xml
    const bodyXml = doc.blocks.map((b) => DocxExporter.blockToXml(b, imageEntries)).join('\n');
    const sectPr = DocxExporter.buildSectPrXml(doc.pageSetup ?? DEFAULT_PAGE_SETUP, headerRId, footerRId);
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
${bodyXml}
    ${sectPr}
  </w:body>
</w:document>`;

    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', STYLES);

    // Relationships
    const imageRels = imageEntries.map((e) =>
      `  <Relationship Id="${e.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${e.path}"/>`
    );
    zip.file('word/_rels/document.xml.rels', DOC_RELS([...imageRels, ...hfRels].join('\n')));
    zip.file('_rels/.rels', ROOT_RELS);
    zip.file('[Content_Types].xml', CONTENT_TYPES(hfContentTypes.join('\n')));

    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  private static blockToXml(
    block: Block,
    imageEntries: Array<{ rId: string; path: string; ext: string }>,
  ): string {
    if (block.type === 'table' && block.tableData) {
      return DocxExporter.tableToXml(block.tableData, imageEntries);
    }
    if (block.type === 'page-break') {
      return `    <w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    }
    if (block.type === 'horizontal-rule') {
      return `    <w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>`;
    }

    const pPr = buildParagraphPropertiesXml(
      block.style,
      block.type === 'heading' ? block.headingLevel : undefined,
    );
    const runs = block.inlines.map((inline) => DocxExporter.inlineToXml(inline, imageEntries)).join('');
    return `    <w:p>${pPr}${runs}</w:p>`;
  }

  private static inlineToXml(
    inline: Inline,
    imageEntries: Array<{ rId: string; path: string; ext: string }>,
  ): string {
    // Image inline
    if (inline.style.image) {
      const entry = imageEntries.find((e) => e.rId && inline.style.image?.src.includes(e.path.replace('media/', '')));
      if (entry) {
        const cx = pxToEmus(inline.style.image.width);
        const cy = pxToEmus(inline.style.image.height);
        return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${Math.round(cx)}" cy="${Math.round(cy)}"/>
          <wp:docPr id="1" name="Image"/>
          <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="Image"/><pic:cNvPicPr/></pic:nvPicPr>
            <pic:blipFill><a:blip r:embed="${entry.rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
            <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
          </a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      }
    }

    // Regular text run
    const rPr = buildRunPropertiesXml(inline.style);
    const escapedText = inline.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<w:r>${rPr}<w:t xml:space="preserve">${escapedText}</w:t></w:r>`;
  }

  private static tableToXml(
    tableData: TableData,
    imageEntries: Array<{ rId: string; path: string; ext: string }>,
  ): string {
    // Compute grid col widths in twips (assume total page width ~9000 twips)
    const totalTwips = 9000;
    const gridCols = tableData.columnWidths
      .map((w) => `<w:gridCol w:w="${Math.round(w * totalTwips)}"/>`)
      .join('');

    const rows = tableData.rows.map((row) => {
      const cells = row.cells.map((cell) => {
        if (cell.colSpan === 0) {
          // Covered cell (vMerge continue)
          return `<w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>`;
        }

        const tcPrParts: string[] = [];
        if (cell.colSpan && cell.colSpan > 1) tcPrParts.push(`<w:gridSpan w:val="${cell.colSpan}"/>`);
        if (cell.rowSpan && cell.rowSpan > 1) tcPrParts.push(`<w:vMerge w:val="restart"/>`);
        if (cell.style.backgroundColor) {
          const hex = cell.style.backgroundColor.replace('#', '');
          tcPrParts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`);
        }
        const tcPr = tcPrParts.length > 0 ? `<w:tcPr>${tcPrParts.join('')}</w:tcPr>` : '';

        const cellContent = cell.blocks
          .map((b) => DocxExporter.blockToXml(b, imageEntries))
          .join('');
        return `<w:tc>${tcPr}${cellContent || '<w:p/>'}</w:tc>`;
      }).join('');
      return `<w:tr>${cells}</w:tr>`;
    }).join('');

    return `    <w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${rows}</w:tbl>`;
  }

  private static buildSectPrXml(
    setup: PageSetup,
    headerRId?: string,
    footerRId?: string,
  ): string {
    const w = Math.round(pxToTwips(setup.paperSize.width));
    const h = Math.round(pxToTwips(setup.paperSize.height));
    const orient = setup.orientation === 'landscape' ? ' w:orient="landscape"' : '';
    const pgSz = `<w:pgSz w:w="${w}" w:h="${h}"${orient}/>`;
    const pgMar = `<w:pgMar w:top="${Math.round(pxToTwips(setup.margins.top))}" w:right="${Math.round(pxToTwips(setup.margins.right))}" w:bottom="${Math.round(pxToTwips(setup.margins.bottom))}" w:left="${Math.round(pxToTwips(setup.margins.left))}" w:header="720" w:footer="720"/>`;

    const refs: string[] = [];
    if (headerRId) refs.push(`<w:headerReference w:type="default" r:id="${headerRId}"/>`);
    if (footerRId) refs.push(`<w:footerReference w:type="default" r:id="${footerRId}"/>`);

    return `<w:sectPr>${refs.join('')}${pgSz}${pgMar}</w:sectPr>`;
  }

  private static buildHeaderFooterXml(hf: HeaderFooter, type: 'header' | 'footer'): string {
    const tag = type === 'header' ? 'hdr' : 'ftr';
    const blocks = hf.blocks.map((b) => DocxExporter.blockToXml(b, [])).join('\n');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${blocks}
</w:${tag}>`;
  }

  private static async collectImages(
    block: Block,
    fetcher: ImageFetcher,
    zip: JSZip,
    entries: Array<{ rId: string; path: string; ext: string }>,
    nextRId: () => string,
  ): Promise<void> {
    for (const inline of block.inlines) {
      if (inline.style.image) {
        const blob = await fetcher(inline.style.image.src);
        const ext = inline.style.image.src.split('.').pop() || 'png';
        const rId = nextRId();
        const path = `media/image_${rId}.${ext}`;
        zip.file(`word/${path}`, blob);
        entries.push({ rId, path, ext });
      }
    }
    // Also check table cells
    if (block.tableData) {
      for (const row of block.tableData.rows) {
        for (const cell of row.cells) {
          for (const cellBlock of cell.blocks) {
            await DocxExporter.collectImages(cellBlock, fetcher, zip, entries, nextRId);
          }
        }
      }
    }
  }
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `cd packages/docs && pnpm test -- --run test/export/docx-exporter.test.ts`
Expected: PASS

- [x] **Step 6: Run full test suite**

Run: `pnpm verify:fast`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add packages/docs/src/export/ packages/docs/test/export/
git commit -m $'Implement DocxExporter for Document to .docx conversion\n\nSupports paragraphs, styled text, tables with cell merge,\npage setup, headers/footers, page breaks, and image embedding.'
```

---

## Phase 4 — Frontend Integration

### Task 13: Add Import DOCX button to frontend

**Files:**
- Modify: `packages/frontend/src/app/docs/docs-formatting-toolbar.tsx` (or appropriate toolbar/menu file)
- Modify: `packages/frontend/src/app/docs/docs-detail.tsx`

This task wires the DocxImporter into the frontend UI. The exact component locations depend on the current toolbar structure.

- [x] **Step 1: Add import handler function**

Create an import handler that:
1. Opens a file picker filtered to `.docx`
2. Reads the file as `ArrayBuffer`
3. Calls `DocxImporter.import(buffer, imageUploader)`
4. Creates a new document via the backend API
5. Sets the imported Document as content via `store.setDocument()`
6. Navigates to the new document

```typescript
async function handleImportDocx() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.docx';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();

    const imageUploader = async (blob: Blob, filename: string): Promise<string> => {
      const formData = new FormData();
      formData.append('file', blob, filename);
      const res = await fetch('/images', { method: 'POST', body: formData });
      const { url } = await res.json();
      return url;
    };

    const doc = await DocxImporter.import(buffer, imageUploader);
    // Create document and load content
    // ... (depends on existing document creation flow)
  };
  input.click();
}
```

- [x] **Step 2: Add export handler function**

```typescript
async function handleExportDocx(store: DocStore) {
  const doc = store.getDocument();
  const imageFetcher = async (url: string): Promise<Blob> => {
    const res = await fetch(url);
    return res.blob();
  };
  const blob = await DocxExporter.export(doc, imageFetcher);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'document.docx';
  a.click();
  URL.revokeObjectURL(a.href);
}
```

- [x] **Step 3: Add UI buttons**

Add "Import DOCX" and "Export as DOCX" buttons to the appropriate toolbar or menu. Follow existing button patterns in the codebase.

- [x] **Step 4: Run typecheck and verify**

Run: `pnpm verify:fast`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add packages/frontend/src/app/docs/
git commit -m "Add Import DOCX and Export as DOCX buttons to docs editor"
```

---

## Summary

| Task | Phase | Description |
|------|-------|-------------|
| 1 | 1 | ImageData type + InlineStyle.image field |
| 2 | 1 | Doc.insertImageInline method |
| 3 | 1 | Yorkie image serialization |
| 4 | 1 | Canvas image layout + rendering |
| 5 | 1 | MinIO + ImageModule backend |
| 6 | 1 | Font registry + web font loading |
| 7 | 2 | Unit conversion utilities |
| 8 | 2 | DOCX → Docs style mapping |
| 9 | 2 | DOCX XML parser utilities |
| 10 | 2 | DocxImporter main entry point |
| 11 | 3 | Docs → OOXML style mapping |
| 12 | 3 | DocxExporter main entry point |
| 13 | 4 | Frontend import/export buttons |
