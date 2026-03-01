# Workspace Delete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow workspace owners to permanently delete a workspace and all its data from the settings page, with safety guards.

**Architecture:** Add `onDelete: Cascade` to Document and DataSource relations so Postgres handles cleanup. Add a last-workspace guard in the backend service. Add a Danger Zone UI section with a name-confirmation dialog in the frontend settings page.

**Tech Stack:** Prisma (migration), NestJS (service), React 19, TanStack Query, Radix Dialog, TailwindCSS

---

## Task 1: Add database cascades for Document and DataSource

**Files:**
- Modify: `packages/backend/prisma/schema.prisma:28` (DataSource workspace relation)
- Modify: `packages/backend/prisma/schema.prisma:39` (Document workspace relation)
- Create: new Prisma migration

**Step 1: Update DataSource model in schema.prisma**

Change line 28 from:

```prisma
workspace   Workspace @relation(fields: [workspaceId], references: [id])
```

to:

```prisma
workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
```

**Step 2: Update Document model in schema.prisma**

Change line 39 from:

```prisma
workspace   Workspace @relation(fields: [workspaceId], references: [id])
```

to:

```prisma
workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
```

**Step 3: Generate Prisma migration**

Run: `cd packages/backend && npx prisma migrate dev --name add_workspace_cascade_deletes`

Expected: Migration created successfully. The SQL should contain `ALTER TABLE` statements adding `ON DELETE CASCADE` to the foreign keys on `Document` and `DataSource`.

**Step 4: Commit**

```
git add packages/backend/prisma/schema.prisma packages/backend/prisma/migrations/
git commit -m "Add cascade deletes for Document and DataSource on workspace"
```

---

## Task 2: Add last-workspace deletion guard in backend service

**Files:**
- Modify: `packages/backend/src/workspace/workspace.service.ts:63-66` (remove method)

**Step 1: Write the failing test**

Add to `packages/backend/src/workspace/workspace.service.spec.ts` inside `describe('remove', ...)`:

```typescript
it('throws ForbiddenException if workspace is the users last', async () => {
  prisma.workspaceMember.findUnique.mockResolvedValue({
    role: 'owner',
  });
  prisma.workspaceMember.count.mockResolvedValue(1);

  await expect(
    service.remove('11111111-1111-1111-1111-111111111111', 1),
  ).rejects.toBeInstanceOf(ForbiddenException);
});

it('deletes workspace when user has multiple workspaces', async () => {
  prisma.workspaceMember.findUnique.mockResolvedValue({
    role: 'owner',
  });
  prisma.workspaceMember.count.mockResolvedValue(2);
  prisma.workspace.delete.mockResolvedValue({
    id: '11111111-1111-1111-1111-111111111111',
  });

  const result = await service.remove('11111111-1111-1111-1111-111111111111', 1);

  expect(result).toEqual({ id: '11111111-1111-1111-1111-111111111111' });
  expect(prisma.workspace.delete).toHaveBeenCalledWith({
    where: { id: '11111111-1111-1111-1111-111111111111' },
  });
});
```

Also update the mock factory to include `count`:

```typescript
workspaceMember: {
  create: jest.fn(),
  findUnique: jest.fn(),
  findMany: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  count: jest.fn(),
},
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx jest workspace.service.spec.ts --verbose`

Expected: The new "throws ForbiddenException if workspace is the users last" test FAILS because the current `remove()` does not check workspace count. The "deletes workspace when user has multiple workspaces" test also FAILS because `count` is not called/mocked in the flow.

**Step 3: Implement the last-workspace guard**

In `packages/backend/src/workspace/workspace.service.ts`, replace the `remove` method (lines 63-66):

```typescript
async remove(workspaceId: string, userId: number) {
  await this.assertOwner(workspaceId, userId);
  const workspaceCount = await this.prisma.workspaceMember.count({
    where: { userId },
  });
  if (workspaceCount <= 1) {
    throw new ForbiddenException('Cannot delete your last workspace');
  }
  return this.prisma.workspace.delete({ where: { id: workspaceId } });
}
```

**Step 4: Update existing "deletes workspace if user is owner" test**

The existing test at line 193 must also mock `count` to return `>1`:

```typescript
it('deletes workspace if user is owner', async () => {
  prisma.workspaceMember.findUnique.mockResolvedValue({
    role: 'owner',
  });
  prisma.workspaceMember.count.mockResolvedValue(2);
  prisma.workspace.delete.mockResolvedValue({ id: '11111111-1111-1111-1111-111111111111' });

  const result = await service.remove('11111111-1111-1111-1111-111111111111', 1);

  expect(result).toEqual({ id: '11111111-1111-1111-1111-111111111111' });
  expect(prisma.workspace.delete).toHaveBeenCalledWith({
    where: { id: '11111111-1111-1111-1111-111111111111' },
  });
});
```

