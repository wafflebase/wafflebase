# PDF Phase 2 (Share + Comments + Presence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a PDF document be shared via a link and annotated with page-anchored comments (with live presence), reusing the existing share-link, comments, and presence infrastructure.

**Architecture:** Phase 1 (upload/store/view) already ships. This plan attaches the reserved `pdf-<id>` Yorkie document for the first time (holding only comment threads + presence; PDF bytes stay in the blob), adds a page-region comment anchor to the shared comments module, wires the viewer into `YorkieProvider`/`DocumentProvider`, and closes the one net-new backend gap: making the file-serving endpoint accept a share token (member **OR** valid share token). The shared PDF route reuses the existing `/shared/:token` machinery.

**Tech Stack:** NestJS + Prisma (backend), React 19 + Vite + Yorkie (`@yorkie-js/react`) + pdf.js (frontend), Vitest (frontend/unit), Jest (backend e2e).

## Global Constraints

- Spec: `docs/design/pdf.md` (Phase 2 section) — the authoritative reference.
- **No PDF bytes in Yorkie.** The `pdf-<id>` Yorkie document holds only `comments` (+ presence); the original file stays in the blob and is served by `GET /documents/:id/file`.
- **Serving is role-agnostic; comment *writes* are role-gated (client-side only).** `viewer` and `editor` share roles may both view the PDF. Only `editor`/members may post comments; enforcement is client-side, matching every other shared document type (see `sharing.md`).
- **Seed `comments: {}` at bootstrap**, never lazily — concurrent lazy creation lets Yorkie LWW discard a client's threads.
- **Yorkie timestamps must be BigInt** (`toYorkieMs`) — Yorkie stores plain JS ints as 32-bit.
- **`pdfjs-dist` stays lazy-imported** inside the viewer route (chunk gate in `harness.config.json`). Do not add a static `pdfjs-dist` import to any always-loaded module.
- Normalized anchor coordinates: `rect` is `{ x, y, w, h }` in `[0,1]`, page-relative, so pins are zoom/scale independent. `pageIndex` is 0-based.
- Run `pnpm install` before starting (the working tree is missing `pdfjs-dist`; without it `pnpm frontend test` fails on the Phase 1 `pdf-viewer.test.tsx`).
- Repo artifacts (code comments, commits) in English. Commit subject ≤70 chars, body explains why.

---

## File Structure

**Backend (Slice 1):**
- Create: `packages/backend/src/auth/optional-jwt-auth.guard.ts` — JWT guard that resolves the user when a valid cookie/token is present but never rejects anonymous requests.
- Create: `packages/backend/src/document/document-file.controller.ts` — the single anonymous-capable route `GET documents/:id/file` (member OR share token).
- Modify: `packages/backend/src/document/document.controller.ts` — remove the `getDocumentFile` method (moves to the new controller).
- Modify: `packages/backend/src/document/document.module.ts` — register the new controller; import `ShareLinkModule`.
- Test: `packages/backend/test/document-file-serving.e2e-spec.ts`.

**Frontend types + store (Slice 2):**
- Modify: `packages/frontend/src/types/comments.ts` — add `PdfRegionAnchor` to the `CommentAnchor` union.
- Create: `packages/frontend/src/types/pdf-document.ts` — `YorkiePdfRoot` + `initialPdfRoot()`.
- Create: `packages/frontend/src/app/files/comments/pdf-comment-store.ts` — `PdfCommentStore implements CommentStore<PdfRegionAnchor>`.
- Test: `packages/frontend/tests/app/files/pdf-comment-store.test.ts`.

**Frontend comment UI + presence (Slices 3–4):**
- Create: `packages/frontend/src/app/files/comments/rect.ts` — pure normalized-rect ↔ pixel helpers.
- Create: `packages/frontend/src/app/files/comments/pdf-comments-controller.ts` — `usePdfComments` hook (store ⇄ panel/pins state).
- Create: `packages/frontend/src/app/files/pdf-comment-layer.tsx` — pin overlay + drag-to-create over the pages.
- Modify: `packages/frontend/src/app/files/pdf-viewer.tsx` — expose an overlay slot + active-page callback.
- Modify: `packages/frontend/src/types/users.ts` — add `PdfPresence`.
- Test: `packages/frontend/tests/app/files/rect.test.ts`, `packages/frontend/tests/app/files/pdf-comment-layer.test.tsx`.

**Frontend route wiring (Slice 5):**
- Create: `packages/frontend/src/app/files/pdf-collab.tsx` — shared `PdfCollab` shell (providers + viewer + comments + presence), used by both the owner route and the shared route.
- Modify: `packages/frontend/src/app/files/file-detail.tsx` — mount `PdfCollab`; add owner Share button.
- Modify: `packages/frontend/src/app/shared/shared-document.tsx` — add a `pdf` case.
- Modify: `packages/frontend/src/api/files.ts` — `pdfFileUrl(documentId, token?)`.

---

## Slice 1 — Share-token-aware file serving

### Task 1: `OptionalJwtAuthGuard`

**Files:**
- Create: `packages/backend/src/auth/optional-jwt-auth.guard.ts`

**Interfaces:**
- Produces: `class OptionalJwtAuthGuard extends AuthGuard('jwt')` whose `handleRequest(err, user)` returns `user ?? undefined` and never throws. On a valid session `req.user` is populated; on anonymous requests `req.user` is `undefined`.

- [ ] **Step 1: Read the existing guard to match the strategy name**

Run: `cat packages/backend/src/auth/jwt-auth.guard.ts`
Expected: it is `export class JwtAuthGuard extends AuthGuard('jwt') {}`. Confirm the passport strategy name is `'jwt'`.

- [ ] **Step 2: Write the guard**

```ts
// packages/backend/src/auth/optional-jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT guard that populates `req.user` when a valid session cookie/token is
 * present but, unlike `JwtAuthGuard`, does not reject anonymous requests.
 * Used by routes that must serve both members (via JWT) and unauthenticated
 * share-link viewers (via a share token checked in the handler).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return (user ?? undefined) as TUser;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/auth/optional-jwt-auth.guard.ts
git commit -m "Add OptionalJwtAuthGuard for anonymous-capable routes"
```

### Task 2: `DocumentFileController` — member OR share token

**Files:**
- Create: `packages/backend/src/document/document-file.controller.ts`
- Modify: `packages/backend/src/document/document.controller.ts` (remove `getDocumentFile`, lines 119-144)
- Modify: `packages/backend/src/document/document.module.ts`
- Test: `packages/backend/test/document-file-serving.e2e-spec.ts`

**Interfaces:**
- Consumes: `OptionalJwtAuthGuard` (Task 1); `ShareLinkService.findByToken(token)` (throws `NotFoundException`/`GoneException`); `DocumentService.document({ id })`; `WorkspaceService.assertMember`; `FileService.getObject(fileId)`; `VALID_FILE_ID_PATTERN`.
- Produces: `GET documents/:id/file[?token=<shareToken>]` streaming `application/pdf`.

