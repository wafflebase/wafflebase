# Workspace Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an arbitrary-depth, purely-organizational `Folder` tree inside each workspace, so documents can be filed into folders and navigated by in-list drill-in + breadcrumb.

**Architecture:** A new `Folder` Prisma model (workspace-scoped, self-referencing tree, carries `authorID`) plus a nullable `Document.folderId` (null = workspace root). A `FolderModule`/`FolderService`/`FolderController` mirrors the document module and reuses `isDocumentManager` for gating. The document PATCH/create/list endpoints gain `folderId` support. The frontend renders folders as rows in the existing TanStack table, drills in via a `?folder=<id>` query param, and extends the existing "Move to…" dialog with a folder picker.

**Tech Stack:** NestJS 11 + Prisma 6 (PostgreSQL), class-validator DTOs, Jest e2e (DB-gated) for backend; React 19 + Vite + TanStack Query/Table for frontend.

**Design doc:** `docs/design/workspace-folders.md`

## Global Constraints

- **No permission inheritance** — folders never change document access; access stays governed by workspace membership + share links.
- **Non-destructive delete** — deleting a folder must never delete a document. Enforced by DB: `Folder.parent` self-relation `onDelete: Cascade`, `Document.folder` relation `onDelete: SetNull`.
- **Reuse `isDocumentManager(memberRole, authorID, userId)`** for folder move/delete gating — do not introduce a second predicate.
- **Folder mutation tiers:** create + rename = any workspace member; move + delete = manager (owner or folder author).
- **Cycle-safe moves** — a folder may never become its own ancestor (400).
- **Same-workspace invariant** — a folder's `parentId` and a document's `folderId` must reference a folder in the same workspace.
- **Commit format:** subject ≤70 chars, blank line 2, body explains why. Each commit `pnpm verify:fast` green. Feature branch already exists: `design/workspace-folders` (continue on it or branch `feat/workspace-folders` from it).
- **ANTLR / generated files** untouched by this work.
- **Backend DB tests** require `docker compose up -d` and the `RUN_DB_INTEGRATION_TESTS=true` gate.

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`
- Create: `packages/backend/prisma/migrations/<timestamp>_add_workspace_folders/migration.sql` (generated)

**Interfaces:**
- Produces: `Folder` model (`id, name, workspaceId, parentId, authorID, createdAt`) and `Document.folderId`; Prisma client types `Folder`, updated `Document`.

- [ ] **Step 1: Add the `Folder` model and `Document.folderId`**

In `schema.prisma`, add the model (place it after `Document`):

```prisma
model Folder {
  id          String     @id @default(uuid())
  name        String
  workspaceId String
  workspace   Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  parentId    String?
  parent      Folder?    @relation("FolderTree", fields: [parentId], references: [id], onDelete: Cascade)
  children    Folder[]   @relation("FolderTree")
  documents   Document[]
  authorID    Int?
  author      User?      @relation(fields: [authorID], references: [id])
  createdAt   DateTime   @default(now())

  @@index([workspaceId, parentId])
}
```

In the `Document` model, add the folder relation + index (after the `workspace` relation, before the closing brace):

```prisma
  folderId String?
  folder   Folder? @relation(fields: [folderId], references: [id], onDelete: SetNull)

  @@index([workspaceId, folderId])
```

In `Workspace`, add the back-relation to the relation block: `folders Folder[]`.
In `User`, add the back-relation: `folders Folder[]`.

- [ ] **Step 2: Start the database**

Run: `docker compose up -d`
Expected: postgres + yorkie containers up.

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @wafflebase/backend exec prisma migrate dev --name add_workspace_folders`
Expected: a new migration folder is created, applied to the dev DB, and the Prisma client regenerates without error.

- [ ] **Step 4: Verify the generated SQL enforces the delete rule**

Read the generated `migration.sql`. Confirm:
- `Folder_parentId_fkey` uses `ON DELETE CASCADE`.
- `Document_folderId_fkey` uses `ON DELETE SET NULL`.
- Both `@@index` declarations produced `CREATE INDEX`.

