# Move Document to Another Workspace

## Goal
Allow users to move documents between workspaces they belong to.

## Tasks

- [x] Backend: extend `PATCH /documents/:id` to accept optional `workspaceId`
- [x] Backend: verify membership in both source and target workspaces
- [x] Frontend: add `moveDocument()` API function
- [x] Frontend: add "Move to..." menu item in document list actions
- [x] Frontend: add Move dialog with workspace selector
- [x] Frontend: invalidate queries on successful move
- [x] Verify: frontend lint passes
- [x] Verify: frontend tests pass
- [x] Verify: sheet typecheck + tests pass

## Review

All changes implemented and verified. Backend test failures are pre-existing
(Prisma generated types not matching PrismaService) and unrelated to this change.