- [ ] **Step 1: Write the failing e2e test**

Model imports/bootstrap on `packages/backend/test/share-link.e2e-spec.ts` (same DB gate). Create a workspace + owner user + a `pdf` document with a real `fileId` blob (upload via `FileService` or seed a MinIO object in `beforeAll`), a member, a non-member, and share links (unexpired + expired).

```ts
// packages/backend/test/document-file-serving.e2e-spec.ts (essential cases)
describe('GET /documents/:id/file', () => {
  it('serves the PDF to a workspace member (JWT)', async () => {
    await request(server)
      .get(`/documents/${pdfDocId}/file`)
      .set('Cookie', memberCookie)
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
  });

  it('serves the PDF for a valid unexpired share token (anonymous)', async () => {
    await request(server)
      .get(`/documents/${pdfDocId}/file?token=${validToken}`)
      .expect(200);
  });

  it('rejects an expired share token', async () => {
    await request(server)
      .get(`/documents/${pdfDocId}/file?token=${expiredToken}`)
      .expect(410);
  });

  it('rejects a token whose documentId differs from :id', async () => {
    await request(server)
      .get(`/documents/${otherPdfDocId}/file?token=${validToken}`)
      .expect(403);
  });

  it('rejects an anonymous request with no token', async () => {
    await request(server).get(`/documents/${pdfDocId}/file`).expect(403);
  });

  it('rejects a non-member with no token', async () => {
    await request(server)
      .get(`/documents/${pdfDocId}/file`)
      .set('Cookie', nonMemberCookie)
      .expect(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `RUN_DB_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e -- document-file-serving`
Expected: FAIL — routes still require JWT / no token handling yet (`?token=` anonymous request 401/403 mismatch, or the controller isn't registered).

- [ ] **Step 3: Write the controller**

```ts
// packages/backend/src/document/document-file.controller.ts
import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { DocumentService } from './document.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { ShareLinkService } from '../share-link/share-link.service';
import { FileService } from '../file/file.service';
import { VALID_FILE_ID_PATTERN } from '../file/file.constants';

/**
 * The one document route that serves both workspace members (JWT) and
 * anonymous share-link viewers (`?token=`). It lives in its own controller
 * so the rest of `DocumentController` stays strictly JWT-gated at the class
 * level; here we resolve access manually.
 */
@Controller()
@UseGuards(OptionalJwtAuthGuard)
export class DocumentFileController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly workspaceService: WorkspaceService,
    private readonly shareLinkService: ShareLinkService,
    private readonly fileService: FileService,
  ) {}

  @Get('documents/:id/file')
  async getDocumentFile(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Req() req: { user?: { id: number | string } },
    @Res() res: Response,
  ): Promise<void> {
    const doc = await this.documentService.document({ id });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    await this.assertCanRead(doc.workspaceId, id, req.user?.id, token);

    if (!doc.fileId || !VALID_FILE_ID_PATTERN.test(doc.fileId)) {
      throw new NotFoundException('Document has no file');
    }
    const { body, contentType } = await this.fileService.getObject(doc.fileId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.end(Buffer.from(body));
  }

  /**
   * Read access = workspace member (via JWT) OR a valid, unexpired share
   * token whose `documentId` matches this document. Share role is irrelevant
   * for viewing the bytes; it only gates comment writes (client-side).
   */
  private async assertCanRead(
    workspaceId: string,
    documentId: string,
    userId: number | string | undefined,
    token: string | undefined,
  ): Promise<void> {
    if (userId !== undefined) {
      try {
        await this.workspaceService.assertMember(workspaceId, Number(userId));
        return;
      } catch {
        // Fall through to the share-token path.
      }
    }
    if (token) {
      // findByToken throws NotFoundException / GoneException(410) itself.
      const link = await this.shareLinkService.findByToken(token);
      if (link.documentId === documentId) return;
    }
    throw new ForbiddenException('Not allowed to read this document');
  }
}
```

- [ ] **Step 4: Remove the old route and register the new controller**

Delete `getDocumentFile` (lines 119-144) from `packages/backend/src/document/document.controller.ts`. If `FileService`/`VALID_FILE_ID_PATTERN` become unused there, leave them — `deleteDocument` still uses both, so no other change is needed.

In `packages/backend/src/document/document.module.ts`, import `ShareLinkModule` and add `DocumentFileController` to `controllers`:

```ts
import { ShareLinkModule } from '../share-link/share-link.module';
import { DocumentFileController } from './document-file.controller';
// ...
@Module({
  imports: [/* existing */, ShareLinkModule],
  controllers: [DocumentController, DocumentFileController],
  // providers unchanged
})
```

Verify `ShareLinkModule` exports `ShareLinkService` (check `packages/backend/src/share-link/share-link.module.ts`; add it to `exports` if missing).

- [ ] **Step 5: Run the test to verify it passes**

Run: `RUN_DB_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e -- document-file-serving`
Expected: PASS — all six cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/document/document-file.controller.ts \
  packages/backend/src/document/document.controller.ts \
  packages/backend/src/document/document.module.ts \
  packages/backend/test/document-file-serving.e2e-spec.ts
git commit -m "Serve PDF file to members or valid share-token viewers"
```

---

## Slice 2 — `pdf-<id>` Yorkie document + comment store

### Task 3: `PdfRegionAnchor` type + `YorkiePdfRoot`

**Files:**
- Modify: `packages/frontend/src/types/comments.ts`
- Create: `packages/frontend/src/types/pdf-document.ts`

**Interfaces:**
- Produces:
  - `PdfRegionAnchor = { kind: 'pdf-region'; pageIndex: number; rect: PdfRect }` where `PdfRect = { x: number; y: number; w: number; h: number }` (all in `[0,1]`).
  - `CommentAnchor` union now includes `PdfRegionAnchor`.
  - `YorkiePdfRoot = { comments?: { [threadId: string]: Thread<PdfRegionAnchor> } }`.
  - `initialPdfRoot(): Partial<YorkiePdfRoot>` returning `{ comments: {} }`.

- [ ] **Step 1: Add the anchor variant**

In `packages/frontend/src/types/comments.ts`, add above the `CommentAnchor` union:

```ts
/** A rectangle in [0,1] page-relative coordinates (zoom/scale independent). */
export type PdfRect = { x: number; y: number; w: number; h: number };

/**
 * PDF region anchor — a rectangle on a given page. Unlike docs ranges, a
 * PDF anchor never moves (pages/coordinates are static), so it never
 * orphans except when `pageIndex` is out of range for the loaded file.
 */
export type PdfRegionAnchor = {
  kind: 'pdf-region';
  pageIndex: number;
  rect: PdfRect;
};
```