If the `onDelete` clauses are wrong, fix the schema and re-run Step 3.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/prisma/schema.prisma packages/backend/prisma/migrations
git commit -m "Add Folder model and Document.folderId migration"
```

---

### Task 2: FolderService (CRUD + cycle/same-workspace guards)

**Files:**
- Create: `packages/backend/src/folder/folder.service.ts`
- Test: `packages/backend/test/folder.e2e-spec.ts` (service-level DB integration)

**Interfaces:**
- Consumes: `PrismaService`.
- Produces:
  - `listByWorkspace(workspaceId: string): Promise<Array<{id,name,parentId,authorID,createdAt}>>`
  - `getById(id: string): Promise<Folder | null>`
  - `create(data: { name: string; workspaceId: string; parentId: string | null; authorID: number }): Promise<Folder>`
  - `update(id: string, data: { name?: string; parentId?: string | null }): Promise<Folder>`
  - `delete(id: string): Promise<Folder>`
  - `assertNoCycle(folderId: string, newParentId: string | null): Promise<void>` (throws `BadRequestException`)
  - `assertSameWorkspace(parentId: string, workspaceId: string): Promise<void>` (throws `BadRequestException`)

- [ ] **Step 1: Write the failing test**

Create `packages/backend/test/folder.e2e-spec.ts`. Follow the existing DB-gated e2e pattern (guarded by `RUN_DB_INTEGRATION_TESTS`, bootstraps `PrismaService`). Model the setup/teardown on an existing `*.e2e-spec.ts` in `packages/backend/test/` (read one first for the exact bootstrap + `describeIf` gate helper used in this repo).

```ts
// Inside the DB-gated describe block, with a seeded user + workspace:
it('rejects moving a folder into its own descendant', async () => {
  const a = await folderService.create({ name: 'A', workspaceId, parentId: null, authorID: userId });
  const b = await folderService.create({ name: 'B', workspaceId, parentId: a.id, authorID: userId });
  await expect(folderService.assertNoCycle(a.id, b.id)).rejects.toThrow();
});

it('deleting a parent folder returns its documents to the workspace root', async () => {
  const f = await folderService.create({ name: 'F', workspaceId, parentId: null, authorID: userId });
  const doc = await prisma.document.create({
    data: { title: 'D', workspaceId, authorID: userId, folderId: f.id },
  });
  await folderService.delete(f.id);
  const after = await prisma.document.findUnique({ where: { id: doc.id } });
  expect(after?.folderId).toBeNull();
});

