# Workspace UI Improvements — Lessons

## Prisma Client regeneration in worktrees
When adding new fields to `schema.prisma`, `prisma generate` must be
run to update the Prisma Client. In a worktree setup with shared
`node_modules`, the generated client may still reflect the old schema
until regenerated explicitly.

## Prefix-based nav active state
When a parent route URL (e.g. `/w/slug`) is a prefix of child routes
(`/w/slug/settings`), a naive `startsWith` check marks both as active.
Fix: check if any sibling nav URL is a more specific match before
marking a shorter URL as active.

## Legacy vs workspace-scoped endpoints
After adding workspace-scoped endpoints, legacy endpoints that expect
`workspaceId` in the body will break if the frontend doesn't send it.
Always verify the full request flow when migrating to new endpoints.
