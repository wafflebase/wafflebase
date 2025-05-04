# wafflebase

Wafflebase is a simple spreadsheet.

## Status of Wafflebase

Wafflebase is currently in the early stages of development. It is not yet ready for production use. If you are interested in contributing, please see the [Contributing](https://github.com/wafflebase/wafflebase#contributing) section below.

## Overview

Wafflebase is a web-based spreadsheet application designed as a lightweight alternative to Google Sheets and Microsoft Excel.

## Contributing

### Setting Development Environment

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
