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
```

### Testing

```bash
pnpm frontend lint                 # ESLint checks
pnpm frontend test                 # Node unit tests
pnpm frontend test:watch           # Node watch mode
```

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

Cookie-based JWT auth via the backend. `PrivateRoute` calls `fetchMe()` on mount; unauthenticated users are redirected to `/login`. All API requests use `credentials: "include"`.

## Further Reading

See [/design/frontend.md](../../design/frontend.md) for the full design document covering Yorkie integration, presence, and app architecture.