**Step 5: Run tests to verify they pass**

Run: `cd packages/backend && npx jest workspace.service.spec.ts --verbose`

Expected: ALL tests PASS.

**Step 6: Commit**

```
git add packages/backend/src/workspace/workspace.service.ts packages/backend/src/workspace/workspace.service.spec.ts
git commit -m "Add last-workspace deletion guard

Prevent users from deleting their only workspace, which would leave
them with no workspace to use."
```

---

## Task 3: Add Danger Zone UI and delete confirmation dialog

**Files:**
- Modify: `packages/frontend/src/app/workspaces/workspace-settings.tsx`

**Step 1: Add deleteWorkspace import**

At the top of the file, add `deleteWorkspace` to the import from `@/api/workspaces`:

```typescript
import {
  fetchWorkspace,
  updateWorkspace,
  deleteWorkspace,
  fetchInvites,
  createInvite,
  revokeInvite,
  removeMember,
  type WorkspaceDetail,
  type WorkspaceInvite,
} from "@/api/workspaces";
```

Also add `fetchWorkspaces` as a separate import since it returns a different type:

```typescript
import { fetchWorkspaces } from "@/api/workspaces";
```

Actually, both are from the same module so just add them to the same import block:

```typescript
import {
  fetchWorkspace,
  fetchWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  fetchInvites,
  createInvite,
  revokeInvite,
  removeMember,
  type WorkspaceDetail,
  type WorkspaceInvite,
} from "@/api/workspaces";
```

Add Dialog components import:

```typescript
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
```

**Step 2: Add state and mutation for delete**

Inside `WorkspaceSettings` component, after the existing state declarations, add:

```typescript
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [deleteConfirmName, setDeleteConfirmName] = useState("");

const deleteMutation = useMutation({
  mutationFn: () => deleteWorkspace(workspaceId!),
  onSuccess: async () => {
    queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    const remaining = await fetchWorkspaces();
    if (remaining.length > 0) {
      navigate(`/w/${remaining[0].slug}`, { replace: true });
    } else {
      navigate("/", { replace: true });
    }
    toast.success("Workspace deleted");
  },
  onError: (err: Error) => toast.error(err.message || "Failed to delete workspace"),
});
```

**Step 3: Add Danger Zone section**

After the Invites `</section>` closing tag (before the closing `</div>`), add:

```tsx
{/* Danger Zone */}
<section className="space-y-2">
  <h2 className="text-lg font-semibold text-red-600">Danger Zone</h2>
  <div className="rounded-md border border-red-300 p-4">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">Delete this workspace</p>
        <p className="text-sm text-muted-foreground">
          Once deleted, all documents, data sources, and member
          associations will be permanently removed.
        </p>
      </div>
      <Button
        variant="destructive"
        onClick={() => setDeleteDialogOpen(true)}
      >
        Delete this workspace
      </Button>
    </div>
  </div>
</section>

<Dialog open={deleteDialogOpen} onOpenChange={(open) => {
  setDeleteDialogOpen(open);
  if (!open) setDeleteConfirmName("");
}}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Delete workspace</DialogTitle>
      <DialogDescription>
        This will permanently delete <strong>{workspace.name}</strong> and
        all its data. This action cannot be undone.
      </DialogDescription>
    </DialogHeader>
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        deleteMutation.mutate();
      }}
    >
      <label className="text-sm text-muted-foreground">
        Type <strong>{workspace.name}</strong> to confirm:
      </label>
      <Input
        value={deleteConfirmName}
        onChange={(e) => setDeleteConfirmName(e.target.value)}
        className="mt-2"
        autoFocus
      />
      <DialogFooter className="mt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDeleteDialogOpen(false);
            setDeleteConfirmName("");
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={
            deleteConfirmName !== workspace.name ||
            deleteMutation.isPending
          }
        >
          Delete workspace
        </Button>
      </DialogFooter>
    </form>
  </DialogContent>
</Dialog>
```

**Step 4: Verify the build**

Run: `cd packages/frontend && npx tsc --noEmit`

Expected: No type errors.

**Step 5: Commit**

```
git add packages/frontend/src/app/workspaces/workspace-settings.tsx
git commit -m "Add workspace delete UI with confirmation dialog

Add a Danger Zone section to workspace settings with a delete button
that requires typing the workspace name to confirm deletion."
```

---

## Task 4: Run full verification

**Step 1: Run fast verification**

Run: `pnpm verify:fast`

Expected: All lint and unit tests pass.

**Step 2: Run frontend build**

Run: `pnpm frontend build`

Expected: Build succeeds without errors.

**Step 3: Run backend build**

Run: `pnpm backend build`

Expected: Build succeeds without errors.

**Step 4: Final commit (if any fixes needed)**

If any fixes were needed, commit them.
