# Self-Hosting

Wafflebase is open source (Apache-2.0) and designed to run on your own infrastructure. Your data stays on your servers.

## Requirements

| Component | Minimum |
|-----------|---------|
| Node.js | 18+ |
| PostgreSQL | 14+ |
| Docker (optional) | 20+ |

## Quick Start with Docker Compose

The fastest way to run Wafflebase locally:

```bash
git clone https://github.com/wafflebase/wafflebase.git
cd wafflebase
pnpm install
docker compose up -d    # Starts PostgreSQL + Yorkie server
pnpm backend migrate    # Run database migrations
pnpm dev                # Start frontend (:5173) + backend (:3000)
```

This starts:
- **Frontend** at `http://localhost:5173`
- **Backend API** at `http://localhost:3000`
- **PostgreSQL** for user accounts and document metadata
- **Yorkie server** for real-time CRDT collaboration

## Environment Variables

Create a `.env` file in `packages/backend/`:

```env
# Required
DATABASE_URL=postgresql://wafflebase:wafflebase@localhost:5432/wafflebase
JWT_SECRET=your_secret_here
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
FRONTEND_URL=http://localhost:5173

# Optional
PORT=3000
JWT_ACCESS_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
```

### GitHub OAuth Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Set the **Authorization callback URL** to `http://your-domain:3000/auth/github/callback`
4. Copy the Client ID and Client Secret into your `.env` file

## Architecture

```
Browser ──── Frontend (React/Vite) ──── Backend (NestJS)
                                              │
                                        ┌─────┴─────┐
                                   PostgreSQL    Yorkie Server
                                   (metadata)    (CRDT sync)
```

- **PostgreSQL** stores user accounts, document metadata, share links, and API keys
- **Yorkie** handles real-time document synchronization between clients using CRDTs
- **Backend** manages authentication, authorization, and REST API
- **Frontend** renders the spreadsheet UI and connects to Yorkie for live collaboration

## Data Ownership

All your data is stored in:

- **PostgreSQL** — User profiles, document records, API keys
- **Yorkie** — Spreadsheet content (cells, formulas, charts, styles)

You control both services. There are no external dependencies or telemetry. Back up your PostgreSQL database and Yorkie data directory to preserve everything.