it('cascade-deletes descendant folders', async () => {
  const a = await folderService.create({ name: 'A', workspaceId, parentId: null, authorID: userId });
  const b = await folderService.create({ name: 'B', workspaceId, parentId: a.id, authorID: userId });
  await folderService.delete(a.id);
  expect(await prisma.folder.findUnique({ where: { id: b.id } })).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose up -d && RUN_DB_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e -- folder.e2e-spec`
Expected: FAIL — `folder.service` module not found / `folderService` undefined.

- [ ] **Step 3: Implement `FolderService`**

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { Folder } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class FolderService {
  constructor(private prisma: PrismaService) {}

  listByWorkspace(workspaceId: string) {
    return this.prisma.folder.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        parentId: true,
        authorID: true,
        createdAt: true,
      },
    });
  }

  getById(id: string): Promise<Folder | null> {
    return this.prisma.folder.findUnique({ where: { id } });
  }

  create(data: {
    name: string;
    workspaceId: string;
    parentId: string | null;
    authorID: number;
  }): Promise<Folder> {
    return this.prisma.folder.create({ data });
  }

  update(
    id: string,
    data: { name?: string; parentId?: string | null },
  ): Promise<Folder> {
    return this.prisma.folder.update({ where: { id }, data });
  }

  delete(id: string): Promise<Folder> {
    return this.prisma.folder.delete({ where: { id } });
  }

  /**
   * A folder may never become its own ancestor. Walk from the target parent up
   * to the root; if the folder being moved appears in that chain (or equals the
   * target), reject. Moving to the workspace root (`null`) is always safe.
   */
  async assertNoCycle(
    folderId: string,
    newParentId: string | null,
  ): Promise<void> {
    if (newParentId === null) return;
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === folderId) {
        throw new BadRequestException(
          'Cannot move a folder into itself or one of its descendants',
        );
      }
      const parent = await this.prisma.folder.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  /** A parent folder (or a document's target folder) must be in the same workspace. */
  async assertSameWorkspace(
    folderId: string,
    workspaceId: string,
  ): Promise<void> {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
      select: { workspaceId: true },
    });
    if (!folder || folder.workspaceId !== workspaceId) {
      throw new BadRequestException(
        'Folder must belong to the same workspace',
      );
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `RUN_DB_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e -- folder.e2e-spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/folder/folder.service.ts packages/backend/test/folder.e2e-spec.ts
git commit -m "Add FolderService with cycle and same-workspace guards"
```

---

### Task 3: FolderController + DTOs + FolderModule

**Files:**
- Create: `packages/backend/src/folder/folder.dto.ts`
- Create: `packages/backend/src/folder/folder.controller.ts`
- Create: `packages/backend/src/folder/folder.module.ts`
- Modify: `packages/backend/src/app.module.ts` (register `FolderModule`)
- Test: extend `packages/backend/test/folder.e2e-spec.ts` with HTTP cases

**Interfaces:**
- Consumes: `FolderService`, `WorkspaceService` (`resolveId`, `assertMember`), `isDocumentManager`.
- Produces: `FolderModule` (exports `FolderService`); routes `POST/GET workspaces/:workspaceId/folders`, `PATCH/DELETE folders/:id`.

- [ ] **Step 1: Write the failing HTTP test**

Add to `folder.e2e-spec.ts` (authenticated HTTP through the Nest app, mirroring the document/share-link HTTP e2e cases already in `packages/backend/test/`):

```ts
it('POST creates a folder and GET lists it', async () => {
  const created = await request(app.getHttpServer())
    .post(`/workspaces/${workspaceId}/folders`)
    .set(authHeader)
    .send({ name: 'Reports' })
    .expect(201);
  const list = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/folders`)
    .set(authHeader)
    .expect(200);
  expect(list.body.map((f: any) => f.id)).toContain(created.body.id);
});

it('PATCH rejects a cycle-forming move with 400', async () => {
  const a = await request(app.getHttpServer()).post(`/workspaces/${workspaceId}/folders`).set(authHeader).send({ name: 'A' });
  const b = await request(app.getHttpServer()).post(`/workspaces/${workspaceId}/folders`).set(authHeader).send({ name: 'B', parentId: a.body.id });
  await request(app.getHttpServer())
    .patch(`/folders/${a.body.id}`)
    .set(authHeader)
    .send({ parentId: b.body.id })
    .expect(400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `RUN_DB_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e -- folder.e2e-spec`
Expected: FAIL — routes 404 (controller not registered).

- [ ] **Step 3: Write the DTOs**

`folder.dto.ts`:

```ts
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateFolderDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  // `undefined` = leave parent unchanged; explicit `null` = move to workspace
  // root. `@IsOptional()` skips validation for both null and undefined, so a
  // null reaches the controller and is handled there.
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
```

- [ ] **Step 4: Write the controller**

`folder.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Folder } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from '../workspace/workspace.service';
import { isDocumentManager } from '../document/document-access';
import { FolderService } from './folder.service';
import { CreateFolderDto, UpdateFolderDto } from './folder.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class FolderController {
  constructor(
    private readonly folderService: FolderService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  private async resolveFolderManager(
    folder: { workspaceId: string; authorID: number | null },
    userId: number,
  ): Promise<boolean> {
    const member = await this.workspaceService.assertMember(
      folder.workspaceId,
      userId,
    );
    return isDocumentManager(member.role, folder.authorID, userId);
  }

  @Post('workspaces/:workspaceId/folders')
  async create(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateFolderDto,
  ): Promise<Folder> {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    if (body.parentId) {
      await this.folderService.assertSameWorkspace(body.parentId, workspaceId);
    }
    return this.folderService.create({
      name: body.name,
      workspaceId,
      parentId: body.parentId ?? null,
      authorID: userId,
    });
  }

  @Get('workspaces/:workspaceId/folders')
  async list(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.folderService.listByWorkspace(workspaceId);
  }

  @Patch('folders/:id')
  async update(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateFolderDto,
  ): Promise<Folder> {
    const folder = await this.folderService.getById(id);
    if (!folder) throw new NotFoundException('Folder not found');
    const userId = Number(req.user.id);
    // Rename is a member action; move (reparent) is manager-only.
    const isManager = await this.resolveFolderManager(folder, userId);

    const data: { name?: string; parentId?: string | null } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.parentId !== undefined) {
      if (!isManager) {
        throw new ForbiddenException(
          'Only the workspace owner or folder owner can move this folder',
        );
      }
      const nextParent = body.parentId; // string | null
      if (nextParent !== null) {
        await this.folderService.assertSameWorkspace(
          nextParent,
          folder.workspaceId,
        );
      }
      await this.folderService.assertNoCycle(id, nextParent);
      data.parentId = nextParent;
    }
    return this.folderService.update(id, data);
  }

  @Delete('folders/:id')
  async remove(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Folder> {
    const folder = await this.folderService.getById(id);
    if (!folder) throw new NotFoundException('Folder not found');
    if (!(await this.resolveFolderManager(folder, Number(req.user.id)))) {
      throw new ForbiddenException(
        'Only the workspace owner or folder owner can delete this folder',
      );
    }
    return this.folderService.delete(id);
  }
}
```

- [ ] **Step 5: Write the module and register it**

`folder.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FolderController } from './folder.controller';
import { FolderService } from './folder.service';
import { PrismaService } from '../database/prisma.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, WorkspaceModule],
  controllers: [FolderController],
  providers: [FolderService, PrismaService],
  exports: [FolderService],
})
export class FolderModule {}
```

In `packages/backend/src/app.module.ts`, add `FolderModule` to the `imports` array (read the file to place it alongside `DocumentModule`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `RUN_DB_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e -- folder.e2e-spec`
Expected: PASS (5 tests total).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/folder packages/backend/src/app.module.ts packages/backend/test/folder.e2e-spec.ts
git commit -m "Add folder REST endpoints with member/manager gating"
```

