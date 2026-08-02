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

# Optional — S3-compatible blob storage. PDF uploads and embedded images
# use two separate buckets. In development both default to the MinIO
# container (localhost:9000); in production every value must be set.
FILE_STORAGE_ENDPOINT=http://localhost:9000    # PDF uploads
FILE_STORAGE_BUCKET=wafflebase-files
FILE_STORAGE_REGION=us-east-1
FILE_STORAGE_ACCESS_KEY=minioadmin
FILE_STORAGE_SECRET_KEY=minioadmin
IMAGE_STORAGE_ENDPOINT=http://localhost:9000   # embedded images
IMAGE_STORAGE_BUCKET=wafflebase-images
IMAGE_STORAGE_REGION=us-east-1
IMAGE_STORAGE_ACCESS_KEY=minioadmin
IMAGE_STORAGE_SECRET_KEY=minioadmin

# Optional — Share Link view analytics (Kafka + StarRocks). Leave all
# three unset to disable analytics entirely; the app is unaffected and the
# dashboard shows "not enabled".
WAFFLEBASE_KAFKA_ADDRESSES=localhost:29092
WAFFLEBASE_KAFKA_TOPIC=wafflebase-view-events
WAFFLEBASE_STARROCKS_DSN=root:@tcp(localhost:9030)/wafflebase
```

### PDF & Image Storage

Uploaded PDFs and embedded images are stored as blobs in an S3-compatible
object store (MinIO in development, any S3 provider in production) rather than
in Yorkie. They use **two separate buckets** with their own settings:

- **`FILE_STORAGE_*`** — PDF uploads (default bucket `wafflebase-files`)
- **`IMAGE_STORAGE_*`** — embedded images (default bucket `wafflebase-images`)

In production every value must be set explicitly. If `FILE_STORAGE_*` is
missing, PDF upload is unavailable; if `IMAGE_STORAGE_*` is missing, image
insertion is unavailable — in each case the rest of the app runs normally.

### Analytics (optional)

Wafflebase can record **Share Link view analytics** — views, unique/returning
visitors, dwell time, and a per-link breakdown — surfaced on a per-document and
per-workspace dashboard. This is entirely optional and **off by default**: with
the three `WAFFLEBASE_KAFKA_*` / `WAFFLEBASE_STARROCKS_DSN` variables unset, the
whole pipeline is a no-op and the dashboard shows "not enabled". The rest of the
app is unaffected.

The pipeline reuses the same stack Yorkie ships for its own analytics:

- **Kafka** — the backend batches client view events (via a `sendBeacon`
  endpoint) onto a Kafka topic.
- **StarRocks** — a Routine Load ingests the topic into a
  `wafflebase.view_events` table; the dashboard queries it back over MySQL wire
  protocol.

Both run as an **opt-in Docker Compose profile** kept out of the default stack:

```bash
docker compose --profile analytics up -d   # + the default postgres/yorkie/minio
```

Then point the backend at them with the analytics variables shown above
(`WAFFLEBASE_KAFKA_ADDRESSES=localhost:29092`,
`WAFFLEBASE_KAFKA_TOPIC=wafflebase-view-events`,
`WAFFLEBASE_STARROCKS_DSN=root:@tcp(localhost:9030)/wafflebase`). Open a
document through a share link to emit events, then visit the workspace
**Analytics** tab.

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
- **Yorkie** — Editable document content (cells, text, slides, notes, comments)
- **Blob storage** — Uploaded PDFs and embedded images (S3-compatible)

You control all of these services. There are no external dependencies or telemetry. Back up your PostgreSQL database, Yorkie data directory, and blob store to preserve everything.