Then extend the union:

```ts
export type CommentAnchor = SheetCellAnchor | DocsRangeAnchor | PdfRegionAnchor;
```

- [ ] **Step 2: Create the PDF Yorkie root**

```ts
// packages/frontend/src/types/pdf-document.ts
import type { PdfRegionAnchor, Thread } from '@/types/comments.ts';

/**
 * Yorkie document root for a PDF document. It holds ONLY comment threads —
 * the PDF bytes live in the blob store and are served by
 * `GET /documents/:id/file`. `comments` is seeded empty at bootstrap so
 * concurrent first-comment inserts merge instead of racing to create the
 * container (Yorkie resolves same-key object assignment by LWW).
 */
export type YorkiePdfRoot = {
  comments?: { [threadId: string]: Thread<PdfRegionAnchor> };
};

export function initialPdfRoot(): Partial<YorkiePdfRoot> {
  return { comments: {} };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @wafflebase/frontend exec tsc -b`
Expected: PASS — the union widening compiles; existing sheet/docs consumers narrow on `kind` and are unaffected.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/types/comments.ts packages/frontend/src/types/pdf-document.ts
git commit -m "Add pdf-region comment anchor and YorkiePdfRoot"
```

### Task 4: `PdfCommentStore`

**Files:**
- Create: `packages/frontend/src/app/files/comments/pdf-comment-store.ts`
- Test: `packages/frontend/tests/app/files/pdf-comment-store.test.ts`

**Interfaces:**
- Consumes: `Document<YorkiePdfRoot>` from `@yorkie-js/react`; `CommentStore<PdfRegionAnchor>` from `@/components/comments/comment-store.ts`; `Comment`, `CommentAuthor`, `PdfRegionAnchor`, `Thread` from `@/types/comments.ts`.
- Produces: `class PdfCommentStore implements CommentStore<PdfRegionAnchor>` with a constructor `(doc, opts?: { newId?; now? })`, and a `dispose()` method. `addThread(anchor, body, author)` takes the stored `PdfRegionAnchor` directly (no path resolution).

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/tests/app/files/pdf-comment-store.test.ts
import { describe, it, expect } from 'vitest';
import { Document } from '@yorkie-js/sdk';
import { PdfCommentStore } from '@/app/files/comments/pdf-comment-store';
import { initialPdfRoot, type YorkiePdfRoot } from '@/types/pdf-document';
import type { PdfRegionAnchor } from '@/types/comments';

function makeDoc(): Document<YorkiePdfRoot> {
  const doc = new Document<YorkiePdfRoot>('pdf-test');
  doc.update((root) => {
    // Mirror initialRoot seeding for a local (unattached) doc.
    if (!root.comments) root.comments = initialPdfRoot().comments!;
  });
  return doc;
}
const author = { userId: '1', username: 'alice' };
const anchor: PdfRegionAnchor = {
  kind: 'pdf-region',
  pageIndex: 2,
  rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
};

describe('PdfCommentStore', () => {
  it('adds a thread with the given region anchor and lists it', async () => {
    const store = new PdfCommentStore(makeDoc());
    const t = await store.addThread(anchor, 'first note', author);
    expect(t.anchor).toEqual(anchor);
    const threads = await store.listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].body).toBe('first note');
    expect(typeof threads[0].createdAt).toBe('number');
  });

  it('appends replies and resolves', async () => {
    const store = new PdfCommentStore(makeDoc());
    const t = await store.addThread(anchor, 'root', author);
    await store.addReply(t.id, 'reply', author);
    await store.setThreadResolved(t.id, true, author);
    const [only] = await store.listThreads({ resolved: true });
    expect(only.comments.map((c) => c.body)).toEqual(['root', 'reply']);
    expect(only.resolved).toBe(true);
  });

  it('deleting the root comment removes the whole thread', async () => {
    const store = new PdfCommentStore(makeDoc());
    const t = await store.addThread(anchor, 'root', author);
    await store.deleteComment(t.id, t.comments[0].id);
    expect(await store.listThreads()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- pdf-comment-store`
Expected: FAIL — `PdfCommentStore` does not exist.

- [ ] **Step 3: Write the store**

This mirrors `app/docs/comments/yorkie-comment-store.ts` but the anchor is plain data, so `copyThread` is a straight deep copy and `addThread` needs no path resolution.

