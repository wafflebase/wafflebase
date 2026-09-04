# Build a Deck

In this guide, you'll build a short three-slide deck from scratch. Along the way, you'll pick a theme, use a layout, add text and a shape, and present the deck full-screen.

## 1. Create a New Presentation

From your workspace, click **New** → **New Presentation**. You'll get a deck with one slide — an empty canvas, using the **Blank** layout — and a thumbnail strip on the left.

## 2. Pick a Theme

A **theme** controls the colors, fonts, and background used across every slide. Wafflebase ships with several built-in themes.

Click the palette button in the toolbar (tooltip: **Theme**) to open the Theme panel on the right, then click any theme to apply it to the whole deck. You can switch themes any time — your content stays put.

See [Themes & Layouts](./themes-and-layouts) for the full set of built-in themes and how to customize one.

## 3. Add a Title

The first slide starts blank, so give it a layout: right-click an empty part of
the canvas, choose **Change layout…**, and pick **Title slide**. The slide now
has a title and a subtitle placeholder.

Double-click the title placeholder and type a deck title — for example,
`Q2 Roadmap`. Double-click the subtitle placeholder and add a short tagline.

The placeholders inherit the heading and body fonts from the active theme, so you don't need to format text manually.

## 4. Add a Content Slide

Insert a new slide after the current one. The three routes differ in which
layout the new slide gets:

| How | Layout of the new slide |
|---|---|
| Press `⌘+M` / `Ctrl+M` | Same layout as the slide you're on |
| Click **Add slide** in the toolbar | Blank |
| Right-click the thumbnail strip → **New slide** | Blank |

To choose the layout as you insert, click the chevron next to **Add slide** —
its tooltip reads **Choose a layout** — and pick **Title and body**. That adds a
*new* slide with that layout; it does not re-lay-out the slide you're on. (For
that, see [Choosing a Layout](./themes-and-layouts#choosing-a-layout).)

Type a title — `Themes` — and add a few bullet points in the body placeholder:

- Theme picker in the right sidebar
- One-click reskin of the whole deck
- Built-in light and dark themes

## 5. Add a Shape

Slides ship with an OOXML-aligned shape library. From the toolbar, click **Shape** and pick a rectangle. Drag on the canvas to draw it.

With the shape selected, the **Fill** color in the toolbar shows the active theme palette at the top — so you can apply the theme's accent color without picking a hex value.

## 6. Present

When you're ready to present:

- Press `⌘+Enter` / `Ctrl+Enter` to start from the current slide, **or**
- Press `⌘+Shift+Enter` / `Ctrl+Shift+Enter` to start from the first slide.

In presentation mode:

- `→` / `Page Down` / click — advance to the next slide
- `←` / `Page Up` — go back
- `Esc` — exit

## Format Options

Most per-object settings that aren't on the toolbar live in the **Format
options** panel. Open it with the sliders button at the right end of the
toolbar (tooltip: **Format options**). With nothing selected it shows
**Slide size** — Widescreen 16:9, Standard 4:3, or Widescreen 16:10.

Slide **width is fixed** and its box is disabled; only the **Height** changes,
which is what changes the aspect ratio. To go to a size that isn't one of the
three presets, type a height — the preset dropdown then reads *Custom* on its
own. Picking **Custom** from the dropdown does nothing.

Select something and the panel shows the sections that apply to it:

| Section | Appears for | What's in it |
|---|---|---|
| **Size & Position** | Everything | Width, Height, X position, Y position, Rotation, a **Lock aspect ratio** toggle, two 90° rotate buttons, and a deck-wide **Units** choice of Inches or Centimeters |
| **Text fitting** | Text boxes | Do not autofit / Shrink text on overflow / Resize shape to fit text |
| **Recolor** | Images | No recolor / Grayscale / Sepia |
| **Adjustments** | Images | Transparency, Brightness, Contrast |
| **Drop shadow** | Shapes, images, text boxes | Color, Transparency, Angle, Distance, Blur |
| **Reflection** | Shapes, images, text boxes | Transparency, Distance, Size |
| **Alt text** | Shapes, images, text boxes, tables | A description for screen readers |

Connectors and groups get **Size & Position** only, and tables get
**Size & Position** and **Alt text**. Width, Height, and Rotation are hidden
for connectors, and a text box set to *Resize shape to fit text* has its
Height locked, since it's computed from the content.

## Rulers, Guides, and Snapping

Rulers run along the top and left of the canvas. They're always on — there's
no show/hide command — and they use inches or centimetres based on your
locale, independently of the **Units** choice in the Format options panel.

To place a **guide**, press on a ruler and drag onto the slide; release inside
the slide to drop it, or outside to cancel. Drag an existing guide to move it,
or drag it back onto a ruler to delete it. Right-clicking on or near a guide
offers **Delete guide**, **Delete all vertical guides** / **Delete all
horizontal guides**, and **Delete all guides**.

Guides belong to the whole presentation, not to one slide.

Snapping is always on as you drag: elements snap to the slide centre, to your
guides, and to other elements' edges. **Smart guides** — the arrows and dashed
outlines showing equal spacing or matching sizes — are always on too; neither
has a setting. Hold `Shift` while resizing to **preserve the aspect ratio**
(which also turns off equal-size snapping, since the two would fight), and
`Shift` while dragging to lock movement to one axis.

## Copy Formatting Between Objects

The brush button in the toolbar (tooltip: **Format painter**) copies fill and
stroke from one object to another:

1. Select a single shape, text box, or connector.
2. Click **Format painter**.
3. Click the object you want to paint.

It applies once and switches itself off — there is no double-click-to-stay-on
mode, and no keyboard shortcut. Click the button again, or press `Esc`, to
cancel without painting. Selecting nothing (or more than one object) makes the
button do nothing, and images can't be used as a source.

Shapes and text boxes share a fill and stroke, so you can paint either way
between them — a shape's formatting onto a text box, or the reverse. (Painting
onto text keeps only a solid colour: a gradient fill collapses to one of its
colours.) Connectors are the exception: they carry a stroke only, so a
connector can be painted onto another connector and nothing else, and nothing
else can be painted onto a connector.

