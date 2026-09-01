# Sidebar nav drift: Templates and Analytics missing in editors

## Problem

Opening a document (`/s/:id`, `/d/:id`, `/p/:id`, `/n/:id`, `/b/:id`, `/f/:id`)
shows a left sidebar with only **Documents · Data Sources · Settings**, while
the workspace routes under `app/Layout.tsx` show **Documents · Templates ·
Data Sources · (Analytics) · Settings**.

The cause is duplication, not a permission or feature gate. `Layout.tsx` builds
its nav item list inline, and each editor route — which sits *outside* `Layout`
— builds its own copy of that list. Templates (#1000/#1001) and Analytics were
added to `Layout.tsx` only, so the seven other copies drifted:

- `app/Layout.tsx:62`
- `app/documents/document-detail.tsx:200`
- `app/docs/docs-detail.tsx:120`
- `app/slides/slides-detail.tsx:274` and `:616` (mobile + desktop shells)
- `app/notes/notes-detail.tsx:118`
- `app/board/board-detail.tsx:63`
- `app/files/file-shell.tsx:70`

Analytics carries a second condition: `Layout.tsx` hides it unless
`GET /analytics/enabled` reports a configured warehouse. Any shared list has to
keep that gate rather than link to a dead page.

## Goal

One source for the workspace nav list, used by every shell, so the next nav
entry cannot land in one place only.

## Plan

- [x] Add `hooks/use-workspace-nav-items.ts` — takes the workspace slug
      (undefined = the workspace-less fallback paths) and returns
      `{ main, secondary }`, keeping the analytics-enabled gate inside.
- [x] Unit-test the hook: Templates present when a slug is known, Analytics
      only when enabled, workspace-scoped URLs, fallback shape unchanged.
- [x] Add a regression guard that no other source file builds the list.
- [x] Replace the eight inline lists with the hook.
- [x] `pnpm verify:fast`.
- [x] Manual smoke in `pnpm dev`: open a document and confirm Templates
      appears and navigates.

## Review

`useWorkspaceNavItems(workspaceSlug?)` in
`packages/frontend/src/hooks/use-workspace-nav-items.ts` is the only place the
workspace nav list exists now. All eight call sites consume it, including both
of `slides-detail.tsx`'s shells (mobile + desktop). Net −225 lines.

Two behavior notes:

- The editors gained the Analytics entry as well as Templates — the intended
  parity. It stays gated on `fetchAnalyticsEnabled()`, whose query is shared by
  react-query key with `Layout`, so an editor route costs at most one extra
  cheap request per 5-minute stale window. Every route that mounts the sidebar
  is behind `PrivateRoute`, so that request never runs for an anonymous
  share-link viewer (`fetchWithAuth` treats a 401 as a session expiry and
  redirects to `/login`, which would have been a real hazard on a public
  route).
- The fallback branch (no workspace slug resolved yet) still emits only
  `/documents`, `/datasources`, `/settings`. Templates and Analytics exist only
  under `/w/:workspaceId`, so listing them there would link to routes the
  router does not serve.

`use-workspace-nav-items.test.tsx` covers the two item shapes and the analytics
gate. `nav-items-single-source.test.ts` asserts the mount → hook edge: every
file that renders `<AppSidebar` must reference `useWorkspaceNavItems`. Both
were mutation-checked — dropping Templates, inverting the gate, leaking
Analytics into the fallback, and adding an eighth mount with its own list each
fail a test.

Three existing tests mocked `@/api/workspaces` with a partial factory and broke
on the new `fetchAnalyticsEnabled` import; each gained the missing member.

The design editor's four canvas scenes render these pages' own `AppSidebar`,
so they inherited the new `/analytics/enabled` request. An unmocked URL is a
hard scene failure, so `packages/design-sandbox/src/scenes/fixtures/canvas.ts`
gains the fixture (`enabled: true`, matching `shell.ts`'s reasoning). No verify
lane covers that table — it is consulted only at editor runtime.
