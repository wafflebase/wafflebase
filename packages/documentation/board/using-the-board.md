# Using the Board

A **board** is an infinite, freeform canvas — a Miro/FigJam-style whiteboard
for sketching ideas, arranging sticky notes, and collaborating in real time.
Unlike a slide, a board has no fixed page size: you pan and zoom across a
boundless plane.

## Create a board

1. Open your workspace
2. Click the **New** dropdown button
3. Select **New Board**

The board opens with an empty canvas and appears in your workspace document
list.

## Move around the canvas

- **Scroll or two-finger swipe** pans across the plane
- **⌘/Ctrl + wheel** (or a trackpad pinch) zooms about the pointer, so the point
  under the cursor stays where it is
- **Hold Space and drag**, or **drag with the middle mouse button**, to pan
  without disturbing whatever is under the pointer. An ordinary drag still
  selects, moves, or resizes.
- **Zoom ▾** in the toolbar offers fixed steps (50%, 75%, 100%, 150%, 200%) and
  **Fit**, which frames everything on the board. The range runs from 10% to
  800% — wider than a slide's, because an infinite plane gets surveyed further
  out and inspected further in.
- The **minimap** in the bottom-right corner shows the whole board at a glance;
  drag inside it to jump to another area, and use its **Map ▾** button to
  collapse it out of the way

An existing board **opens framed on its content** rather than at the empty world
origin, so you never have to hunt for it — which matters most for an imported
board, whose content can sit a long way from that origin.

Right-clicking empty canvas gives you **Paste**, **Select all**, **Fit to
content**, and **Snap to grid**.

## The toolbar

The toolbar morphs with what you are doing. With nothing selected it runs, left
to right:

- **Undo / Redo**
- **Zoom ▾**
- **Grid ▾** — the background grid: **None**, **Dot grid** (the default), or
  **Line grid**, plus a separate **Snap to grid** checkbox that quantizes moves
  and resizes onto the grid. The two are independent, so snapping still works
  with the grid hidden. Both are your own view settings, remembered in this
  browser rather than stored in the board, so every collaborator picks their own.
- **Select** (`Esc`) — select, move, and resize existing items
- **Text box** — drop freeform text anywhere on the canvas
- **Sticky note ▾** — clicking drops a yellow sticky; the chevron next to it
  opens a 6-color palette. Text inside a sticky shrinks to fit.
- **Insert image** — opens a file picker (PNG, JPEG, GIF, or WebP). You can also
  paste or drag an image straight onto the canvas.
- **Shape ▾** — a picker of 137 shapes across eight categories: Shapes, Block
  Arrows, Banners, Flowchart, Callouts, Equation, Stars, and Action Buttons
- **Line ▾** — **Line**, **Arrow**, **Elbow connector**, **Curved connector**,
  and a freehand **Scribble**. Connectors snap onto a shape's connection points
  as you draw, and an attached endpoint follows its shape when the shape moves.

### When something is selected

Extra controls appear at the end of the toolbar, depending on what you picked:

- **Shapes and connectors** — **Fill** (a solid color or a gradient; connectors
  have no fill) and **Border** (color, weight, dash)
- **Images** — **Crop** and **Reset crop**. *Replace* is not wired up on a board;
  insert a new image instead.
- **Text boxes** — the box's own background fill and border
- **Arrange** — **Group** / **Ungroup**, **Order** (bring to front or forward,
  send backward or to back), **Align** (needs two or more selected),
  **Distribute** (three or more), and **Rotate 90°** either way

Double-click an item to edit its text, and the toolbar switches again: font
family and size, bold, italic, underline, text color, clear formatting,
paragraph alignment, bulleted and numbered lists, and indentation — then
**Done** (or `Esc`) to come back out.

## Collaborate

Boards sync in real time through the same collaboration engine as the rest of
Wafflebase. Changes appear instantly for everyone, and you see each teammate's
live **cursor** as well as their **selection** — whatever they have picked up is
ringed in their color, so you can tell what someone is about to move before they
move it.

::: tip
Share a board the same way as any other document — see
[Collaboration & Sharing](/guide/collaboration). Viewers with read-only access
can still pan and zoom around the board.
:::

## Import a Miro board

An existing Miro board can come in as a new Wafflebase board. The entry is
**Import from Miro…**, in the workspace **New** dropdown — not on the board
itself, since the import creates the document. You paste a Miro access token and
the board URL; the token is used for that one import and is never stored. See
[Import & Export](/guide/import-export) for what comes across and what doesn't.

## Version History

Boards are versioned like every other editable document type. Click the
**history** icon in the header to browse earlier versions, open one read-only,
and roll the board back. See [Version History](/guide/version-history).