---

### Task 4: Document endpoints — folderId create / move / list filter

**Files:**
- Modify: `packages/backend/src/document/document.dto.ts`
- Modify: `packages/backend/src/document/document.controller.ts`
- Modify: `packages/backend/src/document/document.module.ts` (import `FolderModule`)
- Test: `packages/backend/test/folder.e2e-spec.ts` (add doc-move cases)

**Interfaces:**
- Consumes: `FolderService.getById`.
- Produces: `PATCH documents/:id` accepts `folderId: string | null`; `GET workspaces/:wid/documents?folderId=` filters by folder (omitted = root); `DocumentListItem.folderId` returned; create-in-workspace accepts `folderId`.

- [ ] **Step 1: Write the failing test**

Add to `folder.e2e-spec.ts`:

```ts
it('moves a document into a folder and lists it under that folder only', async () => {
  const folder = await request(app.getHttpServer()).post(`/workspaces/${workspaceId}/folders`).set(authHeader).send({ name: 'F' });
  const doc = await prisma.document.create({ data: { title: 'D', workspaceId, authorID: userId } });
  await request(app.getHttpServer())
    .patch(`/documents/${doc.id}`)
    .set(authHeader)
    .send({ folderId: folder.body.id })
    .expect(200);

  const inFolder = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/documents?folderId=${folder.body.id}`)
    .set(authHeader).expect(200);
  expect(inFolder.body.map((d: any) => d.id)).toContain(doc.id);

  const atRoot = await request(app.getHttpServer())
    .get(`/workspaces/${workspaceId}/documents`)
    .set(authHeader).expect(200);
  expect(atRoot.body.map((d: any) => d.id)).not.toContain(doc.id);
});

