# Workspace UI Improvements

## Goal
Close three UI gaps after the slug/settings migration: slug editor,
dark mode toggle, and workspace creation dialog.

## Tasks
- [x] Update `updateWorkspace` API type to accept optional `slug`
- [x] Add slug editing section to workspace settings page
- [x] Add dark mode toggle (Switch) to NavUser account dropdown
- [x] Replace `window.prompt` with Dialog for workspace creation
- [x] Fix document creation to use workspace-scoped endpoint
- [x] Fix sidebar nav active state (Documents prefix match)
- [x] Type-check passes (`npx tsc --noEmit`)

## Review
- 7 frontend files modified, no backend changes needed for UI work
- Document creation bug fixed: was missing `workspaceId` in request body
- Nav active state fixed: more specific URL matches take priority