```ts
// packages/frontend/src/app/files/comments/pdf-comment-store.ts
import type { Document } from '@yorkie-js/react';

import type { CommentStore } from '@/components/comments/comment-store.ts';
import type {
  Comment,
  CommentAuthor,
  PdfRegionAnchor,
  Thread,
} from '@/types/comments.ts';
import type { YorkiePdfRoot } from '@/types/pdf-document.ts';

export interface PdfCommentStoreOptions {
  newId?: () => string;
  now?: () => number;
}

function defaultId(): string {
  return Math.random().toString(36).slice(2);
}

// Yorkie classifies integer-valued JS numbers as 32-bit Integer; store
// timestamps as BigInt (Long) and convert back at the read boundary.
function toYorkieMs(ms: number): number {
  return BigInt(ms) as unknown as number;
}
function fromYorkieMs(value: number | bigint | undefined): number | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'bigint' ? Number(value) : value;
}

function copyAuthor(a: CommentAuthor): CommentAuthor {
  const copy: CommentAuthor = { userId: a.userId, username: a.username };
  if (a.photo !== undefined) copy.photo = a.photo;
  return copy;
}
function copyComment(c: Comment): Comment {
  const copy: Comment = {
    id: c.id,
    author: copyAuthor(c.author),
    body: c.body,
    createdAt: fromYorkieMs(c.createdAt)!,
  };
  const editedAt = fromYorkieMs(c.editedAt);
  if (editedAt !== undefined) copy.editedAt = editedAt;
  return copy;
}

/** Deep-copy a thread out of the Yorkie proxy into plain JS. */
export function copyPdfThread(t: Thread<PdfRegionAnchor>): Thread<PdfRegionAnchor> {
  const copy: Thread<PdfRegionAnchor> = {
    id: t.id,
    anchor: {
      kind: 'pdf-region',
      pageIndex: t.anchor.pageIndex,
      rect: {
        x: t.anchor.rect.x,
        y: t.anchor.rect.y,
        w: t.anchor.rect.w,
        h: t.anchor.rect.h,
      },
    },
    comments: Array.from(t.comments ?? []).map(copyComment),
    resolved: t.resolved,
    createdAt: fromYorkieMs(t.createdAt)!,
  };
  const resolvedAt = fromYorkieMs(t.resolvedAt);
  if (resolvedAt !== undefined) copy.resolvedAt = resolvedAt;
  if (t.resolvedBy !== undefined) copy.resolvedBy = copyAuthor(t.resolvedBy);
  return copy;
}

function assertNonEmptyBody(body: string): string {
  if (body.trim().length === 0) throw new Error('Comment body cannot be empty');
  return body;
}

export class PdfCommentStore implements CommentStore<PdfRegionAnchor> {
  private readonly doc: Document<YorkiePdfRoot>;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly subscribers = new Set<() => void>();
  private readonly unsubscribeRoot: () => void;

  constructor(doc: Document<YorkiePdfRoot>, opts: PdfCommentStoreOptions = {}) {
    this.doc = doc;
    this.newId = opts.newId ?? defaultId;
    this.now = opts.now ?? (() => Date.now());
    const off = doc.subscribe(() => this.notify());
    this.unsubscribeRoot = off as unknown as () => void;
  }

  dispose(): void {
    this.unsubscribeRoot();
    this.subscribers.clear();
  }

  async addThread(
    anchor: PdfRegionAnchor,
    body: string,
    author: CommentAuthor,
  ): Promise<Thread<PdfRegionAnchor>> {
    const text = assertNonEmptyBody(body);
    const threadId = this.newId();
    const rootCommentId = this.newId();
    const ts = this.now();

    this.doc.update((root) => {
      // Seeded at bootstrap (initialPdfRoot); guard only for legacy docs.
      if (!root.comments) root.comments = {};
      root.comments[threadId] = {
        id: threadId,
        anchor: {
          kind: 'pdf-region',
          pageIndex: anchor.pageIndex,
          rect: { ...anchor.rect },
        },
        comments: [
          {
            id: rootCommentId,
            author: copyAuthor(author),
            body: text,
            createdAt: toYorkieMs(ts),
          },
        ],
        resolved: false,
        createdAt: toYorkieMs(ts),
      };
    });

    const stored = this.doc.getRoot().comments?.[threadId];
    if (!stored) throw new Error('addThread: thread vanished after insert');
    return copyPdfThread(stored);
  }

  async addReply(
    threadId: string,
    body: string,
    author: CommentAuthor,
  ): Promise<Comment> {
    const text = assertNonEmptyBody(body);
    const reply: Comment = {
      id: this.newId(),
      author: copyAuthor(author),
      body: text,
      createdAt: toYorkieMs(this.now()),
    };
    this.doc.update((root) => {
      this.requireThread(root, threadId).comments.push(reply);
    });
    return copyComment(reply);
  }

  async editComment(threadId: string, commentId: string, body: string): Promise<void> {
    const text = assertNonEmptyBody(body);
    const editedAt = toYorkieMs(this.now());
    this.doc.update((root) => {
      const t = this.requireThread(root, threadId);
      const c = t.comments.find((x) => x.id === commentId);
      if (!c) throw new Error(`Comment not found: ${commentId}`);
      c.body = text;
      c.editedAt = editedAt;
    });
  }

  async deleteComment(threadId: string, commentId: string): Promise<void> {
    this.doc.update((root) => {
      const t = this.requireThread(root, threadId);
      const idx = t.comments.findIndex((c) => c.id === commentId);
      if (idx < 0) throw new Error(`Comment not found: ${commentId}`);
      if (idx === 0) {
        delete root.comments![threadId];
        return;
      }
      t.comments.splice(idx, 1);
    });
  }

  async setThreadResolved(
    threadId: string,
    resolved: boolean,
    by: CommentAuthor,
  ): Promise<void> {
    const ts = toYorkieMs(this.now());
    this.doc.update((root) => {
      const t = this.requireThread(root, threadId);
      t.resolved = resolved;
      if (resolved) {
        t.resolvedAt = ts;
        t.resolvedBy = copyAuthor(by);
      } else {
        delete t.resolvedAt;
        delete t.resolvedBy;
      }
    });
  }

  async listThreads(opts?: { resolved?: boolean }): Promise<Thread<PdfRegionAnchor>[]> {
    const map = this.doc.getRoot().comments;
    if (!map) return [];
    const all = Object.values(map).map(copyPdfThread);
    if (opts?.resolved === undefined) return all;
    return all.filter((t) => t.resolved === opts.resolved);
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private requireThread(root: YorkiePdfRoot, threadId: string): Thread<PdfRegionAnchor> {
    const thread = root.comments?.[threadId];
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    return thread as Thread<PdfRegionAnchor>;
  }

  private notify(): void {
    for (const cb of this.subscribers) cb();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- pdf-comment-store`
Expected: PASS — all three cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/files/comments/pdf-comment-store.ts \
  packages/frontend/tests/app/files/pdf-comment-store.test.ts
git commit -m "Add PdfCommentStore over the pdf-<id> Yorkie document"
```

---

## Slice 3 — Comment UI + region pins

### Task 5: Normalized-rect helpers

**Files:**
- Create: `packages/frontend/src/app/files/comments/rect.ts`
- Test: `packages/frontend/tests/app/files/rect.test.ts`

**Interfaces:**
- Produces:
  - `type PixelRect = { left: number; top: number; width: number; height: number }`
  - `normalizeDragRect(start: {x;y}, end: {x;y}, pageW: number, pageH: number): PdfRect` — converts a pointer drag (page-local pixels) into a `[0,1]` `PdfRect`, clamped and orientation-normalized (so dragging up-left works).
  - `rectToStyle(rect: PdfRect): { left; top; width; height }` in CSS percentage strings (e.g. `"10%"`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/tests/app/files/rect.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeDragRect, rectToStyle } from '@/app/files/comments/rect';

describe('rect helpers', () => {
  it('normalizes a top-left→bottom-right drag to [0,1]', () => {
    expect(normalizeDragRect({ x: 20, y: 40 }, { x: 60, y: 80 }, 200, 400))
      .toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  });

  it('normalizes a reversed (bottom-right→top-left) drag identically', () => {
    expect(normalizeDragRect({ x: 60, y: 80 }, { x: 20, y: 40 }, 200, 400))
      .toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  });

  it('clamps out-of-page coordinates into [0,1]', () => {
    const r = normalizeDragRect({ x: -50, y: -50 }, { x: 999, y: 999 }, 200, 400);
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('renders CSS percentage strings', () => {
    expect(rectToStyle({ x: 0.1, y: 0.2, w: 0.3, h: 0.05 })).toEqual({
      left: '10%', top: '20%', width: '30%', height: '5%',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- rect`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/frontend/src/app/files/comments/rect.ts
import type { PdfRect } from '@/types/comments.ts';

export type PixelRect = { left: number; top: number; width: number; height: number };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Convert a pointer drag (page-local pixels) into a page-relative [0,1]
 * rectangle. Orientation-normalized so any drag direction yields a positive
 * width/height, and clamped so an overshoot outside the page stays in range.
 */
