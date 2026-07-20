# Documents Bulk Multi-Select Move + Drag-and-Drop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google-Drive-style multi-select to the workspace documents list, letting a user move (via an extended "Move to…" dialog or drag-and-drop onto folders) and bulk-delete many documents at once.

**Architecture:** Two new per-id-manager-gated bulk backend endpoints (`PATCH documents/move` in one Prisma transaction with atomic reject, `POST documents/delete`). The frontend reuses the already-wired-but-inert TanStack `rowSelection` state, adds an explicit checkbox column + a bulk action bar, generalizes the single-document move/delete dialogs to id-sets, and adds a custom-MIME drag payload so row→folder DnD coexists with the existing whole-window file-upload drop.

**Tech Stack:** NestJS 11 + Prisma (backend), React + TanStack Table + Radix + React Query (frontend), Vitest (frontend/sheets) + Jest (backend).

## Global Constraints

- Design source of truth: `docs/design/workspace-folders.md` → "Bulk multi-select move + drag-and-drop".
- Row click still opens the document — selection is checkbox-only (no behavior change to click).
- Bulk Move/Delete are enabled only when **every** selected document is `canManage`.
- Move is **atomic**: any missing/non-manageable id rejects the whole request (`403`/`400`), moving nothing.
- Keep the per-document `updatedAt` bump on move (matches the single-move path).
- Internal drag payload uses MIME `application/x-wafflebase-docs`; never `"Files"` (that belongs to `useWindowFileDrop`).
- Each commit: run the package's unit lane (`pnpm --filter <pkg> test` / `test:unit`) or `pnpm verify:fast`; note the known-flaky `TextEditSection` module-import test may need a retry.
- Commit subject ≤70 chars; body explains why; `Co-Authored-By` / `Claude-Session` trailers per repo convention.

---

## Task 1: Backend — bulk move endpoint

**Files:**
- Modify: `packages/backend/src/document/document.dto.ts`
- Modify: `packages/backend/src/document/document.service.ts` (add `moveDocuments`)
- Modify: `packages/backend/src/document/document.controller.ts` (add `moveDocuments`, before the `:id` PATCH)
- Test: `packages/backend/src/document/document.controller.spec.ts` (new)

**Interfaces:**
- Consumes: existing `DocumentService.document`, `WorkspaceService.assertMember`, `FolderService.assertSameWorkspace`, `resolveDocManager` (private), `isDocumentManager`.
- Produces:
  - `class MoveDocumentsDto { ids: string[]; workspaceId?: string; folderId?: string | null }`
  - `DocumentService.moveDocuments(updates: Array<{ id: string; data: Prisma.DocumentUpdateInput }>): Promise<number>`
  - `PATCH documents/move` → `{ moved: string[] }`

- [ ] **Step 1: Write the failing controller spec (move cases)**

Create `packages/backend/src/document/document.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { YorkieAdminService } from '../yorkie/yorkie-admin.service';
import { FileService } from '../file/file.service';
import { FolderService } from '../folder/folder.service';

const req = (id: number) => ({ user: { id } }) as any;

function makeController(overrides: {
  docs?: Record<string, any>;
  memberRole?: string; // role for assertMember
}) {
  const docs = overrides.docs ?? {};
  const documentService = {
    document: jest.fn(async ({ id }: { id: string }) => docs[id] ?? null),
    moveDocuments: jest.fn(async () => Object.keys(docs).length),
    deleteDocuments: jest.fn(async () => 0),
    deleteDocument: jest.fn(),
  };
  const workspaceService = {
    assertMember: jest.fn(async () => ({ role: overrides.memberRole ?? 'owner' })),
  };
  const folderService = { assertSameWorkspace: jest.fn(async () => undefined) };
  const controller = new DocumentController(
    documentService as any,
    workspaceService as any,
    {} as any,
    { delete: jest.fn() } as any,
    folderService as any,
  );
  return { controller, documentService, workspaceService, folderService };
}

describe('DocumentController.moveDocuments', () => {
  it('rejects an empty id list', async () => {
    const { controller } = makeController({});
    await expect(
      controller.moveDocuments(req(1), { ids: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves all documents into a folder in one call', async () => {
    const { controller, documentService, folderService } = makeController({
      docs: {
        a: { id: 'a', workspaceId: 'ws1', authorID: 1 },
        b: { id: 'b', workspaceId: 'ws1', authorID: 1 },
      },
    });
    const res = await controller.moveDocuments(req(1), {
      ids: ['a', 'b'],
      folderId: 'fld1',
    });
    expect(res).toEqual({ moved: ['a', 'b'] });
    expect(folderService.assertSameWorkspace).toHaveBeenCalledWith('fld1', 'ws1');
    expect(documentService.moveDocuments).toHaveBeenCalledWith([
      { id: 'a', data: { folder: { connect: { id: 'fld1' } } } },
      { id: 'b', data: { folder: { connect: { id: 'fld1' } } } },
    ]);
  });

  it('rejects atomically when one id is not managed by the caller', async () => {
    const { controller, documentService } = makeController({
      docs: {
        a: { id: 'a', workspaceId: 'ws1', authorID: 1 },
        b: { id: 'b', workspaceId: 'ws1', authorID: 999 }, // not author
      },
      memberRole: 'member', // not owner → not manager of b
    });
    await expect(
      controller.moveDocuments(req(1), { ids: ['a', 'b'], folderId: 'fld1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.moveDocuments).not.toHaveBeenCalled();
  });

  it('moves folderId:null to workspace root (disconnect)', async () => {
    const { controller, documentService } = makeController({
      docs: { a: { id: 'a', workspaceId: 'ws1', authorID: 1 } },
    });
    await controller.moveDocuments(req(1), { ids: ['a'], folderId: null });
    expect(documentService.moveDocuments).toHaveBeenCalledWith([
      { id: 'a', data: { folder: { disconnect: true } } },
    ]);
  });
});
```

