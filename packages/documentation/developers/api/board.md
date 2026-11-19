---
title: Boards
description: Endpoints to read a board's elements, add sticky notes, sections, and text, and move or resize elements without replacing the board.
type: reference
---

# Boards

Endpoints to read a board's elements, add sticky notes, sections, and text, and move or resize elements without replacing the board.

Paths are relative to `$WFB_API/workspaces/$WS/documents/$DOC/board`, where `$DOC` is a document of type `board`. Authentication and error shapes are on the [REST API overview](/developers/api/). The CLI equivalents are `wafflebase board elements`, `add-stickies`, `add-section`, `move`, and `add-text`; see [Boards](/developers/cli/slides-and-board#boards) in the CLI reference.

## Conventions

- Positions and sizes are in board units, the same ones the canvas uses. `x` grows to the right and `y` grows down. `x` and `y` are an element's top-left corner.
- Coordinates must be within ±10,000,000; widths and heights from more than 0 to 100,000.
- One request can create or move at most 500 elements. An empty list is `400`.
- Each request changes only the elements it names or adds. Edits that other people make to other elements at the same time are kept.
- Elements you add look and behave exactly like ones made on the canvas.
- Called on a document that is not a board, every endpoint returns `400 Board operations are only available on board documents; ...`.
- A board with more than 50,000 top-level elements, or with so many overlapping sections that working out which elements are in which section takes too long, is `400`.

To read or replace the whole board as JSON, use [`GET` and `PUT /content`](/developers/api/content#read-and-replace-content).

### Sections and membership

A section is a titled area. An element belongs to a section when at least half of its bounding box lies inside it. Membership is worked out from position every time, so moving an element into or out of a section changes its membership. Sections can nest; an element reports the smallest section it is in.

## Elements

### List elements

`GET /elements`

Returns `{ "elements": [ ... ] }`, one summary per element, from back to front:

```json
{
  "elements": [
    { "id": "s1", "kind": "section", "title": "Went well", "color": "#DCFCE7", "frame": { "x": 0, "y": 0, "w": 800, "h": 560, "rotation": 0 } },
    { "id": "k1", "kind": "sticky", "text": "Shipped on time", "color": "#FFF8B8", "frame": { "x": 48, "y": 48, "w": 180, "h": 180, "rotation": 0 }, "section": "s1", "author": "alice", "stamps": { "plus1": 2 } }
  ]
}
```

| Field | Present for | Description |
|---|---|---|
| `id` | All | Element ID |
| `kind` | All | `sticky`, `section`, `shape`, `freeform`, `text`, `connector`, `image`, `group`, `table`, or `chart` |
| `frame` | All | `{ x, y, w, h, rotation }` |
| `text` | Elements with text | Plain text, paragraphs joined by `\n` |
| `color` | Shapes with a solid fill | `#RRGGBB` |
| `section` | Elements inside a section | ID of the smallest section the element is in |
| `title` | Sections | Section title |
| `hidden`, `locked` | Sections | `true` when the section is hidden or locked |
| `from`, `to` | Connectors | IDs of the elements the ends are attached to |
| `stamps` | Stamped elements | Count per stamp, such as `{ "plus1": 2, "heart": 1 }` |
| `votes` | Voted elements, after voting ends | Number of votes |
| `author` | Stickies | Who created it. Left out on an anonymous board |

### Move or resize elements

`PATCH /elements`

Send an array of `{ id, x, y, w?, h? }`, or `{ "moves": [ ... ] }`. `x` and `y` are the new top-left corner; `w` and `h` resize.

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '[{"id": "k1", "x": 900, "y": 120}, {"id": "s1", "x": 0, "y": 700}]' \
  "$WFB_API/workspaces/$WS/documents/$DOC/board/elements"
```

This moves one sticky and one section.

- A section that moves takes its members with it. Connectors attached to a moved element follow.
- Returns `{ "moved": [ids you named], "carried": [ids that moved along] }`.
- The whole batch fails, and nothing moves, if any entry fails:

| Status | Cause |
|---|---|
| `404 Element not found: <ids>` | An unknown ID |
| `400` | The same element twice, or a connector (move what it connects instead) |
| `409` | A locked section, or an element inside one. Unlock it first |

## Sticky notes

### Add sticky notes

`POST /stickies`

Send one of two shapes.

**A list of stickies**, each placed where you say or, without `x` and `y`, in a grid in free space:

```json
[
  { "text": "Shipped on time", "color": "green", "x": 0, "y": 0 },
  { "text": "Too many meetings", "color": "pink" }
]
```

**Several texts with one color**, laid out as a grid in free space:

| Field | Required | Description |
|---|---|---|
| `texts` | Yes | Array of sticky texts |
| `color` | No | Color for all of them |
| `near` | No | An element ID to place the grid beside, or `{ "x", "y" }` to center it on. Without it the grid goes beside the existing content |
| `columns` | No | Grid columns, 1 to 100. Default: about the square root of the count |

```bash
curl -s -X POST \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"texts": ["Faster reviews", "Fewer meetings", "Better docs"], "color": "yellow", "near": "s1"}' \
  "$WFB_API/workspaces/$WS/documents/$DOC/board/stickies"
```

This adds three yellow stickies in a grid beside the section `s1`. Returns `{ "ids": [ ... ] }` in the order you sent the texts.

- `color` is `yellow` (the default), `green`, `blue`, `pink`, `orange`, `purple`, or any `#RRGGBB`.
- A sticky is 180 by 180. Grid cells are 24 apart. A placed grid avoids existing elements.
- Text is up to 10,000 characters. New stickies show the caller as author, unless the board is anonymous.

## Sections

### Add a section

`POST /sections`

| Field | Required | Description |
|---|---|---|
| `title` | Yes | Section title, not blank |
| `elementIds` | No | Elements to put in the section |
| `layout` | No | `wrap` (default) draws the section around `elementIds` where they are. `grid` first arranges them in a grid in free space, then wraps it |
| `at` | No | `{ "x", "y" }`: top-left corner of the section, for a `grid` layout or an empty section |
| `columns` | No | Grid columns for `grid`, 1 to 100 |
| `frame` | No | `{ x, y, w, h }` for an empty section. Not with `elementIds` |
| `color` | No | `gray`, `yellow`, `green`, `blue`, `pink`, or `purple` |

With neither `elementIds` nor `frame`, an empty 800 by 560 section goes in free space beside the content.

```bash
curl -s -X POST \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"title": "Process", "elementIds": ["k2", "k5", "k7"], "layout": "grid", "color": "blue"}' \
  "$WFB_API/workspaces/$WS/documents/$DOC/board/sections"
```

This gathers three stickies into a grid and wraps them in a blue section titled **Process**.

Returns `{ "id", "frame", "members", "moved" }`: the section, its frame, every element now inside it, and the elements the grid layout moved.

- The section is placed behind every element that is not a section, and behind smaller sections, the same as one drawn with the section tool.
- A wrapped section leaves 48 units of space around its elements.
- `grid` needs `elementIds` and cannot include a section; wrap sections with the default layout.
- An unknown ID is `404 Element not found: <ids>`.

## Text

### Add a text box

`POST /text`

| Field | Required | Description |
|---|---|---|
| `text` | Yes | Text, not blank, up to 10,000 characters |
| `x`, `y` | No | Top-left corner. Not with `near` |
| `near` | No | Element ID to place the text beside |
| `side` | No | With `near`: `right` (default), `left`, `below`, or `above` |
| `w` | No | Width. Default 400. The height fits the text |
| `fontSize` | No | 6 to 200 |
| `bold` | No | Boolean |

Without `x`, `y`, or `near`, the text goes beside the existing content. Unless you give `x` and `y`, the text box is moved off anything it would cover.

```bash
curl -s -X POST \
  -H "Authorization: Bearer $WFB_KEY" -H "Content-Type: application/json" \
  -d '{"text": "Summary: the team wants faster reviews and fewer meetings.", "near": "s1", "side": "below", "fontSize": 24, "bold": true}' \
  "$WFB_API/workspaces/$WS/documents/$DOC/board/text"
```

This writes a bold summary under the section `s1`. Returns `{ "id", "frame" }`.

## Related

- [Sections](/board/sections) for how sections behave on the canvas.
- [Run a retro on a board](/board/run-a-retro) for the session these endpoints can automate.
- [Document content](/developers/api/content#read-and-replace-content) to read or replace a whole board.
- [`wafflebase board`](/developers/cli/slides-and-board#boards) to do the same from the terminal.
