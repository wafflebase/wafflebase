# Wafflebase Frontend

React 19 single-page application for Wafflebase. Hosts the editors for every
document type — sheets, docs, slides, notes, board, and the PDF/image viewers —
plus real-time collaboration via Yorkie, document/workspace management, sharing,
and GitHub OAuth authentication.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19, TypeScript 5.8 |
| Build | Vite 6.2 |
| Styling | Tailwind CSS 4.1, Radix UI |
| Routing | React Router 7.5 |
| Server state | TanStack React Query 5 |
| Tables | TanStack React Table 8 |
| Real-time | Yorkie CRDT (`@yorkie-js/react` 0.6.28) |
| Editor engines | `@wafflebase/sheets`, `@wafflebase/docs`, `@wafflebase/slides`, `@wafflebase/notes`, `@wafflebase/board` (workspace dependencies) |

## Getting Started

### Environment Variables

Create a `.env` file (or set these in your shell):

```env
VITE_FRONTEND_BASENAME=/          # Router base path
VITE_BACKEND_API_URL=http://localhost:3000  # Backend API URL
VITE_YORKIE_PUBLIC_KEY=           # Yorkie project public key
VITE_WB_REVISION_HISTORY=         # Optional. Version history entry point
                                   # (sheets/docs/slides/notes/board). Off by
                                   # default; must be exactly "true" to
                                   # enable — any other value, including "1",
                                   # is off. Ships dark until Yorkie gates
                                   # the revision RPCs behind the auth
                                   # webhook. See `isHistoryEnabled`.
```

### Development

```bash
# From the monorepo root:
pnpm install
docker compose up -d          # Start PostgreSQL + Yorkie
pnpm dev                      # Starts frontend (:5173) + backend (:3000)

# Or run the frontend only:
pnpm frontend dev
```

### Build

```bash
pnpm frontend build
pnpm verify:frontend:chunks  # run after build to enforce JS chunk budget
pnpm verify:frontend:visual  # browser screenshot baseline gate
pnpm verify:frontend:interaction  # browser interaction regression checks
```

`pnpm verify:frontend:chunks` checks default limits of `500 kB` per chunk and
`60` total JS chunks. Override with `FRONTEND_CHUNK_LIMIT_KB` and
`FRONTEND_CHUNK_COUNT_LIMIT`.
Default limits are defined in `/harness.config.json`.

`pnpm verify:frontend:visual` compares deterministic screenshot
baselines rendered in headless Chromium across desktop + mobile profiles.
`pnpm verify:frontend:interaction` validates deterministic browser
interactions on `/harness/interaction`:
- grid cell typing + commit
- formula bar typing + commit + formula recalculation
- mouse wheel vertical scroll movement

Install Chromium once per environment (browser lanes):
- `pnpm --filter @wafflebase/frontend exec playwright install chromium`

### Testing

```bash
pnpm frontend lint                 # ESLint checks
pnpm frontend test                 # Node unit tests
pnpm frontend test:visual:browser  # Browser visual baseline check
pnpm frontend test:visual:browser:update # Update browser baseline
pnpm frontend test:interaction  # Browser interaction regression check
pnpm frontend test:watch           # Node watch mode
```

Frontend test code and visual baselines live under `packages/frontend/tests`
to keep runtime source code in `packages/frontend/src` focused on shipped app
logic.

## App Structure

```
src/
├── main.tsx                  # Entry point (React 19 createRoot)
├── App.tsx                   # Router, providers, route guards
├── app/
│   ├── Layout.tsx            # Sidebar + header shell for main pages
│   ├── login/page.tsx        # GitHub OAuth login page
│   ├── documents/
│   │   ├── page.tsx          # Document list (TanStack Table)
│   │   ├── document-list.tsx # Table with sorting, filtering, CRUD
│   │   └── document-detail.tsx  # Spreadsheet view wrapper
│   ├── spreadsheet/
│   │   ├── sheet-view.tsx    # Mounts @wafflebase/sheets on Canvas
│   │   └── yorkie-store.ts   # Store implementation backed by Yorkie CRDT
│   └── settings/page.tsx     # Settings page
├── api/
│   ├── auth.ts               # fetchMe(), logout(), fetchWithAuth()
│   └── documents.ts          # CRUD operations for documents
├── components/
│   ├── ui/                   # Radix UI + Tailwind components (23 components)
│   ├── app-sidebar.tsx       # Navigation sidebar
│   ├── site-header.tsx       # Top header bar
│   ├── login-form.tsx        # GitHub OAuth button
│   ├── theme-provider.tsx    # Light/dark/system theme context
│   └── user-presence.tsx     # Real-time user cursor avatars
├── hooks/
│   └── use-presence-updater.ts  # Syncs user info to Yorkie presence
├── types/
│   ├── worksheet.ts          # Worksheet CRDT document shape
│   ├── users.ts              # User and UserPresence types
│   ├── documents.ts          # Document type
│   └── nav-items.ts          # Navigation item type
└── lib/
    └── utils.ts              # cn() class name utility
```

### Routing

| Path | Component | Auth | Description |
|------|-----------|------|-------------|
| `/login` | Login | Public | GitHub OAuth login |
| `/` | Documents | Private | Document list |
| `/settings` | Settings | Private | User settings |
| `/s/:id` | DocumentDetail | Private | Sheets editor |
| `/d/:id` | DocsDetail | Private | Docs (word processor) editor |
| `/p/:id` | SlidesDetail | Private | Slides editor |
| `/n/:id` | NotesDetail | Private | Notes editor |
| `/b/:id` | BoardDetail | Private | Board (infinite canvas) editor |
| `/f/:id` | FileDetail | Private/shared | PDF & image viewer (static file types) |
| `/shared/:token`, `/invite/:token` | — | Public | Share-link + workspace-invite entry |
| `/w/:workspaceId` (+ `/analytics`, `/settings`, `/datasources`) | Workspace | Private | Workspace home + sub-pages |

## Key Features

### Real-time Collaboration

The `YorkieStore` class implements the `Store` interface from `@wafflebase/sheets`, persisting all cell data, row heights, and column widths to a Yorkie CRDT document. Changes sync automatically across all connected clients.

### Presence

User cursors are tracked via Yorkie's presence system. `SheetView` subscribes to presence changes and redraws the overlay to show other users' active cells with colored borders and avatars.

### Theme Support

Light, dark, and system themes are supported via a custom `ThemeProvider` that applies a class to the `<html>` element. The resolved theme is passed to the `@wafflebase/sheets` engine for Canvas rendering.

### Authentication

Cookie-based access/refresh token auth via the backend. `PrivateRoute` calls
`fetchMe()` on mount, and authenticated API calls use `fetchWithAuth()` to do
one-time `/auth/refresh` + retry on `401` before redirecting to `/login`. All
API requests use `credentials: "include"`.

## Further Reading

See [/docs/design/frontend.md](../../docs/design/frontend.md) for the full design document covering Yorkie integration, presence, and app architecture.