it('rejects moving a document into a folder from another workspace with 400', async () => {
  // otherWorkspaceId + otherFolder seeded in setup
  const doc = await prisma.document.create({ data: { title: 'D2', workspaceId, authorID: userId } });
  await request(app.getHttpServer())
    .patch(`/documents/${doc.id}`)
    .set(authHeader)
    .send({ folderId: otherFolderId })
    .expect(400);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `RUN_DB_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e -- folder.e2e-spec`
Expected: FAIL — `folderId` ignored (doc still appears at root; cross-workspace move returns 200).

- [ ] **Step 3: Extend the DTOs**

In `document.dto.ts`, add to `UpdateDocumentDto`:

```ts
  // `undefined` = leave unchanged; explicit `null` = move to workspace root.
  @IsOptional()
  @IsUUID()
  folderId?: string | null;
```

And add the same optional field to `CreateDocumentInWorkspaceDto` (and `CreateDocumentDto` if create-into-folder from the workspace-scoped POST is wanted):

```ts
  @IsOptional()
  @IsUUID()
  folderId?: string;
```

- [ ] **Step 4: Wire `FolderService` into the document module**

In `document.module.ts`, add `FolderModule` to `imports`:

```ts
import { FolderModule } from '../folder/folder.module';
// ...
  imports: [AuthModule, WorkspaceModule, FileModule, ShareLinkModule, FolderModule],
```

- [ ] **Step 5: Implement the controller changes**

In `document.controller.ts`:

1. Inject `FolderService` in the constructor:

```ts
import { FolderService } from '../folder/folder.service';
// ...
    private readonly fileService: FileService,
    private readonly folderService: FolderService,
```

2. Add `@Query` to the `@nestjs/common` import and `Prisma` from `@prisma/client`.

3. In `findByWorkspace`, add the folder filter:

```ts
  async findByWorkspace(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Query('folderId') folderId?: string,
  ): Promise<DocumentListItem[]> {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    const member = await this.workspaceService.assertMember(workspaceId, userId);
    const docs = await this.documentService.listDocumentsWithAuthor({
      where: { workspaceId, folderId: folderId ?? null },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return this.attachMeta(docs, new Map([[workspaceId, member.role]]), userId);
  }
```

4. In `updateDocument`, widen the `data` type and add the `folderId` branch after the `workspaceId` branch:

```ts
    const data: {
      title?: string;
      workspace?: { connect: { id: string } };
      folder?: { connect: { id: string } } | { disconnect: true };
    } = {};
    if (body.title !== undefined) {
      data.title = body.title;
    }
    if (body.workspaceId !== undefined) {
      if (!isManager) {
        throw new ForbiddenException(
          'Only the workspace owner or document owner can move this document',
        );
      }
      await this.workspaceService.assertMember(body.workspaceId, userId);
      data.workspace = { connect: { id: body.workspaceId } };
    }
    if (body.folderId !== undefined) {
      if (!isManager) {
        throw new ForbiddenException(
          'Only the workspace owner or document owner can move this document',
        );
      }
      if (body.folderId === null) {
        data.folder = { disconnect: true };
      } else {
        const targetWorkspaceId = body.workspaceId ?? doc.workspaceId;
        await this.folderService.assertSameWorkspace(
          body.folderId,
          targetWorkspaceId,
        );
        data.folder = { connect: { id: body.folderId } };
      }
    }
```

5. In `createInWorkspace` and `createDocument`, pass the folder connect when `body.folderId` is set:

```ts
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
      fileId: body.fileId,
      author: { connect: { id: userId } },
      workspace: { connect: { id: workspaceId } },
      ...(body.folderId ? { folder: { connect: { id: body.folderId } } } : {}),
    });
```

6. Add `folderId` to the `DocumentListItem` doc comment (the value already flows via `...d` since `DocumentWithAuthor` now includes `folderId` — no code change needed, but note it in the type's comment).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `RUN_DB_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e -- folder.e2e-spec`
Expected: PASS (7 tests total).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/document packages/backend/test/folder.e2e-spec.ts
git commit -m "Support folderId on document create, move, and list"
```

---

### Task 5: Frontend types + folder API client

**Files:**
- Modify: `packages/frontend/src/types/documents.ts`
- Create: `packages/frontend/src/api/folders.ts`
- Modify: `packages/frontend/src/api/documents.ts` (extend `moveDocument`)
- Modify: `packages/frontend/src/api/workspaces.ts` (`fetchWorkspaceDocuments` gains `folderId`)

**Interfaces:**
- Produces:
  - `Folder` type; `Document.folderId?: string | null`.
  - `fetchFolders(workspaceId) / createFolder(workspaceId, {name, parentId?}) / renameFolder(id, name) / moveFolder(id, parentId) / deleteFolder(id)`.
  - `moveDocument(id, target: { workspaceId?: string; folderId?: string | null })`.
  - `fetchWorkspaceDocuments(workspaceId, folderId?: string | null)`.

- [ ] **Step 1: Add the `Folder` type + `Document.folderId`**

In `types/documents.ts`:

```ts
export type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  authorID: number | null;
  createdAt: string;
};
```

Add to the `Document` type: `folderId?: string | null;`.

- [ ] **Step 2: Create the folder API client**

`api/folders.ts`:

```ts
import type { Folder } from "@/types/documents";
import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

const base = import.meta.env.VITE_BACKEND_API_URL;

export async function fetchFolders(workspaceId: string): Promise<Folder[]> {
  const res = await fetchWithAuth(`${base}/workspaces/${workspaceId}/folders`);
  await assertOk(res, "Failed to fetch folders");
  return res.json();
}

export async function createFolder(
  workspaceId: string,
  payload: { name: string; parentId?: string | null }
): Promise<Folder> {
  const res = await fetchWithAuth(`${base}/workspaces/${workspaceId}/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await assertOk(res, "Failed to create folder");
  return res.json();
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  const res = await fetchWithAuth(`${base}/folders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await assertOk(res, "Failed to rename folder");
  return res.json();
}

export async function moveFolder(
  id: string,
  parentId: string | null
): Promise<Folder> {
  const res = await fetchWithAuth(`${base}/folders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId }),
  });
  await assertOk(res, "Failed to move folder");
  return res.json();
}

export async function deleteFolder(id: string): Promise<void> {
  const res = await fetchWithAuth(`${base}/folders/${id}`, { method: "DELETE" });
  await assertOk(res, "Failed to delete folder");
}
```

- [ ] **Step 3: Extend `moveDocument`**

Replace the body of `moveDocument` in `api/documents.ts` (keep the export name) to send both fields:

```ts
export async function moveDocument(
  id: string,
  target: { workspaceId?: string; folderId?: string | null }
): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    }
  );
  await assertOk(response, "Failed to move document");
  return response.json();
}
```

Then update the single existing caller in `document-list.tsx` (the move mutation) to pass `{ workspaceId }` — done in Task 7.

- [ ] **Step 4: Add `folderId` to `fetchWorkspaceDocuments`**

In `api/workspaces.ts`, change `fetchWorkspaceDocuments` to accept an optional `folderId` and append it as a query param when defined (a `null`/`undefined` folderId sends no param → backend returns root). Read the current implementation (research: `api/workspaces.ts:220-224`) and add:

```ts
export async function fetchWorkspaceDocuments(
  workspaceId: string,
  folderId?: string | null
): Promise<Document[]> {
  const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/workspaces/${workspaceId}/documents${qs}`
  );
  await assertOk(res, "Failed to fetch workspace documents");
  return res.json();
}
```

- [ ] **Step 5: Verify typecheck + lint**

Run: `pnpm --filter @wafflebase/frontend lint && pnpm --filter @wafflebase/frontend exec tsc --noEmit`
Expected: PASS (callers updated in later tasks may still reference the old `moveDocument(id, workspaceId)` signature — if tsc flags the `document-list.tsx` caller, that is expected and fixed in Task 7; if you want a green gate now, do Task 7's caller edit first).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/types/documents.ts packages/frontend/src/api/folders.ts packages/frontend/src/api/documents.ts packages/frontend/src/api/workspaces.ts
git commit -m "Add frontend folder API client and folderId types"
```

---

### Task 6: Breadcrumb + folder rows + drill-in navigation

**Files:**
- Modify: `packages/frontend/src/app/workspaces/workspace-documents.tsx`
- Modify: `packages/frontend/src/app/documents/document-list.tsx`
- Create: `packages/frontend/src/app/documents/folder-breadcrumb.tsx`
- Create: `packages/frontend/src/app/documents/folder-path.ts` (pure helper)

**Interfaces:**
- Consumes: `fetchFolders`, `fetchWorkspaceDocuments(workspaceId, folderId)`, `Folder`.
- Produces: `folderPath(folders, folderId): Folder[]` (root→current); `?folder=<id>` navigation; `DocumentList` renders folder rows + breadcrumb.

**Before starting:** read `document-list.tsx` in full (research map: table setup ~535-556, columns, row actions ~306-361, move dialog ~850-916, mutations ~386-506) and `workspace-documents.tsx` (~12-65). These are the integration anchors.

- [ ] **Step 1: Write the pure path helper + its test**

`folder-path.ts`:

```ts
import type { Folder } from "@/types/documents";

/** Returns the folder chain from root down to `folderId` (inclusive). Empty at root. */
export function folderPath(folders: Folder[], folderId: string | null): Folder[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: Folder[] = [];
  let cursor: string | null = folderId;
  const seen = new Set<string>();
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const f = byId.get(cursor)!;
    chain.unshift(f);
    cursor = f.parentId;
  }
  return chain;
}
```

If the frontend has a vitest setup, add `folder-path.test.ts` asserting a 2-level chain and root (`[]`). If not, cover it via the manual smoke in Step 6.

- [ ] **Step 2: Read the current folder param in `workspace-documents.tsx`**

Add `?folder=` reading via `useSearchParams`, fetch folders, and fetch documents scoped to the current folder:

```tsx
const [searchParams, setSearchParams] = useSearchParams();
const folderId = searchParams.get("folder");

const { data: folders = [] } = useQuery({
  queryKey: ["workspaces", workspaceId, "folders"],
  queryFn: () => fetchFolders(workspaceId!),
  enabled: !!workspaceId,
});

const { data: documents = [] } = useQuery({
  queryKey: ["workspaces", workspaceId, "documents", folderId ?? "root"],
  queryFn: () => fetchWorkspaceDocuments(workspaceId!, folderId),
  enabled: !!workspaceId,
  refetchInterval: 5000,
});
```

Pass `folders`, `folderId`, and a `onNavigateFolder` callback into `DocumentList`:

```tsx
<DocumentList
  data={documents}
  workspaceId={workspaceId}
  folders={folders}
  folderId={folderId}
  onNavigateFolder={(id) =>
    setSearchParams(id ? { folder: id } : {}, { replace: false })
  }
/>
```

- [ ] **Step 3: Write the breadcrumb component**

`folder-breadcrumb.tsx`:

```tsx
import type { Folder } from "@/types/documents";
import { folderPath } from "./folder-path";

export function FolderBreadcrumb({
  folders,
  folderId,
  onNavigate,
}: {
  folders: Folder[];
  folderId: string | null;
  onNavigate: (id: string | null) => void;
}) {
  const path = folderPath(folders, folderId);
  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      <button className="hover:text-foreground" onClick={() => onNavigate(null)}>
        All documents
      </button>
      {path.map((f) => (
        <span key={f.id} className="flex items-center gap-1">
          <span>/</span>
          <button
            className="hover:text-foreground"
            onClick={() => onNavigate(f.id)}
          >
            {f.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Accept the new props in `DocumentList` and render folder rows**

In `document-list.tsx`:
- Extend the props type with `folders?: Folder[]`, `folderId?: string | null`, `onNavigateFolder?: (id: string | null) => void`.
- Render `<FolderBreadcrumb>` above the table when `workspaceId` is set.
- Filter to the folders whose `parentId === (folderId ?? null)` (direct children of the current folder) and render them as rows *above* the document rows, using a folder icon (`IconFolder` already imported in the sidebar/layout — import from the same source). Clicking a folder row calls `onNavigateFolder(folder.id)`.
- Keep the existing document table intact. Simplest integration: render a small folder-row list (`<button>` rows styled like table rows) in a section directly above the `<Table>`, rather than merging folders into the TanStack row model — this avoids a union row type across the sortable columns.

- [ ] **Step 5: Verify typecheck + lint**

Run: `pnpm --filter @wafflebase/frontend lint && pnpm --filter @wafflebase/frontend exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual smoke**

Run `pnpm dev`, open `/w/:workspaceId`. Create a folder (Task 7 adds the button — if not yet present, create one via the API/devtools), confirm: folder row appears, clicking it sets `?folder=<id>` and lists only that folder's documents, breadcrumb shows the path and navigates back.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/app/documents/folder-breadcrumb.tsx packages/frontend/src/app/documents/folder-path.ts packages/frontend/src/app/documents/document-list.tsx packages/frontend/src/app/workspaces/workspace-documents.tsx
git commit -m "Add folder rows, breadcrumb, and drill-in navigation"
```

---

### Task 7: New folder, folder row actions, extended Move dialog

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx`

**Interfaces:**
- Consumes: `createFolder`, `renameFolder`, `deleteFolder`, `moveDocument`, `moveFolder`, `fetchFolders`.

- [ ] **Step 1: Add "New folder" to the New menu**

In the New menu (research: ~605-755), add a "New folder" item that opens a small name-input dialog and calls a `createFolderMutation`:

```tsx
const createFolderMutation = useMutation({
  mutationFn: (name: string) => createFolder(workspaceId!, { name, parentId: folderId ?? null }),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, "folders"] }),
});
```

- [ ] **Step 2: Add folder-row actions (rename / delete)**

Each folder row gets a dropdown (mirror the document row actions, research: ~306-361) with Rename and Delete, gated on the caller being a manager. Since the folder list endpoint returns `authorID`, compute manageability client-side the same way the row `canManage` is used for documents, OR always show the actions and let the backend 403 be surfaced via the existing toast path. Prefer the former if the current user id is readily available in this component; otherwise the latter is acceptable and simpler.

```tsx
const renameFolderMutation = useMutation({
  mutationFn: ({ id, name }: { id: string; name: string }) => renameFolder(id, name),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, "folders"] }),
});
const deleteFolderMutation = useMutation({
  mutationFn: (id: string) => deleteFolder(id),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, "folders"] });
    queryClient.invalidateQueries({ queryKey: ["workspaces", workspaceId, "documents"] });
  },
});
```

- [ ] **Step 3: Extend the Move dialog with a folder picker**

In the move dialog (research: ~850-916), after the workspace `<Select>` add a folder `<Select>` populated by fetching the *chosen* target workspace's folders (`fetchFolders(targetWorkspaceId)`), defaulting to "(workspace root)". Track `targetFolderId` state; reset it to root whenever `targetWorkspaceId` changes. Render folders as an indented flat list (indent by depth via `folderPath` length) so nesting is legible in a flat `<Select>`.

Update the move mutation to send both fields:

```tsx
const moveMutation = useMutation({
  mutationFn: ({ id, workspaceId: ws, folderId: fid }: { id: string; workspaceId?: string; folderId?: string | null }) =>
    moveDocument(id, { workspaceId: ws, folderId: fid }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    queryClient.invalidateQueries({ queryKey: ["workspaces"] });
  },
});
```

On submit: if the target workspace equals the current one, send only `{ folderId: targetFolderId }`; if it differs, send `{ workspaceId: targetWorkspaceId, folderId: targetFolderId ?? undefined }` (folder is validated against the target workspace server-side).

- [ ] **Step 4: Verify typecheck + lint**

Run: `pnpm --filter @wafflebase/frontend lint && pnpm --filter @wafflebase/frontend exec tsc --noEmit`
Expected: PASS (the old `moveDocument(id, workspaceId)` caller is now updated → no signature error).

- [ ] **Step 5: Manual smoke**

`pnpm dev`: create a folder via New menu; move a document into it via the Move dialog (folder picker); rename and delete a folder; confirm deleting a non-empty folder returns its documents to root (not deleted).

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/documents/document-list.tsx
git commit -m "Add new-folder, folder actions, and folder move picker"
```

---

### Task 8: Docs, full verification, and PR

**Files:**
- Modify: `packages/backend/README.md` (Folders endpoints table)
- Modify: `docs/design/workspace-folders.md` (mark shipped status if the doc convention wants it)
- Create: `docs/tasks/active/20260719-workspace-folders-lessons.md`
- Modify: `docs/tasks/README.md` (add this task's row)

- [ ] **Step 1: Document the new endpoints**

Add a "Folders (`/workspaces/:workspaceId/folders`)" table to `packages/backend/README.md` mirroring the Documents section: `POST` create (member), `GET` list (member), `PATCH /folders/:id` rename (member) / move (manager), `DELETE /folders/:id` (manager). Note the `?folderId=` param on `GET .../documents` and `folderId` on document create/PATCH.

- [ ] **Step 2: Run the fast gate**

Run: `pnpm verify:fast`
Expected: PASS (lint + unit).

- [ ] **Step 3: Run the full DB-backed gate**

Run: `docker compose up -d && pnpm verify:full`
Expected: PASS, including the new `folder.e2e-spec` cases.

- [ ] **Step 4: Self code-review**

Dispatch `/code-review` (or `superpowers:requesting-code-review`) over the full branch diff. Apply blocking findings; record non-blocking ones in the lessons file.

- [ ] **Step 5: Capture lessons + update the task index**

Write `20260719-workspace-folders-lessons.md` (what was non-obvious: the DB-enforced delete rule, class-validator null handling for `parentId`/`folderId`, flat-vs-tree folder rows). Add the row to `docs/tasks/README.md` Active Tasks.

- [ ] **Step 6: Commit + open PR**

```bash
git add packages/backend/README.md docs/design/workspace-folders.md docs/tasks
git commit -m "Document workspace folders and capture task lessons"
git fetch origin && git rebase origin/main
```

Open a PR titled "Add workspace folders" — body = Summary + Test plan (verify:full green, manual smoke: create/navigate/move/rename/delete, non-destructive delete confirmed).

---

## Self-Review

**Spec coverage** (against `docs/design/workspace-folders.md`):
- Folder model + `folderId` → Task 1. ✓
- Arbitrary depth (self-relation + cycle guard) → Task 1 (model), Task 2 (`assertNoCycle`). ✓
- Non-destructive DB-enforced delete → Task 1 (onDelete), Task 2 (test). ✓
- FolderController member/manager gating (reuse `isDocumentManager`) → Task 3. ✓
- Document create/move/list `folderId` (+ same-workspace validation) → Task 4. ✓
- `?folderId=` list filter, `folderId` on list items → Task 4. ✓
- Frontend types + API client → Task 5. ✓
- In-list drill-in + breadcrumb (`?folder=`) → Task 6. ✓
- New folder, folder actions, extended Move dialog → Task 7. ✓
- Docs + verification → Task 8. ✓
- Non-Goals (no inheritance, no DnD, no sidebar tree, no v1 API) → honored (not implemented). ✓

**Type consistency:** `moveDocument(id, target)` signature is defined in Task 5 and its sole caller updated in Task 7 (flagged in Task 5 Step 5). `fetchWorkspaceDocuments(workspaceId, folderId?)` defined Task 5, consumed Task 6. `folderPath` defined Task 6 Step 1, consumed by breadcrumb (Step 3) and move dialog indent (Task 7 Step 3). `FolderService.assertSameWorkspace` defined Task 2, consumed Task 3 + Task 4. Consistent.

**Placeholder scan:** frontend Tasks 6–7 describe edits to the 967-line `document-list.tsx` with real code for the additive units (breadcrumb, helper, mutations, dialog picker) and precise anchor line-ranges rather than inlining the whole file — acceptable because the implementer is instructed to read the file first and the net-new code is complete.
