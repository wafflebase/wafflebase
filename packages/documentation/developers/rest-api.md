# REST API

The Wafflebase REST API lets you read and write spreadsheet, document, and presentation data programmatically. All endpoints are under `/api/v1/`.

## Authentication

All API requests require authentication via an API key.

### Creating an API Key

1. Go to your workspace settings
2. Navigate to **API Keys**
3. Click **Create API Key** and give it a name
4. Copy the key (it starts with `wfb_`) — it is shown only once

### Using the API Key

Include the key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer wfb_your_key_here" \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents
```

## Base URL

```
https://api.wafflebase.io/api/v1/workspaces/:workspaceId
```

Replace `:workspaceId` with your workspace ID.

## API Surface by Document Type

A workspace holds three kinds of documents — **sheets** (spreadsheets), **docs** (word-processor documents), and **slides** (presentations). The endpoints below are grouped accordingly:

| Section | Sheet | Doc | Slides |
|---------|:-----:|:---:|:------:|
| [Documents](#documents) | ✅ | ✅ | ✅ |
| [Images](#images) | ✅ | ✅ | ✅ |
| [Tabs](#tabs-sheets-only) | ✅ | — | — |
| [Cells](#cells-sheets-only) | ✅ | — | — |
| [Document Content](#document-content-docs-and-slides) | — | ✅ | ✅ |

Calling an endpoint against the wrong document type — e.g. a tabs/cells call on a doc, or a content call on a sheet — returns `HTTP 409` with code `TYPE_MISMATCH`.

## Documents

Document CRUD works for both sheets and docs. Each document carries a `type` field (`"sheet"` or `"doc"`).

### List Documents

```bash
GET /api/v1/workspaces/:wid/documents
```

```bash
curl -H "Authorization: Bearer wfb_..." \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents
```

### Create Document

```bash
POST /api/v1/workspaces/:wid/documents
```

```bash
# Create a sheet (default)
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Q1 Report"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents

# Create a doc
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Meeting Notes", "type": "doc"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents

# Create a slides deck
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Launch Deck", "type": "slides"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Document title |
| `type` | string | No | `"sheet"` (default), `"doc"`, or `"slides"` |

### Get Document

```bash
GET /api/v1/workspaces/:wid/documents/:did
```

### Update Document

```bash
PATCH /api/v1/workspaces/:wid/documents/:did
```

```bash
curl -X PATCH \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Q1 Report (Updated)"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents/:did
```

### Delete Document

```bash
DELETE /api/v1/workspaces/:wid/documents/:did
```

## Images

Workspace-scoped image storage. Images are stored under the workspace and may be referenced by sheets, docs, and slides.

### Upload Image

```bash
POST /api/v1/workspaces/:wid/images
```

Multipart form upload. The file is sent in the `file` field.

| Constraint | Value |
|------------|-------|
| Max size | 10 MB |
| Allowed types | `image/png`, `image/jpeg`, `image/gif`, `image/webp` |

```bash
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -F "file=@chart.png" \
  https://api.wafflebase.io/api/v1/workspaces/:wid/images
```

Response:

```json
{ "id": "<imageId>", "url": "/api/v1/workspaces/:wid/images/<imageId>" }
```

### Get Image

```bash
GET /api/v1/workspaces/:wid/images/:imageId
```

Returns the raw image bytes with the original `Content-Type`. The response is served with a long-lived immutable cache header.

### Delete Image

```bash
DELETE /api/v1/workspaces/:wid/images/:imageId
```

Response:

```json
{ "deleted": true }
```

## Tabs (sheets only)

Sheets are organized into one or more **tabs**. Tabs do not exist on doc documents — calling these endpoints against a doc returns `HTTP 409`.

### List Tabs

```bash
GET /api/v1/workspaces/:wid/documents/:did/tabs
```

Response is an array of tab descriptors:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Stable tab id (e.g. `"tab-1"`) |
| `name` | string | Display name |
| `type` | string | Tab type (`"sheet"`, `"datasource"`, …) |
| `kind` | string? | Sheet subtype (e.g. `"normal"`, `"pivot"`) |

## Cells (sheets only)

Cell endpoints operate on a single sheet tab inside a sheet document.

Each cell in a response has the following shape:

| Field | Type | Description |
|-------|------|-------------|
| `ref` | string | A1-notation reference (e.g. `"A1"`) |
| `value` | string \| null | Stored value |
| `formula` | string \| null | Stored formula (when present) |
| `style` | object \| null | Style payload (when present) |

### Get All Cells

```bash
GET /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells
```

Optional query parameter `?range=A1:C10` to fetch a specific range.

```bash
# Get all cells
curl -H "Authorization: Bearer wfb_..." \
  .../tabs/:tid/cells

# Get a range
curl -H "Authorization: Bearer wfb_..." \
  .../tabs/:tid/cells?range=A1:C10
```

### Get Single Cell

```bash
GET /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells/:ref
```

```bash
curl -H "Authorization: Bearer wfb_..." \
  .../tabs/:tid/cells/A1
```

### Set Cell Value

```bash
PUT /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells/:ref
```

| Field | Type | Description |
|-------|------|-------------|
| `value` | string? | Plain value |
| `formula` | string? | Formula (e.g. `"=SUM(A1:A10)"`) |

```bash
# Set a text value
curl -X PUT \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"value": "Revenue"}' \
  .../tabs/:tid/cells/A1

# Set a formula
curl -X PUT \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"formula": "=SUM(A1:A10)"}' \
  .../tabs/:tid/cells/B1
```

### Delete Cell

```bash
DELETE /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells/:ref
```

### Batch Update

```bash
PATCH /api/v1/workspaces/:wid/documents/:did/tabs/:tid/cells
```

Update multiple cells in a single request. Set a cell to `null` to delete it.

```bash
curl -X PATCH \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{
    "cells": {
      "A1": {"value": "Name"},
      "B1": {"value": "Score"},
      "C1": {"formula": "=SUM(B2:B100)"},
      "D1": null
    }
  }' \
  .../tabs/:tid/cells
```

## Document Content (docs and slides)

Read or replace the full content tree of a **doc** (word-processor) or **slides** (presentation) document. The content is the live Yorkie CRDT document — collaborators in the editor see updates from `PUT` immediately.

Calling these endpoints against a sheet returns `HTTP 409` with code `TYPE_MISMATCH`. The body shape depends on the document type: docs use the block-tree `Document` JSON described below, while slides use the deck's `SlidesDocument` JSON (slides, elements, theme). Read the content first to see the exact shape before writing it back.

### Get Document Content

```bash
GET /api/v1/workspaces/:wid/documents/:did/content
```

```bash
curl -H "Authorization: Bearer wfb_..." \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents/:did/content
```

Returns the full `Document` JSON: block tree, page setup, header/footer.

### Replace Document Content

```bash
PUT /api/v1/workspaces/:wid/documents/:did/content
```

Destructively replaces the document's Yorkie root with the provided `Document` JSON. Concurrent collaborator edits made between the read and the write may be lost — treat this as a destructive operation.

```bash
curl -X PUT \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d @document.json \
  .../documents/:did/content
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `blocks` | array | Yes | Top-level blocks (paragraph, heading, list-item, table, …) |
| `pageSetup` | object | No | Paper size, orientation, margins. Omit to clear. |
| `header` | object | No | Header region. Omit to clear. |
| `footer` | object | No | Footer region. Omit to clear. |

A missing or malformed `blocks` field returns `HTTP 400`.