- [ ] **Step 2: Run the spec — expect FAIL**

Run: `pnpm --filter @wafflebase/backend test -- document.controller`
Expected: FAIL — `controller.moveDocuments is not a function` (and `documentService.moveDocuments` undefined).

- [ ] **Step 3: Add the DTO**

In `packages/backend/src/document/document.dto.ts`, add imports `ArrayNotEmpty`, `IsArray` to the `class-validator` import, then append:

```ts
export class MoveDocumentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  ids: string[];

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  // `undefined` = leave folder unchanged; explicit `null` = workspace root.
  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}

export class DeleteDocumentsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  ids: string[];
}
```

- [ ] **Step 4: Add the service method**

In `packages/backend/src/document/document.service.ts`, add after `updateDocument`:

```ts
  /**
   * Apply a set of document updates in a single transaction, bumping each
   * document's `updatedAt` (matching {@link updateDocument}). Used by the bulk
   * move endpoint so N relocations are atomic. Validation of who may move what
   * happens in the controller before this runs.
   */
  async moveDocuments(
    updates: Array<{ id: string; data: Prisma.DocumentUpdateInput }>,
  ): Promise<number> {
    if (updates.length === 0) return 0;
    const at = new Date();
    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.document.update({
          where: { id: u.id },
          data: { ...u.data, updatedAt: at },
        }),
      ),
    );
    return updates.length;
  }
```

- [ ] **Step 5: Add the controller endpoint (before the `:id` PATCH)**

In `packages/backend/src/document/document.controller.ts`: import `BadRequestException` from `@nestjs/common`, and add `MoveDocumentsDto` to the `./document.dto` import. Insert this method **immediately before** `@Patch('documents/:id')` (route order matters — Nest matches `documents/move` to `:id` otherwise):

```ts
  // Bulk move must be declared before `documents/:id` so the literal `move`
  // segment isn't captured as an `:id`. Atomic: any missing / non-manageable
  // id rejects the whole request before any write.
  @Patch('documents/move')
  async moveDocuments(
    @Req() req: AuthenticatedRequest,
    @Body() body: MoveDocumentsDto,
  ): Promise<{ moved: string[] }> {
    const userId = Number(req.user.id);
    if (body.ids.length === 0) {
      throw new BadRequestException('No documents specified');
    }
    const docs = await Promise.all(
      body.ids.map((id) => this.documentService.document({ id })),
    );
    const denied: string[] = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (!doc || !(await this.resolveDocManager(doc, userId))) {
        denied.push(body.ids[i]);
      }
    }
    if (denied.length > 0) {
      throw new ForbiddenException(
        `Cannot move documents you do not manage: ${denied.join(', ')}`,
      );
    }
    if (body.workspaceId !== undefined) {
      await this.workspaceService.assertMember(body.workspaceId, userId);
    }
    const updates: Array<{ id: string; data: Prisma.DocumentUpdateInput }> = [];
    for (const doc of docs) {
      const data: Prisma.DocumentUpdateInput = {};
      if (body.workspaceId !== undefined) {
        data.workspace = { connect: { id: body.workspaceId } };
        if (
          body.workspaceId !== doc!.workspaceId &&
          body.folderId === undefined
        ) {
          data.folder = { disconnect: true };
        }
      }
      if (body.folderId !== undefined) {
        if (body.folderId === null) {
          data.folder = { disconnect: true };
        } else {
          const targetWorkspaceId = body.workspaceId ?? doc!.workspaceId;
          await this.folderService.assertSameWorkspace(
            body.folderId,
            targetWorkspaceId,
          );
          data.folder = { connect: { id: body.folderId } };
        }
      }
      updates.push({ id: doc!.id, data });
    }
    await this.documentService.moveDocuments(updates);
    return { moved: updates.map((u) => u.id) };
  }
```

