---
title: Document content
description: Endpoints to read and replace the content of docs, decks, notes, and boards, edit a deck's slides, and work with comment threads.
type: reference
---

# Document content

Endpoints to read and replace the content of docs, decks, notes, and boards, edit a deck's slides, and work with comment threads.

Paths are relative to `$WFB_API/workspaces/$WS/documents/$DOC`. Authentication and error shapes are on the [REST API overview](/developers/api/). For sheets, use the [Sheets](/developers/api/sheets) endpoints instead. The CLI equivalents are `wafflebase docs content` and `docs set-content`; see [Replace a doc's content from JSON](/developers/cli/documents#replace-a-doc-s-content-from-json).

## Read and replace content

### Read content

`GET /content`

Returns the whole document as JSON. The shape depends on the document type:

| Type | Response |
|---|---|
| `doc` | `{ blocks, header?, footer?, pageSetup?, styles? }`: the body blocks, header and footer, page size and margins, and the named paragraph styles |
| `slides` | `{ meta, themes, masters, layouts, slides, guides }` |
| `note` | `{ content }`: the whole note as one Markdown string |
| `board` | `{ meta, elements }`: the board title and every element on it |

A sheet, PDF, image, or file document returns `409` with the `TYPE_MISMATCH` body shown on the [overview](/developers/api/#errors).

```bash
curl -s -H "Authorization: Bearer $WFB_KEY" \
  "$WFB_API/workspaces/$WS/documents/$DOC/content" > launch-plan.json
```

This saves a doc's content to a file you can edit and send back.

### Replace content

`PUT /content`

Replaces the whole document with the JSON you send, and returns it. Request bodies are limited to 25 MB by default.

::: warning PUT replaces everything
Anything a collaborator changes between your `GET` and your `PUT` is lost, and every optional field you leave out is cleared. Always `GET` the content, edit what comes back, and `PUT` all of it. To add or move slides or board elements without replacing the rest, use the [slide](#slides) or [board](/developers/api/board) endpoints instead.
:::

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d @launch-plan.json \
  "$WFB_API/workspaces/$WS/documents/$DOC/content"
```

The body's shape must match the document's type:

| Body has | Treated as | Required fields |
|---|---|---|
| A `slides` array | Deck | `meta` with `title`, `themeId`, and `masterId`; `themes`, `masters`, `layouts`, and `slides` arrays |
| A `blocks` array | Doc | `blocks` |
| An `elements` array | Board | `meta` with a non-empty `title`; `elements` |
| A `content` string | Note | `content` |

A body with none of these is `400 Invalid content payload: ...`. A body of one kind sent to another type of document is `400 Body shape '<shape>' does not match document type '<type>'`.

What leaving a field out does:

| Type | Field left out | Result |
|---|---|---|
| Doc | `header`, `footer` | Removed |
| Doc | `pageSetup` | Reset to the default page size and margins |
| Doc | `styles`, or `{}` | Named styles reset to the defaults |
| Deck | `guides` | Every ruler guide removed |
| Deck | `meta.unit`, `meta.pxPerPt`, `meta.slideHeight`, `meta.recentColors` | Removed. A deck imported from PowerPoint loses its font scale and slide size |
| Board | `meta.unit`, `meta.recentColors` | Removed |

### What is checked

The API checks the structure it needs to store the content and refuses anything else with a `400` naming the path, such as `Invalid block at blocks[3]: 'style.alignment' must be one of ...`.

- **Doc.** `header` and `footer`, when present, are `{ blocks, marginFromEdge? }`. Every block, including blocks in the header, footer, and table cells, needs a non-empty `id`, a `type`, and a `style` object. A block other than a table needs an `inlines` array whose entries have `text` and `style`. A `table` block needs `tableData` with `columnWidths` and `rows`, and every cell needs `blocks` and `style`.
- **Deck.** Every slide needs `id`, `layoutId`, a `background` object, and `elements` and `notes` arrays. Every element on a slide needs `id`, `type`, and a `frame` object. Text inside slide elements, group children, and layout placeholders gets the same block checks as a doc. Groups may nest up to 32 levels. Entries in `themes` and `masters` are stored without inspection. Missing empty parts, such as a text box with no `blocks`, are filled in, so the response can include fields you did not send. A field of the wrong type is still `400`.
- **Board.** Every element is checked like a deck element. `meta.unit` must be `in` or `cm`.

The nested shapes are the editors' own. The reliable way to learn one is to build the content in the editor, `GET` it, and change what you need.

## Slides

These edit one slide at a time on a `slides` document. Other people's edits to other slides are kept. On another document type they return `400 Slide operations are only available on slides documents; ...`.

Each returns `{ "id", "index", "slideCount" }`: the slide's ID, its 1-based position, and the number of slides in the deck.

### List layouts

`GET /layouts`

Returns `{ "layouts": [{ "id", "name", "masterId", "placeholders" }] }`. `placeholders` lists the placeholder types in order, such as `["title", "body"]`. A deck that stores its own layouts, such as one imported from PowerPoint, lists those; otherwise you get the built-in layouts.

### Add a slide

`POST /slides`

| Field | Type | Description |
|---|---|---|
| `layoutId` | string | Layout from [List layouts](#list-layouts). Default `blank` |
| `index` | integer | 1-based position. Omit it to add at the end |

```bash
curl -s -X POST \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"layoutId": "title-body", "index": 2}' \
  "$WFB_API/workspaces/$WS/documents/$DOC/slides"
```

This adds a slide with a title and body in second position. A deck imported from PowerPoint has its own layout IDs, so check `GET /layouts` first.

### Duplicate a slide

`POST /slides/<slideId>/duplicate`

Copies the slide and puts the copy right after it.

### Move a slide

`POST /slides/<slideId>/move` with `{ "index": 1 }`

Moves the slide to a 1-based position. A position past the end moves it to the end.

### Delete a slide

`DELETE /slides/<slideId>`

Deletes the slide. `index` is absent from the response. The last slide cannot be deleted: `409`. Delete the document instead.

An unknown slide is `404 Slide not found`.

## Comments

Comment threads work on `sheet`, `doc`, and `pdf` documents. Another type is `400 Comments are available on sheet / doc / pdf documents; ...`.

The caller is the comment's author. A comment can mention a workspace member with `@[username](userId)`, which notifies them. A reply notifies the thread's earlier participants, and resolving a thread notifies its participants, the same as in the editor.

A thread looks like this:

```json
{
  "id": "6d0b9c1e-4f2a-4b8e-9a37-2c5e1f8d7a90",
  "anchor": { "kind": "sheet-cell", "tabId": "tab-1", "rowId": "r3", "colId": "c2", "ref": "B3" },
  "comments": [
    {
      "id": "b8e4a2f0-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
      "body": "Is this number final?",
      "author": { "userId": "12", "username": "alice" },
      "createdAt": 1762075200000
    }
  ],
  "resolved": false,
  "createdAt": 1762075200000
}
```

`anchor` says where the thread is:

| `kind` | Document | Where |
|---|---|---|
| `sheet-cell` | Sheet | A cell. `ref` is its current address; the thread follows the cell when rows or columns move. `ref` is `null` once the row or column is deleted |
| `pdf-region` | PDF | `pageIndex` (0-based) and `rect` `{ x, y, w, h }`, each 0 to 1 relative to the page |
| `pdf-text` | PDF | Selected text |
| `docs-range` | Doc | Text selected in the editor |

### List threads

`GET /comments`

Returns `{ "threads": [ ... ] }`, oldest first. For a sheet, threads from every tab are included, tab by tab in tab order.

### Start a thread

`POST /comments`

| Field | Document | Description |
|---|---|---|
| `body` | All | The comment text. Required, not blank |
| `tabId`, `ref` | Sheet | The tab and cell, such as `tab-1` and `B3` |
| `pageIndex`, `rect` | PDF | 0-based page and a region `{ x, y, w, h }` with each value 0 to 1 |

```bash
curl -s -X POST \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"tabId": "tab-1", "ref": "B3", "body": "Is this number final? @[bob](14)"}' \
  "$WFB_API/workspaces/$WS/documents/$DOC/comments"
```

This comments on cell `B3` and notifies Bob. Returns the new thread.

- On a `doc`, starting a thread is refused with `400`: a doc comment must be attached to text selected in the editor. You can list, reply to, resolve, and delete doc threads.
- On a sheet, the cell must be inside the part of the grid the sheet already stores. A cell beyond the last stored row or column is `400`; write a value in that row and column first.

### Reply to a thread

`POST /comments/<threadId>/replies` with `{ "body": "Yes, confirmed." }`

Returns `{ "threadId", "comment" }`.

### Resolve or reopen a thread

`PATCH /comments/<threadId>` with `{ "resolved": true }`

Send `false` to reopen. Returns the thread.

### Edit a comment

`PATCH /comments/<threadId>/comments/<commentId>` with `{ "body": "..." }`

Only the comment's author can edit it; anyone else gets `403 Only the author of a comment can edit or delete it.` Editing does not notify anyone. Returns `{ "threadId", "comment" }`.

### Delete a comment or a thread

`DELETE /comments/<threadId>/comments/<commentId>` deletes one comment. Deleting a thread's first comment deletes the whole thread. Returns `{ "id", "threadId", "deleted" }`, where `deleted` is `comment` or `thread`.

`DELETE /comments/<threadId>` deletes the thread and returns `{ "id", "deleted": "thread" }`.

Only the author of the comment, or of the thread's first comment, can delete. An unknown thread or comment is `404`.

## Related

- [Comments](/collaborate/comments) for how threads look in the editors.
- [Version history](/collaborate/version-history) to restore a document after a bad `PUT`.
- [Boards](/developers/api/board) to add stickies and sections without replacing a board.
- [`wafflebase slides`](/developers/cli/slides-and-board) to build and check a deck from the terminal.
