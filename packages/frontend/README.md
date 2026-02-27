# Wafflebase Frontend

React 19 single-page application for Wafflebase. Provides the spreadsheet UI, real-time collaboration via Yorkie, document management, and GitHub OAuth authentication.

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
| Spreadsheet | `@wafflebase/sheet` (workspace dependency) |

## Getting Started

### Environment Variables

Create a `.env` file (or set these in your shell):

```env
VITE_FRONTEND_BASENAME=/          # Router base path
VITE_BACKEND_API_URL=http://localhost:3000  # Backend API URL
VITE_YORKIE_API_KEY=              # Yorkie server API key
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
pnpm verify:frontend:visual  # run after build to enforce SSR visual snapshots
pnpm verify:frontend:visual:browser  # browser-rendered visual snapshots
pnpm verify:frontend:visual:all  # run both visual lanes together
pnpm verify:frontend:interaction:browser  # browser interaction regression checks
```

`pnpm verify:frontend:chunks` checks default limits of `500 kB` per chunk and
`60` total JS chunks. Override with `FRONTEND_CHUNK_LIMIT_KB` and
`FRONTEND_CHUNK_COUNT_LIMIT`.
Default limits are defined in `/harness.config.json`.

`pnpm verify:frontend:visual` compares deterministic baseline markup rendered
from `/harness/visual` via Vite SSR.

`pnpm verify:frontend:visual:browser` compares deterministic screenshot
baselines rendered in headless Chromium across desktop + mobile profiles.
`pnpm verify:frontend:interaction:browser` validates deterministic browser
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
pnpm frontend test:visual          # Visual baseline regression check
pnpm frontend test:visual:update   # Update visual baseline file
pnpm frontend test:visual:browser  # Browser visual baseline check
pnpm frontend test:visual:browser:update # Update browser baseline
pnpm frontend test:visual:all      # Run SSR + browser visual checks
pnpm frontend test:visual:all:update # Update SSR + browser visual baselines
pnpm frontend test:interaction:browser  # Browser interaction regression check
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
│   │   ├── sheet-view.tsx    # Mounts @wafflebase/sheet on Canvas
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
| `/:id` | DocumentDetail | Private | Spreadsheet editor |

## Key Features

### Real-time Collaboration

The `YorkieStore` class implements the `Store` interface from `@wafflebase/sheet`, persisting all cell data, row heights, and column widths to a Yorkie CRDT document. Changes sync automatically across all connected clients.

### Presence

User cursors are tracked via Yorkie's presence system. `SheetView` subscribes to presence changes and redraws the overlay to show other users' active cells with colored borders and avatars.

### Theme Support

Light, dark, and system themes are supported via a custom `ThemeProvider` that applies a class to the `<html>` element. The resolved theme is passed to the `@wafflebase/sheet` engine for Canvas rendering.

### Authentication

Cookie-based access/refresh token auth via the backend. `PrivateRoute` calls
`fetchMe()` on mount, and authenticated API calls use `fetchWithAuth()` to do
one-time `/auth/refresh` + retry on `401` before redirecting to `/login`. All
API requests use `credentials: "include"`.

## Further Reading

See [/design/frontend.md](../../design/frontend.md) for the full design document covering Yorkie integration, presence, and app architecture.