Add `import { Prisma } from '@prisma/client';` if not already imported (the file currently imports only `Document as DocumentModel`).

- [ ] **Step 6: Run the spec — expect PASS**

Run: `pnpm --filter @wafflebase/backend test -- document.controller`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/document/document.dto.ts \
        packages/backend/src/document/document.service.ts \
        packages/backend/src/document/document.controller.ts \
        packages/backend/src/document/document.controller.spec.ts
git commit -m "Add bulk document move endpoint (atomic, per-id gated)"
```

---

## Task 2: Backend — bulk delete endpoint

**Files:**
- Modify: `packages/backend/src/document/document.service.ts` (add `deleteDocuments`)
- Modify: `packages/backend/src/document/document.controller.ts` (add `deleteDocuments`)
- Test: `packages/backend/src/document/document.controller.spec.ts` (extend)

**Interfaces:**
- Consumes: `DeleteDocumentsDto` (Task 1), `resolveDocManager`, `FileService.delete`, `VALID_FILE_ID_PATTERN`.
- Produces:
  - `DocumentService.deleteDocuments(ids: string[]): Promise<number>`
  - `POST documents/delete` → `{ deleted: string[] }`

- [ ] **Step 1: Add the failing delete spec**

Append to `document.controller.spec.ts`:

```ts
describe('DocumentController.deleteDocuments', () => {
  it('deletes all when the caller manages every id', async () => {
    const { controller, documentService } = makeController({
      docs: {
        a: { id: 'a', workspaceId: 'ws1', authorID: 1, fileId: null },
        b: { id: 'b', workspaceId: 'ws1', authorID: 1, fileId: null },
      },
    });
    const res = await controller.deleteDocuments(req(1), { ids: ['a', 'b'] });
    expect(res).toEqual({ deleted: ['a', 'b'] });
    expect(documentService.deleteDocuments).toHaveBeenCalledWith(['a', 'b']);
  });

  it('rejects atomically when one id is not managed', async () => {
    const { controller, documentService } = makeController({
      docs: {
        a: { id: 'a', workspaceId: 'ws1', authorID: 1 },
        b: { id: 'b', workspaceId: 'ws1', authorID: 999 },
      },
      memberRole: 'member',
    });
    await expect(
      controller.deleteDocuments(req(1), { ids: ['a', 'b'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.deleteDocuments).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`controller.deleteDocuments is not a function`)

Run: `pnpm --filter @wafflebase/backend test -- document.controller`

- [ ] **Step 3: Add the service method**

In `document.service.ts`, after `deleteDocument`:

```ts
  /**
   * Delete many documents by id. Blob cleanup for file-backed types (pdf /
   * image) is done best-effort by the controller after this returns.
   */
  async deleteDocuments(ids: string[]): Promise<number> {
    const { count } = await this.prisma.document.deleteMany({
      where: { id: { in: ids } },
    });
    return count;
  }
```

- [ ] **Step 4: Add the controller endpoint**

In `document.controller.ts`, add `DeleteDocumentsDto` to the dto import and insert after `deleteDocument`:

```ts
  @Post('documents/delete')
  async deleteDocuments(
    @Req() req: AuthenticatedRequest,
    @Body() body: DeleteDocumentsDto,
  ): Promise<{ deleted: string[] }> {
    const userId = Number(req.user.id);
    if (body.ids.length === 0) {
      throw new BadRequestException('No documents specified');
    }
    const docs = await Promise.all(
      body.ids.map((id) => this.documentService.document({ id })),
    );
    const denied: string[] = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (!doc || !(await this.resolveDocManager(doc, userId))) {
        denied.push(body.ids[i]);
      }
    }
    if (denied.length > 0) {
      throw new ForbiddenException(
        `Cannot delete documents you do not manage: ${denied.join(', ')}`,
      );
    }
    await this.documentService.deleteDocuments(body.ids);
    // Best-effort blob cleanup for file-backed docs (parity with the single
    // delete); a failed cleanup must not fail the delete.
    for (const doc of docs) {
      if (doc?.fileId && VALID_FILE_ID_PATTERN.test(doc.fileId)) {
        await this.fileService.delete(doc.fileId).catch((err) => {
          console.warn(
            `[DocumentController] Failed to delete blob ${doc.fileId}:`,
            err instanceof Error ? err.message : err,
          );
        });
      }
    }
    return { deleted: body.ids };
  }
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @wafflebase/backend test -- document.controller`
Expected: PASS (6 tests total).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/document/document.service.ts \
        packages/backend/src/document/document.controller.ts \
        packages/backend/src/document/document.controller.spec.ts
git commit -m "Add bulk document delete endpoint (per-id gated)"
```

---

## Task 3: Frontend — bulk move/delete API functions

**Files:**
- Modify: `packages/frontend/src/api/documents.ts`
- Test: `packages/frontend/src/api/documents.test.ts` (new)

**Interfaces:**
- Produces:
  - `moveDocuments(ids: string[], target: { workspaceId?: string; folderId?: string | null }): Promise<{ moved: string[] }>`
  - `deleteDocuments(ids: string[]): Promise<{ deleted: string[] }>`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/api/documents.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fetchWithAuth } from "./auth";
import { moveDocuments, deleteDocuments } from "./documents";

const mockFetch = vi.mocked(fetchWithAuth);

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe("moveDocuments", () => {
  beforeEach(() => mockFetch.mockReset());

  it("PATCHes documents/move with ids + target", async () => {
    mockFetch.mockResolvedValue(okJson({ moved: ["a", "b"] }));
    const res = await moveDocuments(["a", "b"], { folderId: "fld1" });
    expect(res).toEqual({ moved: ["a", "b"] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/documents\/move$/);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init!.body as string)).toEqual({
      ids: ["a", "b"],
      folderId: "fld1",
    });
  });
});

describe("deleteDocuments", () => {
  beforeEach(() => mockFetch.mockReset());

  it("POSTs documents/delete with ids", async () => {
    mockFetch.mockResolvedValue(okJson({ deleted: ["a"] }));
    const res = await deleteDocuments(["a"]);
    expect(res).toEqual({ deleted: ["a"] });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toMatch(/\/documents\/delete$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ ids: ["a"] });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @wafflebase/frontend test -- documents.test`
Expected: FAIL — `moveDocuments is not exported`.

- [ ] **Step 3: Implement the API functions**

Append to `packages/frontend/src/api/documents.ts`:

```ts
/**
 * Moves many documents at once. Atomic on the server: if the caller does not
 * manage every id the whole request is rejected. Omit a field to leave it
 * unchanged; pass `folderId: null` to move to the workspace root.
 */
export async function moveDocuments(
  ids: string[],
  target: { workspaceId?: string; folderId?: string | null }
): Promise<{ moved: string[] }> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/move`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, ...target }),
    }
  );
  await assertOk(response, "Failed to move documents");
  return response.json();
}

/**
 * Deletes many documents at once (manager-gated per id on the server).
 */
export async function deleteDocuments(
  ids: string[]
): Promise<{ deleted: string[] }> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }
  );
  await assertOk(response, "Failed to delete documents");
  return response.json();
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @wafflebase/frontend test -- documents.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/api/documents.ts packages/frontend/src/api/documents.test.ts
git commit -m "Add bulk moveDocuments/deleteDocuments frontend API"
```

---

## Task 4: Frontend — bulk selection helpers (drag payload + manageable check)

**Files:**
- Create: `packages/frontend/src/app/documents/document-bulk.ts`
- Test: `packages/frontend/src/app/documents/__tests__/document-bulk.test.ts` (new)

**Interfaces:**
- Produces:
  - `const DOC_DRAG_MIME = "application/x-wafflebase-docs"`
  - `encodeDocDrag(dt: DataTransfer, ids: string[]): void`
  - `decodeDocDrag(dt: DataTransfer): string[] | null`
  - `isDocDrag(dt: DataTransfer): boolean`
  - `allManageable(ids: string[], docs: Array<{ id: string; canManage: boolean }>): boolean`

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/app/documents/__tests__/document-bulk.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DOC_DRAG_MIME,
  encodeDocDrag,
  decodeDocDrag,
  isDocDrag,
  allManageable,
} from "../document-bulk";

// Minimal DataTransfer stub (jsdom's is incomplete for setData/getData).
function fakeDataTransfer() {
  const store: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => (store[k] = v),
    getData: (k: string) => store[k] ?? "",
    get types() {
      return Object.keys(store);
    },
    effectAllowed: "none",
  } as unknown as DataTransfer;
}

describe("doc drag payload", () => {
  it("round-trips ids through the custom MIME type", () => {
    const dt = fakeDataTransfer();
    encodeDocDrag(dt, ["a", "b"]);
    expect(isDocDrag(dt)).toBe(true);
    expect(decodeDocDrag(dt)).toEqual(["a", "b"]);
  });

  it("does NOT claim OS-file drags", () => {
    const dt = fakeDataTransfer();
    (dt as { setData: (k: string, v: string) => void }).setData("Files", "x");
    expect(isDocDrag(dt)).toBe(false);
    expect(decodeDocDrag(dt)).toBeNull();
  });

  it("returns null on malformed payload", () => {
    const dt = fakeDataTransfer();
    (dt as { setData: (k: string, v: string) => void }).setData(
      DOC_DRAG_MIME,
      "not json",
    );
    expect(decodeDocDrag(dt)).toBeNull();
  });
});

describe("allManageable", () => {
  const docs = [
    { id: "a", canManage: true },
    { id: "b", canManage: true },
    { id: "c", canManage: false },
  ];
  it("true only when every selected doc is manageable", () => {
    expect(allManageable(["a", "b"], docs)).toBe(true);
    expect(allManageable(["a", "c"], docs)).toBe(false);
  });
  it("false on empty selection", () => {
    expect(allManageable([], docs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module not found)

Run: `pnpm --filter @wafflebase/frontend test -- document-bulk`

- [ ] **Step 3: Implement the helper module**

Create `packages/frontend/src/app/documents/document-bulk.ts`:

```ts
/**
 * Bulk-selection helpers for the documents list: a custom-MIME drag payload
 * (kept disjoint from the `useWindowFileDrop` OS-file drop, which keys on the
 * `"Files"` type) and a whole-selection permission check.
 */

