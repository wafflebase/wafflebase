# Workspace Delete Feature

## Summary

Add workspace deletion UI to the settings page, strengthen backend delete
logic, and fix missing database cascades for Document and DataSource.

## Design Decisions

- **Hard delete** with full cascade (not soft delete)
- **Confirmation**: user must type workspace name to confirm
- **UI location**: Danger Zone section at bottom of workspace settings page
- **Post-delete navigation**: redirect to first remaining workspace
- **Last workspace protection**: prevent deleting user's only workspace
- **Scope**: no event logging, no sidebar dropdown delete option

## Tasks

- [ ] Add `onDelete: Cascade` to Document and DataSource workspace relations
      in Prisma schema, generate migration
- [ ] Add last-workspace deletion guard in `WorkspaceService.remove()`
- [ ] Add unit tests for last-workspace guard and multi-workspace delete
- [ ] Add Danger Zone section with delete button in `workspace-settings.tsx`
- [ ] Add delete confirmation dialog (workspace name input) using existing
      Dialog component
- [ ] Add delete mutation with post-delete redirect to another workspace
- [ ] Run `pnpm verify:fast` to confirm all tests pass

## Affected Files

| File | Change |
|------|--------|
| `packages/backend/prisma/schema.prisma` | Add onDelete: Cascade |
| `packages/backend/prisma/migrations/…` | New migration |
| `packages/backend/src/workspace/workspace.service.ts` | Last-workspace guard |
| `packages/backend/src/workspace/workspace.service.spec.ts` | New tests |
| `packages/frontend/src/app/workspaces/workspace-settings.tsx` | Danger Zone UI |