## Crop an Image

Select an image and click the crop button in the toolbar (tooltip: **Crop**),
or just double-click the image. The picture dims outside the crop window, and
eight black handles appear on the window itself:

- Drag a handle to trim.
- Drag *inside* the window to slide the picture under it.
- Press `Enter`, click the toolbar button again (now **Done cropping**), or
  click anywhere outside the crop window to apply.
- Press `Esc` to cancel.

**Reset crop**, next to the crop button, restores the full picture in one undo
step; it's greyed out until the image has actually been cropped.

Cropping is a free rectangle only — there are no aspect-ratio presets and no
crop-to-shape. Images inside a group can't be cropped; ungroup first.

## Speaker Notes

Every slide has a speaker-notes box below the canvas, showing the placeholder
**Speaker notes…** when it's empty. Click into it and type — notes are saved
with the slide, and switching slides switches the notes with them.

The pane is always visible; there is no show/hide toggle. Drag the thin
divider directly above it to make it taller or shorter (the size is remembered
per browser). It can be shrunk but not collapsed away entirely.

Two limits worth knowing:

- **Notes are plain text.** There is no bold, italic, or bullet formatting in
  the notes box.
- **They are not shown while presenting.** There is no presenter view or
  second-screen notes display — presentation mode shows the slide only. Notes
  *are* written into a `.pptx` export as real PowerPoint notes, so a deck you
  export keeps them; a PDF export does not include them.