export const DOC_DRAG_MIME = "application/x-wafflebase-docs";

/** Write the dragged document ids onto the drag event's dataTransfer. */
export function encodeDocDrag(dt: DataTransfer, ids: string[]): void {
  dt.setData(DOC_DRAG_MIME, JSON.stringify(ids));
  dt.effectAllowed = "move";
}

/** Read document ids from a drop, or null if this isn't a document drag. */
export function decodeDocDrag(dt: DataTransfer): string[] | null {
  const raw = dt.getData(DOC_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string")
      ? (parsed as string[])
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether a drag currently in flight is a document drag. Uses `types` (the
 * only thing readable during `dragover`, when `getData` is blocked).
 */
export function isDocDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(DOC_DRAG_MIME);
}

/** True iff `ids` is non-empty and every id maps to a manageable document. */
export function allManageable(
  ids: string[],
  docs: Array<{ id: string; canManage: boolean }>
): boolean {
  if (ids.length === 0) return false;
  const byId = new Map(docs.map((d) => [d.id, d]));
  return ids.every((id) => byId.get(id)?.canManage === true);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @wafflebase/frontend test -- document-bulk`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/documents/document-bulk.ts \
        packages/frontend/src/app/documents/__tests__/document-bulk.test.ts
git commit -m "Add documents bulk-selection helpers (drag payload, manageable)"
```

---

## Task 5: Frontend — checkbox select column

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx`

**Interfaces:**
- Consumes: existing `rowSelection`/`setRowSelection` state (`document-list.tsx:613,646,651`), TanStack `table`.
- Produces: a leading `"select"` column with header select-all + per-row checkbox + shift-range.

This task and the following are UI wiring in a 1300-line component with no existing RTL harness; verify by typecheck + build + manual smoke (steps below), not a new component test.

- [ ] **Step 1: Import the Checkbox and add a range-anchor ref**

Add near the other `@/components/ui` imports:

```ts
import { Checkbox } from "@/components/ui/checkbox";
```

Inside `DocumentList`, next to the other refs (near `refreshTimer`), add:

```ts
  // Anchor row for shift-click range selection (index into the sorted rows).
  const lastSelectedIndex = useRef<number | null>(null);
```

- [ ] **Step 2: Prepend the select column**

In the `columns` array (starts `document-list.tsx:267`), insert as the **first** element (before the `id` column):

```ts
    {
      id: "select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select all"
        />
      ),
      cell: ({ row, table }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          onClick={(e) => {
            e.stopPropagation();
            const rows = table.getSortedRowModel().rows;
            const idx = rows.findIndex((r) => r.id === row.id);
            if (e.shiftKey && lastSelectedIndex.current !== null) {
              const [lo, hi] = [lastSelectedIndex.current, idx].sort(
                (a, b) => a - b,
              );
              const next: Record<string, boolean> = {};
              for (let i = lo; i <= hi; i++) next[rows[i].id] = true;
              table.setRowSelection((prev) => ({ ...prev, ...next }));
            }
            lastSelectedIndex.current = idx;
          }}
          aria-label={`Select ${String(row.getValue("title") ?? "document")}`}
        />
      ),
    },
```

Note: the existing row `onClick` already ignores clicks that land on `input, button` (`document-list.tsx:848`); the Radix checkbox renders a `button[role="checkbox"]`, and the explicit `stopPropagation` above is belt-and-suspenders, so ticking a box never navigates.

- [ ] **Step 3: Keep the empty-state colSpan correct**

The empty-state cell uses `colSpan={columns.length}` (`document-list.tsx:875`) — since it derives from `columns`, the new column is counted automatically. No change needed; confirm by reading that line.

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @wafflebase/frontend build`
Expected: build succeeds, no TS errors.

- [ ] **Step 5: Manual smoke**

Run `pnpm dev`, open a workspace with ≥3 documents. Confirm: per-row checkboxes appear; header checkbox selects/clears all and shows an indeterminate state on partial selection; shift-clicking a second box selects the contiguous range; clicking a checkbox does not open the document; clicking a row (not the box) still opens it.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/documents/document-list.tsx
git commit -m "Add multi-select checkbox column to documents list"
```

---

## Task 6: Frontend — generalize move/delete dialogs to id-sets

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx`

**Interfaces:**
- Consumes: `moveDocuments`, `deleteDocuments` (Task 3).
- Produces: `moving: { ids: string[]; title: string; workspaceId: string } | null` and `deleting: { ids: string[]; title: string } | null` state; both the per-row menu and (Task 7) the action bar route through them.

- [ ] **Step 1: Replace the single-doc move/delete state**

Change the state declarations (`document-list.tsx:396-408`):

```ts
  const [deleting, setDeleting] = useState<{
    ids: string[];
    title: string;
  } | null>(null);
  const [renamingDoc, setRenamingDoc] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [moving, setMoving] = useState<{
    ids: string[];
    title: string;
    workspaceId: string;
  } | null>(null);
```

Update the `workspaces`/`moveTargetFolders` query `enabled` guards (`document-list.tsx:425,431`) from `movingDoc !== null` to `moving !== null`.

- [ ] **Step 2: Import the bulk API + helper**

```ts
import { moveDocuments, deleteDocuments } from "@/api/documents";
import { allManageable } from "./document-bulk";
```

- [ ] **Step 3: Replace the move/delete mutations with bulk versions**

Replace `deleteDocumentMutation` (`document-list.tsx:513-523`) and `moveDocumentMutation` (`539-561`):

```ts
  const deleteDocumentsMutation = useMutation({
    mutationFn: async (ids: string[]) => await deleteDocuments(ids),
    onSuccess: (_res, ids) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      if (workspaceId) {
        queryClient.invalidateQueries({
          queryKey: ["workspaces", workspaceId, "documents"],
        });
      }
      setRowSelection((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      setDeleting(null);
      toast.success(
        ids.length > 1 ? `${ids.length} documents deleted` : "Document deleted",
      );
    },
    onError: () => toast.error("Failed to delete documents"),
  });

  const moveDocumentsMutation = useMutation({
    mutationFn: async ({
      ids,
      workspaceId: targetId,
      folderId: targetFid,
    }: {
      ids: string[];
      workspaceId?: string;
      folderId?: string | null;
    }) => await moveDocuments(ids, { workspaceId: targetId, folderId: targetFid }),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(
        vars.ids.length > 1
          ? `${vars.ids.length} documents moved`
          : "Document moved successfully",
      );
      setMoving(null);
      setTargetWorkspaceId("");
      setTargetFolderId(null);
      setRowSelection((prev) => {
        const next = { ...prev };
        for (const id of vars.ids) delete next[id];
        return next;
      });
    },
    onError: () => toast.error("Failed to move documents"),
  });
```

- [ ] **Step 4: Rewire the per-row menu items**

In the `actions` column (`document-list.tsx:357-388`), update the Move and Delete `onClick`s:

```ts
                    setMoving({
                      ids: [String(row.getValue("id"))],
                      title: row.getValue("title"),
                      workspaceId: row.original.workspaceId,
                    });
                    setTargetWorkspaceId(row.original.workspaceId);
                    setTargetFolderId(null);
```

```ts
                    setDeleting({
                      ids: [String(row.getValue("id"))],
                      title: row.getValue("title"),
                    });
```

- [ ] **Step 5: Update the move dialog**

In the move `Dialog` (`document-list.tsx:1019-1114`): change `open={movingDoc !== null}` → `open={moving !== null}`; the `onOpenChange` and Cancel handlers `setMovingDoc(null)` → `setMoving(null)`; the description "&ldquo;{movingDoc?.title}&rdquo;" → "&ldquo;{moving?.title}&rdquo;"; the submit handler:

```ts
              onClick={() => {
                if (moving && targetWorkspaceId) {
                  moveDocumentsMutation.mutate({
                    ids: moving.ids,
                    workspaceId: targetWorkspaceId,
                    folderId: targetFolderId,
                  });
                }
              }}
```

and its `disabled={!targetWorkspaceId || moveDocumentsMutation.isPending}`.

- [ ] **Step 6: Update the delete dialog**

In the delete `Dialog` (`document-list.tsx:1116-1153`): `open={deleting !== null}`; handlers `setDeletingDoc(null)` → `setDeleting(null)`; title stays "Delete Document" but make it plural-aware — replace the `DialogDescription` body with:

```tsx
              Are you sure you want to delete{" "}
              {deleting && deleting.ids.length > 1
                ? `${deleting.ids.length} documents`
                : `“${deleting?.title}”`}
              ? This action cannot be undone.
```

and the confirm button:

```ts
              disabled={deleteDocumentsMutation.isPending}
              onClick={() => {
                if (deleting) deleteDocumentsMutation.mutate(deleting.ids);
              }}
```

- [ ] **Step 7: Typecheck + build**

Run: `pnpm --filter @wafflebase/frontend build`
Expected: no TS errors (all `movingDoc`/`deletingDoc`/`moveDocumentMutation`/`deleteDocumentMutation` references resolved).

- [ ] **Step 8: Manual smoke**

`pnpm dev`: the per-row "Move to…" and "Delete" still work exactly as before (single doc). Move shows workspace/folder pickers; delete confirms.

- [ ] **Step 9: Commit**

```bash
git add packages/frontend/src/app/documents/document-list.tsx
git commit -m "Generalize move/delete dialogs to document id-sets"
```

---

## Task 7: Frontend — bulk action bar

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx`

**Interfaces:**
- Consumes: `rowSelection`, `filteredData`, `allManageable`, `setMoving`/`setDeleting`, `setTargetWorkspaceId`/`setTargetFolderId`.

- [ ] **Step 1: Derive selection info before the return**

After `childFolders` (`document-list.tsx:658-660`), add:

```ts
  const selectedIds = Object.keys(rowSelection);
  const selectedCanManage = allManageable(
    selectedIds,
    filteredData.map((d) => ({ id: String(d.id), canManage: d.canManage })),
  );
  // Common source workspace of the selection (for the move dialog's initial
  // target); "" when the selection spans workspaces (only possible on the
  // global /documents list).
  const selectedWorkspaceId = (() => {
    const set = filteredData.filter((d) => selectedIds.includes(String(d.id)));
    const wss = new Set(set.map((d) => d.workspaceId));
    return wss.size === 1 ? [...wss][0] : "";
  })();

  const openBulkMove = () => {
    setMoving({
      ids: selectedIds,
      title: `${selectedIds.length} items`,
      workspaceId: selectedWorkspaceId,
    });
    setTargetWorkspaceId(selectedWorkspaceId);
    setTargetFolderId(null);
  };
```

- [ ] **Step 2: Render the action bar**

Immediately before `<div className="rounded-md border">` (the table wrapper, `document-list.tsx:817`), insert:

```tsx
      {selectedIds.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selectedIds.length} selected</span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedCanManage}
              title={
                selectedCanManage
                  ? undefined
                  : "You can only move documents you own"
              }
              onClick={openBulkMove}
            >
              <FolderOutput className="mr-1 h-4 w-4" />
              Move to…
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={!selectedCanManage}
              title={
                selectedCanManage
                  ? undefined
                  : "You can only delete documents you own"
              }
              onClick={() =>
                setDeleting({
                  ids: selectedIds,
                  title: `${selectedIds.length} documents`,
                })
              }
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Clear selection"
              onClick={() => setRowSelection({})}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
