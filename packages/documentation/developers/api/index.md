---
title: REST API
description: The Wafflebase REST API reads and writes the documents in a workspace over HTTP, with an API key or a signed-in session.
type: overview
---

# REST API

The Wafflebase REST API reads and writes the documents in a workspace over HTTP, with an API key or a signed-in session.

Use it to:

- Load data into a sheet from a script or a CI job, and read results back
- Generate docs, notes, and decks from templates or other systems
- Let an agent read a board's sticky notes and cluster them into sections

The [`wafflebase` CLI](/developers/cli/) is built on these same endpoints. Reach for the CLI in a terminal and for the API when you write your own client.

## Get started

1. [Create an API key](/developers/api/quickstart#_1-create-an-api-key) in your workspace settings.
2. [List your documents](/developers/api/quickstart#_3-list-your-documents) with `curl`.
3. [Write cells into a new sheet](/developers/api/quickstart#_4-create-a-sheet-and-write-cells) and read them back.

The [Quickstart](/developers/api/quickstart) walks through all three in about 10 minutes.

## Find an endpoint

| To do this | See |
|---|---|
| List, create, rename, copy, file, trash, and restore documents | [Documents and folders](/developers/api/documents-and-folders#documents) |
| Create, rename, move, and delete folders | [Documents and folders](/developers/api/documents-and-folders#folders) |
| Upload a file as a document, or upload an image to embed | [Documents and folders](/developers/api/documents-and-folders#files-and-images) |
| Manage tabs, read and write cells, insert or move rows and columns | [Sheets](/developers/api/sheets) |
| Set freeze panes, merges, styles, sizes, rules, charts, images, filters, and pivots | [Sheets](/developers/api/sheets#worksheet-settings) |
| Read or replace a doc, deck, note, or board as JSON | [Document content](/developers/api/content#read-and-replace-content) |
| Add, duplicate, move, and delete slides | [Document content](/developers/api/content#slides) |
| List, add, reply to, resolve, and delete comments | [Document content](/developers/api/content#comments) |
| Add sticky notes, sections, and text to a board, and move elements | [Boards](/developers/api/board) |

## Base URL

Every endpoint lives under `/api/v1/`. Most are scoped to one workspace:

```text
https://api.wafflebase.io/api/v1/workspaces/<workspace>
```

`https://api.wafflebase.io` is the hosted service. On a self-hosted server, use the origin your backend is served from; see [Self-hosting](/developers/self-hosting/).

`<workspace>` is the workspace ID or its slug. The slug is the part after `/w/` in the address bar when the workspace is open in your browser.

The examples on these pages use three shell variables. Set them once:

```bash
export WFB_API=https://api.wafflebase.io/api/v1
export WFB_KEY=wfb_your_key_here
export WS=acme
```

## Authenticate

Every request carries one of two credentials:

| Credential | How to send it | What it can do |
|---|---|---|
| API key | `Authorization: Bearer wfb_...` | Acts as the member who created it, in the one workspace it was created for, limited by its scopes |
| Session cookie | The cookie your browser holds after you sign in | Acts as you, in every workspace you belong to |

A bearer token that starts with `wfb_` is treated as an API key. Any other request is checked for a session cookie.

```bash
curl -H "Authorization: Bearer $WFB_KEY" "$WFB_API/workspaces/$WS/documents"
```

This lists the documents in the workspace.

::: danger Keep API keys secret
An API key can read, change, and delete everything its creator can in that workspace. Store it in a secret manager or environment variable, never in source control, and revoke it in workspace settings if it leaks.
:::

### What an API key can reach

- **One workspace.** A key used against another workspace gets `403 API key is not scoped to this workspace`.
- **Its creator's role, checked on every request.** A plain member's key can trash only the documents that member created; an owner's key can trash any. If the creator leaves the workspace, the key stops working.
- **Its scopes.** A key has the `read` and `write` scopes by default. Every `POST`, `PUT`, `PATCH`, and `DELETE` needs `write`; without it the request gets `403 This API key does not have write access`. `GET` requests never need `write`.

To manage keys, open the workspace and click **Settings** in the sidebar. The **API keys** section lists your keys. A workspace owner sees and can revoke every member's keys.

### Create a read-only key

The **Create API key** dialog and `wafflebase api-keys create` always create a key with both scopes. A key with only `read` suits a script that only reads, such as a nightly report, because it cannot change or replace content. To create one, call the key endpoint with your signed-in session instead of an API key.

1. Sign in to Wafflebase in your browser and open any page of the app.
2. Open the browser's developer console.
3. Run this, with your API origin and workspace slug:

   ```js
   await fetch("https://api.wafflebase.io/workspaces/acme/api-keys", {
     method: "POST",
     credentials: "include",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ name: "Nightly report", scopes: ["read"] }),
   }).then((r) => r.json());
   ```

4. Copy the `key` field from the result. It is shown only once.

This endpoint is outside `/api/v1/` and accepts only a session. It also takes an optional `expiresAt` (an ISO 8601 date) after which the key stops working.

## Requests and responses

- Send bodies as JSON with `Content-Type: application/json`, except uploads, which are `multipart/form-data`.
- Responses are JSON unless an endpoint returns file bytes.
- Row and column indices in the sheet endpoints are 1-based, and so are tab and slide positions. Board endpoints use canvas coordinates instead.
- A document in another workspace, or one in the trash, answers `404 Document not found`, the same as one that does not exist.

## Errors

Errors use HTTP status codes with a JSON body:

```json
{ "statusCode": 404, "message": "Document not found", "error": "Not Found" }
```

`message` is a string, or an array of strings when several body fields fail validation at once.

| Status | Usually means |
|---|---|
| `400` | The body or a parameter is invalid; `message` names the field. Also returned when an endpoint is called on the wrong document type, for example `Tabs are only available on sheet documents; "<id>" is a "doc" document.` |
| `401` | The credential is missing, unknown, revoked (`API key has been revoked`), or expired (`API key has expired`) |
| `403` | The key is for another workspace, lacks `write`, or the caller is not allowed to do this (for example, trashing someone else's document as a plain member) |
| `404` | The document, tab, folder, slide, comment, or element does not exist in this workspace, or the document is in the trash |
| `409` | The request conflicts with the document's state, such as deleting a sheet's last tab or a duplicate tab name |
| `410` | A share link used to read an image has expired |
| `413` | An uploaded file is over the size limit |
| `429` | You hit the rate limit; wait and retry |

The `/content` endpoints answer a sheet, PDF, image, or file document with a structured `409` instead:

```json
{ "error": { "code": "TYPE_MISMATCH", "message": "Use 'sheets cells get' for spreadsheet documents" } }
```

## Rate limits

Limits are counted per client IP address per minute:

| Routes | Requests per minute |
|---|---|
| Most routes | 120 |
| `POST /workspaces/<workspace>/files`, `GET /workspaces/<workspace>/files/<id>` | 600 |
| `POST /workspaces/<workspace>/images`, `GET` and `DELETE /workspaces/<workspace>/images/<id>` | 600 |
| `POST /shared/images` | 30 |

A request over the limit gets `429`.

## Routes outside workspace authentication

Two routes accept a share-link token in place of an API key or session:

- `GET /workspaces/<workspace>/images/<imageId>?token=<shareToken>` reads an embedded image.
- `POST /shared/images?token=<shareToken>` uploads an image with an editor share link.

Both are described in [Upload files and images](/developers/api/documents-and-folders#files-and-images).

## Next steps

- [Make your first API call](/developers/api/quickstart) with a new key.
- [Documents and folders](/developers/api/documents-and-folders) to organize a workspace from a script.
- [Use the CLI](/developers/cli/) when you would rather not write HTTP calls.
- [Share a document](/collaborate/share) to understand share-link tokens.
