# wafflebase

Wafflebase is a web-based spreadsheet application designed to be a lightweight yet powerful tool for data analysis. It bridges the gap between traditional spreadsheets and database tools, offering real-time collaboration and scalable performance for handling large datasets.

## Status of Wafflebase

Wafflebase is currently in the early stages of development. While core spreadsheet functionalities are implemented, it is not yet ready for production use. We are actively working on DataSource integration and advanced analysis features.

Demo Sheet: https://wafflebase.io/shared/bed3dbe8-bdce-46ef-a76e-65fd67178cde

## Key Features
Currently, Wafflebase supports the following core capabilities:

- ⚡️ High Performance: Virtualized rendering engine designed to handle large row/column counts smoothly.
- 📊 Core Spreadsheet Functions:
  - Essential Formulas (SUM, AVERAGE, MIN, MAX)
  - Cell Formatting (Font, Color, Alignment) & Freeze Panes
  - Reliable Undo/Redo & Copy/Paste (Google Docs compatible)
- 🤝 Real-Time Collaboration: Multi-user editing powered by Yorkie (CRDT).
- 🔌 Data Source Integration (Coming Soon): Connect directly to databases (PostgreSQL, MySQL) to query and analyze live data without CSV exports.

## Contributing

We welcome contributions! If you're interested in helping build the next generation of data analysis tools, please check out the below or look for open issues.

### Commit Message Format

We follow a rough convention for commit messages that is designed to answer
two questions: what changed and why. The subject line should feature the what
and the body of the commit should describe the why.

```
Remove the synced seq when detaching the document

To collect garbage like CRDT tombstones left on the document, all
the changes should be applied to other replicas before GC. For this,
if the document is no longer used by this client, it should be
detached.
```

The first line is the subject and should be no longer than 70 characters. The
second line is always blank, and other lines should be wrapped at 80
characters.

### Setting Development Environment

Follow these instructions to set up your development environment.

#### Prerequisites

You need to have the following software installed on your system:

- [Node.js](https://nodejs.org/en/) (version 18 or later)
- [pnpm](https://pnpm.io/) (version 10 or later)
- [Docker](https://www.docker.com/) (for running the application in a container)

#### Building & Testing

```bash
pnpm i
pnpm run build
pnpm run test
```

#### Running

Wafflebase depends on [Yorkie](https://yorkie.dev) and [Postgres](https://www.postgresql.org/). You can run them locally using Docker.

```bash
docker compose up -d
pnpm run dev
```

Then open `http://localhost:5173` in your browser.
