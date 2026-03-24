# REST API

The Wafflebase REST API lets you read and write spreadsheet and document data programmatically. All endpoints are under `/api/v1/`.

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

## Documents

### List Documents

```bash
GET /api/v1/workspaces/:wid/documents
```

```bash
curl -H "Authorization: Bearer wfb_..." \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents
```

Each document in the response includes a `type` field (`"sheet"` or `"doc"`).

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

# Create a document
curl -X POST \
  -H "Authorization: Bearer wfb_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "Meeting Notes", "type": "doc"}' \
  https://api.wafflebase.io/api/v1/workspaces/:wid/documents
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | Yes | Document title |
| `type` | string | No | `"sheet"` (default) or `"doc"` |

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

::: info
The Tabs and Cells endpoints below apply to **sheet** documents only. Document (`"doc"`) content is not currently available through the REST API.
:::

## Tabs

### List Tabs

```bash
GET /api/v1/workspaces/:wid/documents/:did/tabs
```

Returns tab id, name, and type for each tab in the document.

## Cells

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