```

Add `X` to the existing `lucide-react` import if not present (`FolderOutput` and `Trash2` are already imported for the row menu).

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter @wafflebase/frontend build`
Expected: no TS errors.

- [ ] **Step 4: Manual smoke**

`pnpm dev`: selecting ≥1 doc shows the bar with the count; "Move to…" opens the dialog pre-filled with the common workspace and moves all selected; "Delete" confirms and removes all selected; clearing (X) empties the selection; when the selection includes a doc you don't manage, Move/Delete are disabled with a tooltip.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/documents/document-list.tsx
git commit -m "Add bulk action bar (move/delete/clear) to documents list"
```

---

## Task 8: Frontend — drag-and-drop onto folders

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx`
- Modify: `packages/frontend/src/app/documents/folder-breadcrumb.tsx`

**Interfaces:**
- Consumes: `encodeDocDrag`, `decodeDocDrag`, `isDocDrag` (Task 4), `moveDocumentsMutation`, `rowSelection`.
- Produces: draggable rows; folder cards + breadcrumb segments as drop targets.

- [ ] **Step 1: Import the drag helpers + add hover state**

```ts
import { encodeDocDrag, decodeDocDrag, isDocDrag, allManageable } from "./document-bulk";
```
(extend the Task 6 import). Add state near the others:

