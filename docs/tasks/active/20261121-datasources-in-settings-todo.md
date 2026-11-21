# Data sources in workspace settings

Data sources are configured once and rarely touched afterwards; the everyday
path (picking a connection for a SQL tab) already lives in the sheet's
`DataSourceSelector`, which can also create one. A top-level sidebar entry
over-weights a management screen. Move management into Workspace Settings,
next to API keys (the other configure-once credential).

## Plan

- [x] Add a "Data sources" section to `workspace-settings.tsx` (member-visible:
      every datasource route is `assertMember`-gated), styled like API keys:
      a phone-width list (name, SSL, `user@host:port/db`, status), per-row ⋯ menu (Test connection, Edit,
      Delete), outline "New data source" button (One Accent Rule), empty-state
      line instead of the big empty table.
- [x] Drop the filter input and Previous/Next pagination from the list (a
      workspace holds a handful of connections).
- [x] Remove "Data sources" from the sidebar (workspace + fallback lists).
- [x] Redirect `/w/:id/datasources` → `/w/:id/settings#datasources`; scroll
      to the section on hash. Redirect workspace-less `/datasources` → `/`.
- [x] Delete the now-unused standalone pages (`app/datasources/page.tsx`,
      `app/workspaces/workspace-datasources.tsx`) and their route titles.
- [x] Update tests (nav items, workspace settings) and docs mentions.
- [x] `pnpm verify:fast`; Before → After at 393×659; PR.

## Review

Self-review round 1 was clean (no blocking findings); minor fixes folded in,
see the lessons file. Verified in a browser at 393×659 and 1440×900:
`/w/acme/datasources` lands on `/w/acme/settings#datasources` with the section
in view, the list fits phone width with the row menu on-screen, and the
sidebar no longer lists Data sources.
