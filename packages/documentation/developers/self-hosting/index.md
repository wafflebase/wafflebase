---
title: Self-hosting
description: Run Wafflebase on your own infrastructure so your documents, accounts, and files stay on servers you control.
type: overview
---

# Self-hosting

Self-hosting runs Wafflebase on your own infrastructure so your documents, accounts, and files stay on servers you control.

Wafflebase is open source under the Apache-2.0 license. Use self-hosting to:

- Develop and test changes on `localhost` with the full stack
- Run a private instance for your team on your own domain
- Keep every document, account, and uploaded file inside your network

## What you run

A deployment has five parts. Browsers talk to the backend and to Yorkie directly.

```text
Browser ──── Frontend (static build) ──── Backend (NestJS, :3000)
   │                                            │
   │                                      ┌─────┴─────┐
   └──────── Yorkie server (:8080) ── PostgreSQL   Blob store (S3)
                    │
                    └── auth webhook ──► Backend /internal/yorkie/auth
```

| Component | What it does |
|-----------|--------------|
| Frontend | Static bundle. Its backend and Yorkie addresses are fixed at build time |
| Backend | Sign-in, permissions, file storage, datasources, and the REST API |
| Yorkie | Real-time sync of document content between browsers |
| PostgreSQL | Accounts, workspaces, document records, folders, share links, API keys, notifications, and templates |
| Blob store | Uploaded files, PDFs, images, and images embedded in documents |

## Requirements

| Component | Version |
|-----------|---------|
| Node.js | 22 (the repository's `.nvmrc`) |
| pnpm | 10.5.2 (`corepack enable` picks up the pinned version) |
| PostgreSQL | 16 is what is built and tested |
| Docker Compose | v2 (`docker compose`, not `docker-compose`) |

You also need a GitHub OAuth app for sign-in. Google sign-in is optional.

## Where your data lives

- **PostgreSQL**: user profiles, workspaces, document records, folders, share links, API keys, notifications, and template listings.
- **Yorkie**: document content (cells, text, slides, notes, board elements, comments) and its version history.
- **Blob store**: uploaded files and embedded images.

Back up all three. Nothing is sent to a third party unless you turn it on: Google Analytics (`VITE_GA_ID`), error tracking (`SENTRY_DSN`, `VITE_SENTRY_DSN`), and share-link analytics each stay off until you set them, and the analytics pipeline runs on Kafka and StarRocks services you host yourself.

## Get started

1. [Run Wafflebase locally](/developers/self-hosting/local-development) with Docker Compose and the dev servers.
2. [Set up sign-in](/developers/self-hosting/sign-in) with a GitHub OAuth app, and Google if you want it.
3. [Deploy to production](/developers/self-hosting/deploy): build the backend image and the frontend with your own URLs.

## Tasks

| To do this | See |
|------------|-----|
| Start the full stack on your machine | [Local development](/developers/self-hosting/local-development) |
| Look up an environment variable | [Configuration](/developers/self-hosting/configuration) |
| Configure GitHub, GitHub Enterprise, or Google sign-in | [Sign-in providers](/developers/self-hosting/sign-in) |
| Build, migrate, and run behind TLS | [Deploy to production](/developers/self-hosting/deploy) |
| Enforce per-document access at the sync layer | [Turn on per-document access control](/developers/self-hosting/deploy#turn-on-per-document-access-control) |
| Configure file and image storage | [Set up blob storage](/developers/self-hosting/deploy#set-up-blob-storage) |
| Turn on analytics, lakehouse, error tracking, or the template gallery | [Optional features](/developers/self-hosting/optional-features) |
| Fix a startup, sign-in, or upload error | [Troubleshooting](/developers/self-hosting/troubleshooting) |

## Next steps

- [Local development](/developers/self-hosting/local-development) to try it on your machine first.
- [Deploy to production](/developers/self-hosting/deploy) when you are ready for a real domain.
- [CLI](/developers/cli/) to script your instance once it runs.
