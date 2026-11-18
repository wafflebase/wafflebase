---
name: recipe-board-cluster
description: Cluster a board's stickies by theme into sections and write a summary — the AI half of a brainstorm
safety: write
tools:
  - wafflebase board elements
  - wafflebase board add-section
  - wafflebase board move
  - wafflebase board add-text
  - wafflebase board add-stickies
---

# Cluster Stickies by Theme

## When to Use

After a brainstorm on a Wafflebase board, when the user asks you to "group
these", "cluster the stickies", "find the themes" or "summarize the board".
Wafflebase has no AI built into the app: **you** are the model, and you edit
the same board the participants are looking at, live. Everything you create
is an ordinary sticky, section or text box they can move, edit or delete.

## Steps

### 1. Read the stickies

```bash
wafflebase board elements <doc-id> --kind sticky
```

Each element has an `id`, its `text`, its `color`, its `frame`
(`{ x, y, w, h }`, world coordinates, top-left origin), and — when it already
sits in a section — `section` (that section's id). `stamps` and `votes`
(once a dot vote has ended) say what the group cared about; weigh them.
Run it without `--kind` to see existing sections (`kind: "section"`,
`title`) so you do not duplicate one.

### 2. Group by meaning

Read the texts and decide the themes yourself: 3–7 groups is usually right,
each with a short title in the participants' own words. Put every sticky in
exactly one group; an outlier can be its own "Other" group. Skip stickies
that already sit in a section unless the user asked you to re-cluster.

Show the user the proposed groups before writing anything when the board is
not yours alone — they are editing it with you.

### 3. Make a section per theme, its stickies in a grid inside it

One call per theme. `--grid` moves the listed stickies into a near-square
grid in free space (beside the existing content, never on top of it) and
wraps that grid in a titled section, in one change:

```bash
wafflebase board add-section <doc-id> --title "Faster releases" \
  --ids a1b2,c3d4,e5f6 --grid --color green
```

The response gives the section `id`, its `frame` and its `members`. Use a
different `--color` per theme (gray, yellow, green, blue, pink, purple).
To place sections deliberately — a row of themes, say — pass `--at x,y` with
each section's top-left (take the previous section's `frame.x + frame.w`
plus a gap of ~100).

Without `--grid`, `add-section` wraps the stickies where they already are.

### 4. Write the summary

```bash
wafflebase board add-text <doc-id> --near <first-section-id> --side above \
  --width 640 --bold --text "Summary: three themes — …"
```

Or a longer one from a file (newlines become paragraphs):

```bash
wafflebase board add-text <doc-id> --near <section-id> --side right --file summary.txt
```

A summary per section works the same way: `--near <section-id> --side below`.

### 5. Adjust if needed

Moving a section carries everything inside it, like a drag on the canvas:

```bash
wafflebase board move <doc-id> --data '[{"id":"<section-id>","x":0,"y":1200}]'
```

Entries are `{ id, x, y, w?, h? }` (top-left, optional new size). The batch
is all-or-nothing: an unknown id is a 404, a connector a 400 (it follows
what it connects), a locked section or anything inside it a 409.

## Notes

- Every write is one granular change: a collaborator editing another sticky
  at the same moment keeps their edit. Never use `board set-content` for
  this — it replaces the whole board.
- Run any write with `--dry-run` first to show the request without sending
  it.
- New stickies (`board add-stickies --text … --near <section-id>`) are useful
  for adding the themes' open questions or action items next to a section.
- On an anonymous board, element authors are not reported and new stickies
  record none.
- `wafflebase schema board.add-section` (and the other verbs) lists every
  flag.