```ts
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null | "root">(null);
```

- [ ] **Step 2: Make rows draggable**

On the body `<TableRow>` (`document-list.tsx:840`), add these props (keep the existing ones):

```tsx
                  draggable={row.original.canManage}
                  onDragStart={(e) => {
                    const id = String(row.original.id);
                    const selected = Object.keys(rowSelection);
                    const ids =
                      row.getIsSelected() && selected.length > 0
                        ? selected
                        : [id];
                    encodeDocDrag(e.dataTransfer, ids);
                  }}
```

- [ ] **Step 3: Make folder cards drop targets**

On the folder card `<div>` (`document-list.tsx:770-773`), add:

```tsx
              onDragOver={(e) => {
                if (!isDocDrag(e.dataTransfer)) return;
                e.preventDefault();
                setDragOverFolderId(f.id);
              }}
              onDragLeave={() => setDragOverFolderId((cur) => (cur === f.id ? null : cur))}
              onDrop={(e) => {
                const ids = decodeDocDrag(e.dataTransfer);
                setDragOverFolderId(null);
                if (!ids || ids.length === 0) return;
                e.preventDefault();
                if (
                  !allManageable(
                    ids,
                    filteredData.map((d) => ({
                      id: String(d.id),
                      canManage: d.canManage,
                    })),
                  )
                ) {
                  toast.error("You can only move documents you own");
                  return;
                }
                // Folder cards only render inside a workspace, so the
                // component's `workspaceId` prop is the target workspace (the
                // frontend `Folder` type carries no workspaceId).
                moveDocumentsMutation.mutate({
                  ids,
                  workspaceId,
                  folderId: f.id,
                });
              }}
```