export function normalizeDragRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  pageW: number,
  pageH: number,
): PdfRect {
  const x0 = clamp01(Math.min(start.x, end.x) / pageW);
  const y0 = clamp01(Math.min(start.y, end.y) / pageH);
  const x1 = clamp01(Math.max(start.x, end.x) / pageW);
  const y1 = clamp01(Math.max(start.y, end.y) / pageH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** CSS percentage box for absolutely positioning a pin over a page. */
export function rectToStyle(rect: PdfRect): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- rect`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/files/comments/rect.ts packages/frontend/tests/app/files/rect.test.ts
git commit -m "Add normalized rect helpers for PDF comment pins"
```

### Task 6: `usePdfComments` controller hook

**Files:**
- Create: `packages/frontend/src/app/files/comments/pdf-comments-controller.ts`

**Interfaces:**
- Consumes: `PdfCommentStore` (Task 4); `useSyncExternalStore` from React; `CommentAuthor`, `Thread<PdfRegionAnchor>`.
- Produces: `usePdfComments(store: PdfCommentStore | null): { threads: Thread<PdfRegionAnchor>[]; addThread; addReply; setResolved }`. `threads` re-renders on store change via `subscribe`; each mutator refreshes the snapshot. `addThread(anchor, body, author)` returns the created thread id.

- [ ] **Step 1: Write the hook**

There is no separate unit test for this thin subscription wrapper; it is covered by the layer test (Task 7) and the smoke test (Task 10). Keep it minimal.

```ts
// packages/frontend/src/app/files/comments/pdf-comments-controller.ts
import { useCallback, useEffect, useState } from 'react';

import type { PdfCommentStore } from './pdf-comment-store.ts';
import type {
  CommentAuthor,
  PdfRegionAnchor,
  Thread,
} from '@/types/comments.ts';

/**
 * Subscribes a React tree to a `PdfCommentStore` and exposes the mutation
 * surface the pin layer + side panel need. Presence and byte serving are
 * handled elsewhere; this hook is only about comment threads.
 */
export function usePdfComments(store: PdfCommentStore | null) {
  const [threads, setThreads] = useState<Thread<PdfRegionAnchor>[]>([]);

  const refresh = useCallback(() => {
    if (!store) {
      setThreads([]);
      return;
    }
    void store.listThreads().then(setThreads);
  }, [store]);

  useEffect(() => {
    if (!store) return;
    refresh();
    return store.subscribe(refresh);
  }, [store, refresh]);

  const addThread = useCallback(
    async (anchor: PdfRegionAnchor, body: string, author: CommentAuthor) => {
      if (!store) return null;
      const t = await store.addThread(anchor, body, author);
      refresh();
      return t.id;
    },
    [store, refresh],
  );

  const addReply = useCallback(
    async (threadId: string, body: string, author: CommentAuthor) => {
      if (!store) return;
      await store.addReply(threadId, body, author);
      refresh();
    },
    [store, refresh],
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean, by: CommentAuthor) => {
      if (!store) return;
      await store.setThreadResolved(threadId, resolved, by);
      refresh();
    },
    [store, refresh],
  );

  return { threads, addThread, addReply, setResolved };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @wafflebase/frontend exec tsc -b`
Expected: PASS.

```bash
git add packages/frontend/src/app/files/comments/pdf-comments-controller.ts
git commit -m "Add usePdfComments controller hook"
```

### Task 7: `PdfCommentLayer` — pins + drag-to-create overlay

**Files:**
- Create: `packages/frontend/src/app/files/pdf-comment-layer.tsx`
- Test: `packages/frontend/tests/app/files/pdf-comment-layer.test.tsx`

**Interfaces:**
- Consumes: `rectToStyle`, `normalizeDragRect` (Task 5); `Thread<PdfRegionAnchor>` (Task 3).
- Produces: `PdfCommentLayer` component, props:
  ```ts
  {
    pageIndex: number;
    threads: ReadonlyArray<Thread<PdfRegionAnchor>>; // all threads; filtered to this page inside
    creating: boolean;             // true while the "add comment" tool is armed
    onCreateRegion: (pageIndex: number, rect: PdfRect) => void;
    onSelectThread: (threadId: string) => void;
    activeThreadId: string | null;
  }
  ```
  It renders, over one page (parent is `position: relative`), a `pin` button per thread whose `anchor.pageIndex === pageIndex`, plus (when `creating`) a transparent capture surface that turns a drag into `onCreateRegion(pageIndex, rect)`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/frontend/tests/app/files/pdf-comment-layer.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PdfCommentLayer } from '@/app/files/pdf-comment-layer';
import type { Thread, PdfRegionAnchor } from '@/types/comments';

const thread = (id: string, pageIndex: number): Thread<PdfRegionAnchor> => ({
  id,
  anchor: { kind: 'pdf-region', pageIndex, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
  comments: [{ id: 'c', author: { userId: '1', username: 'a' }, body: 'hi', createdAt: 1 }],
  resolved: false,
  createdAt: 1,
});

describe('PdfCommentLayer', () => {
  it('renders one pin per thread on this page only', () => {
    render(
      <PdfCommentLayer
        pageIndex={0}
        threads={[thread('a', 0), thread('b', 1), thread('c', 0)]}
        creating={false}
        onCreateRegion={vi.fn()}
        onSelectThread={vi.fn()}
        activeThreadId={null}
      />,
    );
    expect(screen.getAllByRole('button', { name: /comment/i })).toHaveLength(2);
  });

  it('selecting a pin calls onSelectThread', () => {
    const onSelect = vi.fn();
    render(
      <PdfCommentLayer
        pageIndex={0}
        threads={[thread('a', 0)]}
        creating={false}
        onCreateRegion={vi.fn()}
        onSelectThread={onSelect}
        activeThreadId={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /comment/i }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('a drag on the capture surface emits a normalized region', () => {
    const onCreate = vi.fn();
    render(
      <PdfCommentLayer
        pageIndex={0}
        threads={[]}
        creating
        onCreateRegion={onCreate}
        onSelectThread={vi.fn()}
        activeThreadId={null}
      />,
    );
    const surface = screen.getByTestId('pdf-region-capture');
    // jsdom gives 0-size rects; stub getBoundingClientRect for deterministic math.
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 400 }) as DOMRect;
    fireEvent.pointerDown(surface, { clientX: 20, clientY: 40 });
    fireEvent.pointerUp(surface, { clientX: 60, clientY: 80 });
    expect(onCreate).toHaveBeenCalledWith(0, { x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- pdf-comment-layer`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement**

```tsx
// packages/frontend/src/app/files/pdf-comment-layer.tsx
import { useRef } from 'react';
import { IconMessage } from '@tabler/icons-react';

import type { PdfRect, PdfRegionAnchor, Thread } from '@/types/comments.ts';
import { normalizeDragRect, rectToStyle } from './comments/rect.ts';

type Props = {
  pageIndex: number;
  threads: ReadonlyArray<Thread<PdfRegionAnchor>>;
  creating: boolean;
  onCreateRegion: (pageIndex: number, rect: PdfRect) => void;
  onSelectThread: (threadId: string) => void;
  activeThreadId: string | null;
};

/**
 * Overlay for one PDF page (parent must be `position: relative`). Draws a
 * pin per unresolved thread anchored to this page, and — while `creating` —
 * a transparent surface that converts a drag into a normalized region.
 */
export function PdfCommentLayer({
  pageIndex,
  threads,
  creating,
  onCreateRegion,
  onSelectThread,
  activeThreadId,
}: Props) {
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const pageThreads = threads.filter(
    (t) => t.anchor.pageIndex === pageIndex && !t.resolved,
  );

  const localPoint = (e: React.PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {pageThreads.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-label={`Comment by ${t.comments[0]?.author.username ?? 'unknown'}`}
          onClick={() => onSelectThread(t.id)}
          className={`pointer-events-auto absolute flex items-center justify-center rounded border-2 bg-yellow-200/30 ${
            t.id === activeThreadId ? 'border-yellow-500' : 'border-yellow-400'
          }`}
          style={rectToStyle(t.anchor.rect)}
        >
          <IconMessage size={14} className="text-yellow-700" />
        </button>
      ))}

      {creating && (
        <div
          data-testid="pdf-region-capture"
          className="pointer-events-auto absolute inset-0 cursor-crosshair"
          onPointerDown={(e) => {
            const p = localPoint(e, e.currentTarget);
            dragStart.current = { x: p.x, y: p.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            const start = dragStart.current;
            dragStart.current = null;
            if (!start) return;
            const p = localPoint(e, e.currentTarget);
            const rect = normalizeDragRect(start, { x: p.x, y: p.y }, p.w, p.h);
            // Ignore an accidental click with no drag area.
            if (rect.w < 0.01 || rect.h < 0.01) return;
            onCreateRegion(pageIndex, rect);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- pdf-comment-layer`
Expected: PASS — three cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/files/pdf-comment-layer.tsx \
  packages/frontend/tests/app/files/pdf-comment-layer.test.tsx
git commit -m "Add PdfCommentLayer pin overlay and drag-to-create"
```

### Task 8: Expose an overlay slot + active-page callback in `PdfViewer`

**Files:**
- Modify: `packages/frontend/src/app/files/pdf-viewer.tsx`

**Interfaces:**
- Produces: `PdfViewer` gains two optional props (existing owner-route usage stays valid):
  ```ts
  renderPageOverlay?: (pageIndex: number) => React.ReactNode;
  onActivePageChange?: (pageIndex: number) => void;
  ```
  Each page wrapper becomes `position: relative` and renders `renderPageOverlay(i)` inside it. `onActivePageChange` fires (deduped) with the top-most page's index as it scrolls into view — reusing the existing `IntersectionObserver` in `PdfPageView`.

- [ ] **Step 1: Add the props and thread them to pages**

In `PdfViewer({ fileUrl })`, extend the signature and pass the callbacks into each `PdfPageView`:

```tsx
export function PdfViewer({
  fileUrl,
  renderPageOverlay,
  onActivePageChange,
}: {
  fileUrl: string;
  renderPageOverlay?: (pageIndex: number) => React.ReactNode;
  onActivePageChange?: (pageIndex: number) => void;
}) {
  // ...unchanged loading logic...
  // in the pages map:
  //   <PdfPageView
  //     key={i}
  //     pdfRef={pdfRef}
  //     pageNumber={i + 1}
  //     dim={dim}
  //     overlay={renderPageOverlay?.(i)}
  //     onActive={onActivePageChange ? () => onActivePageChange(i) : undefined}
  //   />
}
```

- [ ] **Step 2: Update `PdfPageView` to host the overlay and report visibility**

Add `overlay?: React.ReactNode` and `onActive?: () => void` props. Make the page wrapper `relative` and render `{overlay}` after the `<canvas>`. In the existing `IntersectionObserver` effect, call `onActive?.()` when the page intersects (it already sets `visible`):

```tsx
const io = new IntersectionObserver(
  (entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      setVisible(true);
      onActive?.();
    }
  },
  { rootMargin: PREFETCH_MARGIN },
);
```

And the wrapper:

```tsx
<div
  ref={wrapRef}
  className="relative my-4 w-full self-center bg-white shadow"
  style={{ aspectRatio: `${dim.width} / ${dim.height}` }}
>
  <canvas ref={canvasRef} className="block h-full w-full" />
  {overlay}
</div>
```

- [ ] **Step 3: Verify the Phase 1 viewer test still passes**

Run: `pnpm --filter @wafflebase/frontend test -- pdf-viewer`
Expected: PASS — new props are optional; existing render path unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/files/pdf-viewer.tsx
git commit -m "Let PdfViewer host per-page overlays and report active page"
```

---

## Slice 4 — Presence

### Task 9: `PdfPresence` type

**Files:**
- Modify: `packages/frontend/src/types/users.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PdfPresence = {
    username: string;
    email: string;
    photo: string;
    /** 0-based index of the page the user is currently viewing. */
    activePage?: number;
  };
  ```

- [ ] **Step 1: Add the type**

Append to `packages/frontend/src/types/users.ts`:

```ts
export type PdfPresence = {
  username: string;
  email: string;
  photo: string;
  /** 0-based index of the page the user is currently viewing. */
  activePage?: number;
};
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @wafflebase/frontend exec tsc -b`
Expected: PASS.

```bash
git add packages/frontend/src/types/users.ts
git commit -m "Add PdfPresence type"
```

Presence read/write is wired inside `PdfCollab` in Task 10 (it owns the `useDocument` handle), so it lands with the shell rather than as a standalone task.

---

## Slice 5 — Collaboration shell + owner route + shared route

### Task 10: `PdfCollab` shell (providers + comments + presence)

**Files:**
- Create: `packages/frontend/src/app/files/pdf-collab.tsx`
- Modify: `packages/frontend/src/api/files.ts`
- Test: `packages/frontend/tests/app/files/pdf-collab.test.tsx`

**Interfaces:**
- Consumes: `YorkieProvider`, `DocumentProvider`, `useDocument` from `@yorkie-js/react`; `initialPdfRoot`, `YorkiePdfRoot`; `PdfCommentStore`; `usePdfComments`; `PdfCommentLayer`; `CommentSidePanel`, `CommentComposer`; `UserPresence`; `PdfPresence`; `pdfFileUrl`.
- Produces: `PdfCollab({ documentId, title, readOnly, token, presenceUser })` — a self-contained shell wiring the `pdf-${documentId}` Yorkie document to the viewer overlay + comments panel + presence. `readOnly` hides the composer/create tool. `token` (optional) is appended to the file URL for anonymous serving.

- [ ] **Step 1: Extend `pdfFileUrl` to accept a token**

```ts
// packages/frontend/src/api/files.ts
/** Document-scoped, permission-gated URL that streams the stored PDF. */
export function pdfFileUrl(documentId: string, token?: string): string {
  const base = `${BACKEND_BASE}/documents/${documentId}/file`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
```

- [ ] **Step 2: Write the failing smoke test**

The full Yorkie attach can't run in jsdom, so mock `@yorkie-js/react` to hand `PdfCollabInner` a local `Document<YorkiePdfRoot>` (as in the store test) and assert the shell mounts the viewer container, the comment toggle, and — with a seeded thread — a pin. Split `PdfCollab` (providers) from `PdfCollabInner` (consumes `useDocument`) so the test targets `PdfCollabInner` directly with a real local doc.

```tsx
// packages/frontend/tests/app/files/pdf-collab.test.tsx (essence)
import { render, screen, fireEvent } from '@testing-library/react';
import { PdfCollabInner } from '@/app/files/pdf-collab';
// build a local Document<YorkiePdfRoot> + seed one thread, pass via a test prop
it('renders the comments toggle and a seeded pin', () => {
  render(<PdfCollabInner {...propsWithSeededThread} />);
  fireEvent.click(screen.getByRole('button', { name: /comments/i }));
  expect(screen.getByRole('button', { name: /comment by/i })).toBeInTheDocument();
});
```

(If mocking `useDocument` proves heavy, keep this test to `PdfCollabInner` accepting an injected `doc` prop used only in tests — document that seam in a code comment.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test -- pdf-collab`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `PdfCollab` + `PdfCollabInner`**

```tsx
// packages/frontend/src/app/files/pdf-collab.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { YorkieProvider, DocumentProvider, useDocument } from '@yorkie-js/react';
import { IconMessage } from '@tabler/icons-react';

import { PdfViewer } from './pdf-viewer.tsx';
import { PdfCommentLayer } from './pdf-comment-layer.tsx';
import { PdfCommentStore } from './comments/pdf-comment-store.ts';
import { usePdfComments } from './comments/pdf-comments-controller.ts';
import { CommentSidePanel } from '@/components/comments/components/CommentSidePanel.tsx';
import { CommentComposer } from '@/components/comments/components/CommentComposer.tsx';
import { UserPresence } from '@/components/user-presence.tsx';
import { initialPdfRoot, type YorkiePdfRoot } from '@/types/pdf-document.ts';
import type { PdfPresence } from '@/types/users.ts';
import type { CommentAuthor, PdfRect } from '@/types/comments.ts';
import { pdfFileUrl } from '@/api/files.ts';

export type PdfCollabProps = {
  documentId: string;
  title: string;
  readOnly: boolean;
  token?: string;
  presenceUser: { username: string; email: string; photo: string; userId: string };
};

export function PdfCollab(props: PdfCollabProps) {
  const presence: PdfPresence = {
    username: props.presenceUser.username,
    email: props.presenceUser.email,
    photo: props.presenceUser.photo,
  };
  return (
    <YorkieProvider
      rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
      apiKey={import.meta.env.VITE_YORKIE_PUBLIC_KEY}
      metadata={{ userID: props.presenceUser.username }}
    >
      <DocumentProvider<YorkiePdfRoot, PdfPresence>
        docKey={`pdf-${props.documentId}`}
        initialRoot={initialPdfRoot()}
        initialPresence={presence}
        enableDevtools={import.meta.env.DEV}
      >
        <PdfCollabInner {...props} />
      </DocumentProvider>
    </YorkieProvider>
  );
}

export function PdfCollabInner({
  documentId,
  readOnly,
  token,
  presenceUser,
}: PdfCollabProps) {
  const { doc } = useDocument<YorkiePdfRoot, PdfPresence>();
  const store = useMemo(() => (doc ? new PdfCommentStore(doc) : null), [doc]);
  useEffect(() => () => store?.dispose(), [store]);

  const { threads, addThread, addReply, setResolved } = usePdfComments(store);
  const [panelOpen, setPanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ pageIndex: number; rect: PdfRect } | null>(null);

  const author: CommentAuthor = {
    userId: presenceUser.userId,
    username: presenceUser.username,
    photo: presenceUser.photo || undefined,
  };

  // Broadcast the active page (throttled) for presence.
  const lastPageRef = useRef<number>(-1);
  const onActivePageChange = (pageIndex: number) => {
    if (!doc || pageIndex === lastPageRef.current) return;
    lastPageRef.current = pageIndex;
    doc.update((_r, p) => p.set({ activePage: pageIndex }));
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end gap-2 border-b px-3 py-1.5">
        {!readOnly && (
          <button
            type="button"
            aria-pressed={creating}
            className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs hover:bg-muted ${
              creating ? 'bg-muted' : ''
            }`}
            onClick={() => setCreating((v) => !v)}
          >
            Add comment
          </button>
        )}
        <button
          type="button"
          aria-label={panelOpen ? 'Hide comments' : 'Show comments'}
          aria-pressed={panelOpen}
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted ${
            panelOpen ? 'bg-muted' : ''
          }`}
          onClick={() => setPanelOpen((v) => !v)}
        >
          <IconMessage size={16} />
        </button>
        <UserPresence />
      </div>

      <div className="flex min-h-0 flex-1">
        <PdfViewer
          fileUrl={pdfFileUrl(documentId, token)}
          onActivePageChange={onActivePageChange}
          renderPageOverlay={(pageIndex) => (
            <PdfCommentLayer
              pageIndex={pageIndex}
              threads={threads}
              creating={creating}
              activeThreadId={activeThreadId}
              onSelectThread={(id) => {
                setActiveThreadId(id);
                setPanelOpen(true);
              }}
              onCreateRegion={(pi, rect) => {
                setPending({ pageIndex: pi, rect });
                setCreating(false);
              }}
            />
          )}
        />
        {panelOpen && (
          <CommentSidePanel
            threads={threads.filter((t) => t.anchor.pageIndex >= 0)}
            onJumpTo={(t) => setActiveThreadId(t.id)}
            onClose={() => setPanelOpen(false)}
            renderAnchorLabel={(t) => `Page ${t.anchor.pageIndex + 1}`}
          />
        )}
      </div>

      {/* New-thread composer for the just-drawn region. */}
      {pending && !readOnly && (
        <div className="border-t p-3">
          <CommentComposer
            submitLabel="Comment"
            autoFocus
            onCancel={() => setPending(null)}
            onSubmit={async (body) => {
              await addThread(
                { kind: 'pdf-region', pageIndex: pending.pageIndex, rect: pending.rect },
                body,
                author,
              );
              setPending(null);
              setPanelOpen(true);
            }}
          />
        </div>
      )}
    </div>
  );
}
```

Note: `addReply` / `setResolved` are passed to a thread-detail popover in a follow-up; expose them now so the panel's jump target can open a thread view. For the MVP, wiring `onJumpTo` → open panel + highlight pin is sufficient; keep `addReply`/`setResolved` referenced (e.g. via a thread popover) or prefix-underscore them to satisfy lint if unused in this task. Prefer wiring a minimal reply box in the panel row to avoid dead code.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test -- pdf-collab`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/files/pdf-collab.tsx \
  packages/frontend/src/api/files.ts \
  packages/frontend/tests/app/files/pdf-collab.test.tsx
git commit -m "Add PdfCollab shell wiring comments and presence"
```

### Task 11: Mount `PdfCollab` on the owner route + Share button

**Files:**
- Modify: `packages/frontend/src/app/files/file-detail.tsx`

**Interfaces:**
- Consumes: `PdfCollab` (Task 10); the existing share dialog component (find it — the docs/sheets detail routes import a `ShareDialog`/`ShareButton`; reuse the same one).

- [ ] **Step 1: Find the existing share dialog**

Run: `grep -rl "share-links\|ShareDialog\|Share link" packages/frontend/src/app/docs packages/frontend/src/components | head`
Expected: the component the docs/sheets owner header uses to create/copy a share link. Note its import path and required props (`documentId`, `title`).

- [ ] **Step 2: Replace the read-only viewer mount with `PdfCollab` and add Share**

In `FileLayout`, swap `<PdfViewer fileUrl={pdfFileUrl(documentId)} />` for:

```tsx
<PdfCollab
  documentId={documentId}
  title={documentData?.title ?? 'PDF'}
  readOnly={false}
  presenceUser={{
    userId: String(currentUser?.id ?? ''),
    username: currentUser?.username ?? 'Anonymous',
    email: currentUser?.email ?? '',
    photo: currentUser?.photo ?? '',
  }}
/>
```

`currentUser` is available in `FileDetail`; thread it into `FileLayout` as a prop (the query already runs there). Add the existing Share button/dialog (from Step 1) into the `SiteHeader` actions or the `PdfCollab` header row, gated to the owner.

- [ ] **Step 3: Manual smoke**

Run: `pnpm dev`, open a PDF you own at `/f/:id`. Verify: pages render; "Add comment" arms the crosshair; dragging a box opens the composer; submitting shows a pin + a panel entry; the Share button creates a link. (Requires `docker compose up -d` for Yorkie.)

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/files/file-detail.tsx
git commit -m "Mount PdfCollab and Share button on the owner PDF route"
```

### Task 12: Shared PDF route

**Files:**
- Modify: `packages/frontend/src/app/shared/shared-document.tsx`

**Interfaces:**
- Consumes: `PdfCollab` (Task 10); `ResolvedShareLink` (`{ documentId, role, title, type }`).
- Produces: a `pdf` branch in `SharedDocumentInner` that renders `PdfCollab` directly (it owns its own `YorkieProvider`/`DocumentProvider`, so it does NOT nest inside the per-type `DocumentProvider` used by doc/slides/sheet).

- [ ] **Step 1: Add the `pdf` branch**

`PdfCollab` mounts its own providers, so branch **before** the shared `YorkieProvider` wrapper. In `SharedDocumentInner`, at the top of the returned JSX:

```tsx
if (resolved.type === 'pdf') {
  return (
    <PdfCollab
      documentId={resolved.documentId}
      title={resolved.title}
      readOnly={resolved.role === 'viewer'}
      token={token}
      presenceUser={{
        userId: String(currentUser?.id ?? ''),
        username: currentUser?.username || 'Anonymous',
        email: currentUser?.email || '',
        photo: currentUser?.photo || '',
      }}
    />
  );
}
```

`token` is the route param — thread it into `SharedDocumentInner` from `SharedDocument` (which already has `useParams().token`) as a prop, or read `useParams` again inside. The PDF file fetch uses this token (Slice 1); the Yorkie connection uses the public key exactly like the other shared types.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @wafflebase/frontend exec tsc -b && pnpm --filter @wafflebase/frontend lint`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Create a share link on a PDF you own (viewer role), open `/shared/:token` in an incognito window. Verify: the PDF renders (bytes served via `?token=`); comments are visible; as a `viewer` the composer/create tool is hidden; switching the link to `editor` lets you post; a second window shows the peer avatar and page presence.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/app/shared/shared-document.tsx
git commit -m "Render shared PDF links with comments and presence"
```

---

## Finalization

- [ ] **Run the full fast gate**

Run: `pnpm verify:fast`
Expected: PASS (after `pnpm install` restored `pdfjs-dist`). If only the pre-existing slides `.at()` typecheck error remains (see project memory), it is unrelated.

- [ ] **Run the backend integration gate for the new serving test**

Run: `pnpm verify:integration:docker`
Expected: PASS — includes `document-file-serving.e2e-spec.ts`.

- [ ] **Self-review + code review**

Dispatch `/code-review` over the full branch diff. Apply blocking findings; note non-blocking as known limitations. Then follow the project Task Workflow (rebase on `origin/main`, open PR: Summary + Test plan).

---

## Self-Review (plan vs spec)

**Spec coverage:**
- Slice 1 (share-token serving) → Tasks 1–2. ✓
- Slice 2 (`pdf-<id>` doc + store, `pdf-region` anchor, bootstrap seeding) → Tasks 3–4. ✓
- Slice 3 (region pins, shared comments UI, role gating) → Tasks 5–8, 10. ✓
- Slice 4 (`activePage` presence) → Tasks 9–10. ✓
- Slice 5 (shared route + Share button) → Tasks 11–12. ✓
- Non-Goal (no PDF bytes in Yorkie) → `YorkiePdfRoot` holds only `comments`. ✓
- Risk (expired/mismatched token) → Task 2 tests both. ✓
- Risk (comment-map convergence) → `initialPdfRoot()` seeds `comments: {}` (Task 3), asserted by the store test's local seeding. ✓

**Type consistency:** `PdfRect`/`PdfRegionAnchor` (Task 3) are consumed unchanged by the store (Task 4), rect helpers (Task 5), layer (Task 7), and shell (Task 10). `pdfFileUrl(documentId, token?)` signature (Task 10) matches its callers (Tasks 10–12). `PdfPresence.activePage` (Task 9) matches the `doc.update((_, p) => p.set({ activePage }))` write and `UserPresence` read (Task 10).

**Known follow-ups (out of scope, noted so they aren't mistaken for gaps):** a full thread-detail popover with inline reply/resolve controls (the MVP opens the panel + highlights the pin and wires a new-thread composer; `addReply`/`setResolved` are exposed for the popover); mention autocomplete for members (anonymous share viewers have no member list, so `CommentComposer.members` is omitted — mentions simply disabled).