Notes are last-write-wins if two people type in them at once — see
[Editing at the Same Time](#editing-at-the-same-time) below.

## Editing at the Same Time

::: warning Two people in the same text lose one set of edits
Text in a deck is **not** merged character by character the way it is in the
document editor. Speaker notes, text boxes, shape text, and table cells each
commit their whole contents when you click away, so the last person to click
away overwrites what the other typed — silently, with no conflict prompt.

Presence cursors show you where others are working; use them to keep out of
each other's text, or take turns.
:::

Structural edits converge without losing work: adding, deleting, duplicating,
and reordering slides; adding, deleting, and restacking elements; table row and
column changes; and theme and guide changes. Moving or restyling elements
settles per field on the last change committed, so two people dragging
*different* elements are fine — it's two people in the same text box, or the
same notes, that costs somebody their edits.

## Arrange, Align, and Order

With one or more elements selected, the **Arrange** button in the toolbar
(the stacked-layers icon) collects the positioning commands:

| Menu entry | What it does |
|---|---|
| **Group** / **Ungroup** | Bind the selection into one object, or break it apart. Group needs 2+ elements selected; Ungroup needs a single selected group. |
| **Order** → Bring to front / Bring forward / Send backward / Send to back | Move the selection up and down the stacking order. |
| **Align** → Left / Center / Right / Top / Middle / Bottom | With several elements selected, aligns them to each other. With just one selected, aligns it to the slide. |
| **Distribute** → Horizontally / Vertically | Even out the gaps. Needs **3 or more** elements — the outermost two stay put and the ones between them move. |
| **Rotate 90° clockwise** / **Rotate 90° counter-clockwise** | Each selected element turns about its own center. |

Each command counts as a single undo step, and every element keeps whatever
rotation it already had.

The **Arrange** button only appears while something is selected — with an empty
selection the toolbar shows its idle tools instead.

## Add a Table

Click the **Insert table** button in the toolbar and drag across the grid
picker to choose the number of rows and columns, then click to drop the table
on the slide.

- **Double-click** a cell to edit its text; the text-formatting toolbar appears
  while you type.
- **Tab** / **Shift+Tab** move between cells — pressing Tab in the last cell
  adds a new row.
- **Right-click** a cell for structure changes: **Insert row above/below**,
  **Insert column left/right**, **Delete row/column**, and **Merge cells** /
  **Unmerge cells**.

## Connect Shapes

Use connectors to link shapes — handy for flowcharts and diagrams. Click the
**Line** dropdown in the toolbar and pick a tool:

- **Line** and **Arrow** — straight connectors.
- **Elbow connector** — right-angled routing.
- **Curved connector** — a smooth curve.
- **Scribble** — freehand drawing, not a connector.

Drag from the start point to the end point. As you approach a shape, connection
points appear and the endpoint snaps to it, so the connector stays attached when
you later move the shape. To change the routing of a selected connector,
right-click it and choose **Straight**, **Elbow**, or **Curved**.

## Animations & Transitions

Click the sparkles button in the toolbar (tooltip: **Motion**) to open the Motion panel on the right.

**Slide transitions** (how one slide gives way to the next):

1. In the **Transition** section, pick a type — Fade, Dissolve, Slide, Flip,
   Cube, Wipe, or Push.
2. Choose a speed (Slow / Medium / Fast).
3. Click **Apply to all slides** to use the same transition everywhere.

**Object animations** (how an element enters, exits, or is emphasized):

1. Select an element on the slide.
2. In the **Animation** section, click **+ Add animation**.
3. Pick a **Category** (Entrance, Exit, or Emphasis) and an **Effect**, then set
   when it runs with **Start** — **On Click**, **With Previous**, or **After
   Previous**. Fine-tune **Duration**, **Delay**, and **Easing** as needed.

Click the **▶ Play** button to preview the animations right in the editor.
They also run when you present the deck.

## Charts in an Imported Deck

::: warning Exporting to PowerPoint drops imported charts
If you import a `.pptx` that contains charts, they appear on the slides and
they render in a PDF export — but **a PowerPoint (`.pptx`) export omits them,
with no warning**. The rest of the deck exports normally; the chart is simply
absent from the exported file.
:::

In a deck, charts can only arrive by importing a PowerPoint file — the slides
toolbar has no insert-chart tool, and an imported chart cannot be edited. You
can move and resize it, but its numbers, series, and type are fixed at whatever
PowerPoint last saved. (Spreadsheets *do* have an **Insert chart** button; see
[Charts & Pivot Tables](/sheets/charts).)

If you need a round-trip through `.pptx` on a deck with charts, keep the
original file, or rebuild the chart as a picture before exporting.

See [Import & Export](/guide/import-export) for the full format support table.

## What's Next

- [Themes & Layouts](./themes-and-layouts) — Catalog of themes, layouts, and placeholders
- [Keyboard Shortcuts](./keyboard-shortcuts) — Full shortcut reference
- [Collaboration & Sharing](/guide/collaboration) — Invite others to co-edit the deck