and reflect the hover on the same `<div>`'s className, e.g. append:

```tsx
              className={`flex items-center gap-2 rounded-md border pl-3 pr-1 py-2 text-sm hover:bg-muted ${
                dragOverFolderId === f.id ? "ring-2 ring-primary" : ""
              }`}
```

- [ ] **Step 4: Make breadcrumb segments drop targets**

In `folder-breadcrumb.tsx`, add an optional prop and wire drop handlers on each button:

```tsx
export function FolderBreadcrumb({
  folders,
  folderId,
  onNavigate,
  onDropDocs,
}: {
  folders: Folder[];
  folderId: string | null;
  onNavigate: (id: string | null) => void;
  onDropDocs?: (targetFolderId: string | null, dataTransfer: DataTransfer) => void;
}) {
```

On the "Home" button add `onDragOver={(e) => onDropDocs && e.preventDefault()}` and `onDrop={(e) => onDropDocs?.(null, e.dataTransfer)}`; on each segment button the same with `f.id`.

Then in `document-list.tsx`, pass the handler to the two `FolderBreadcrumb` usages (`document-list.tsx:667`):

```tsx
            onDropDocs={(targetFolderId, dt) => {
              const ids = decodeDocDrag(dt);
              if (!ids || ids.length === 0 || !workspaceId) return;
              if (
                !allManageable(
                  ids,
                  filteredData.map((d) => ({
                    id: String(d.id),
                    canManage: d.canManage,
                  })),
                )
              ) {
                toast.error("You can only move documents you own");
                return;
              }
              moveDocumentsMutation.mutate({
                ids,
                workspaceId,
                folderId: targetFolderId,
              });
            }}
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @wafflebase/frontend build`
Expected: no TS errors.

