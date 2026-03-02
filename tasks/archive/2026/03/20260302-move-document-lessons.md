# Move Document — Lessons

- The existing `PATCH /documents/:id` only accepted `{ title: string }`. Extending
  it to `{ title?: string; workspaceId?: string }` keeps the API surface minimal
  while supporting both rename and move in a single endpoint.
- Prisma's `updateDocument` accepts `workspace: { connect: { id } }` to change
  the relation — no raw SQL needed.
- The `useQuery` for workspaces is only enabled when the move dialog is open
  (`enabled: movingDoc !== null`), avoiding unnecessary fetches.
- Backend test failures (Prisma type mismatches) are pre-existing and unrelated
  to workspace/document changes.