- [ ] **Step 6: Manual smoke (incl. coexistence with upload DnD)**

`pnpm dev`, in a workspace with at least one subfolder:
- Drag a single unselected row onto a folder card → it moves there; the card highlights on hover.
- Select several rows, drag one of them onto a folder → all selected move.
- Drag onto a breadcrumb segment / "Home" → moves to that ancestor / root.
- Drag an **OS file** from the desktop onto the window → the upload overlay still appears (upload DnD unaffected); the folder cards do not highlight.
- Dragging a row you don't manage: the row isn't draggable (no `canManage`).

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/app/documents/document-list.tsx \
        packages/frontend/src/app/documents/folder-breadcrumb.tsx
git commit -m "Add drag-and-drop of documents onto folders + breadcrumb"
```

---

## Final verification

- [ ] `pnpm verify:fast` green (retry the known-flaky `TextEditSection` import test if it times out).
- [ ] `pnpm --filter @wafflebase/backend test -- document.controller` and `pnpm --filter @wafflebase/frontend test -- "documents.test|document-bulk"` all green.
- [ ] `pnpm --filter @wafflebase/frontend build` green.
- [ ] Manual end-to-end in `pnpm dev`: multi-select → dialog move, multi-select → DnD move, multi-select → bulk delete, permission-gated disable, and OS-file upload DnD still works.
- [ ] Dispatch a code review over the branch diff (`/code-review` or `superpowers:requesting-code-review`); apply blocking findings.
- [ ] Fill in the Review section of the todo file; capture lessons; `pnpm tasks:archive && pnpm tasks:index`.

## Notes / deviations from the design doc

- **Shift-range selection** is implemented manually (TanStack has no built-in shift-range for row selection); it's contained in the select column's cell `onClick` and is a droppable nicety if it misbehaves.
- Delete confirmation reuses the single dialog with plural-aware copy rather than a separate bulk dialog (DRY).
