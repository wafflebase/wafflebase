# Themes & Layouts

Themes and layouts let you set the visual style of a deck once and reuse it across every slide.

## What is a Theme?

A **theme** bundles the colors, fonts, and background used across a deck. Switching themes reskins the whole deck in one click — your content (text, images, shapes) stays put, only the visual treatment changes.

Each theme defines:

- A **color scheme** with theme roles (background, text, accent, etc.). Shapes and text bound to a theme role automatically update when you switch themes.
- A **font scheme** for headings and body text. Text inside placeholders picks up the theme's heading or body font automatically.
- A **background** style applied to every slide.

## Built-in Themes

Wafflebase ships with **23 built-in themes** covering neutral, light,
editorial, vibrant, and dark looks. Click the palette button in the toolbar
(tooltip: **Theme**) to open the Theme panel on the right, then click a
thumbnail to apply it.

- **Simple Light** and **Simple Dark** — neutral baselines
- Streamline, Swiss, Paradigm, Material, Shift, Momentum, Focus, Luxe,
  Modern Writer, Coral, Spearmint, Pop, Tropic, Marina, Geometric, Plum,
  Slate, Forest, Spotlight, Beach Day
- **Wafflebase** — the Wafflebase brand palette

A new deck is seeded with **Simple Light**, or with **Simple Dark** if the app
is in dark mode when you create it. You can switch themes at any time.

Each entry in the picker is a swatch card, not a preview of your slides: it
shows an `aA` type sample on the theme's background, a strip of its six accent
colors, and the theme's name.

## Customizing a Theme

The **Theme** panel has two tabs: **themes** picks one from the catalog,
**customize** edits the one the deck is currently using. Every change applies
to the whole deck immediately and counts as a single undo step.

The customize tab has four sections:

- **Colors** — the twelve theme color roles: Text, Background, Text 2,
  Background 2, Accent 1–6, Link, and Visited link. Anything on a slide bound
  to a role follows the change; anything you gave a literal hex color does not.
- **Fonts** — the **Headings** and **Body** fonts.
- **Background** — the master background fill, which is what slides that
  haven't set their own background use. If you've changed it, a **Match theme**
  button appears to put it back.
- **Layouts** — **Edit layout positions** switches the canvas into layout-editing
  mode, where you drag a layout's placeholders. Changes flow to every slide
  using that layout.

Once you've edited a built-in theme, the panel shows the modified theme under
**In this presentation** at the top of the themes tab, and a **Reset to
original** button appears in the customize tab to discard your changes.

## Layouts

A **layout** is a pre-arranged template for a slide — for example, "Title slide" or "Title and body". Each layout defines a set of **placeholders** that you fill in with your content.

There are eleven built-in layouts, matching Google Slides. They are listed
here in the order they appear in the layout picker:

| Layout | Use it for |
|---|---|
| Blank | Empty canvas, no placeholders |
| Title slide | The opening slide of a deck — large title + subtitle |
| Section header | Section dividers between groups of slides |
| Title and body | A title with a single body region (text, bullets, or content) |
| Title and two columns | A title above two side-by-side content regions |
| Title only | A title with the rest of the slide left blank |
| One column text | A full-width body region for prose-heavy slides |
| Main point | A single large takeaway, centered |
| Section title and description | A section title plus a paragraph of description |
| Caption | A large image area with a caption below |
| Big number | A single large numeric stat as the focal point |

## Choosing a Layout

There are two separate actions, and it's worth keeping them apart:

**To add a *new* slide with a chosen layout**, use the **Add slide** control in
the toolbar. Clicking the button itself adds a blank slide; clicking the chevron
next to it opens **Choose a layout**, and picking one inserts a new slide with
that layout after the current one. This control never changes the slide you are
looking at.

**To re-lay-out the slide you are already on**, right-click it — either on an
empty part of the canvas or on its thumbnail in the strip — and choose
**Change layout…**, then pick the new layout. There is no toolbar button for
this.

When you change layout, the slide's existing placeholders are matched to the new
layout's slots when their types align, so the title stays a title and the body
stays a body.

## Slide Backgrounds

A theme sets the background for the whole deck. To override it on one slide,
click the background button in the toolbar (tooltip: **Background**) to open the
Background panel.

**Color** offers two tabs. **Solid** is a color picker with the theme palette,
standard colors, a custom color, and a transparency slider. **Gradient** gives
you a stops bar — click to add a stop, drag to move it, and set each stop's
color — plus eight direction presets and an angle. Gradients here are linear.

**Image** lets you pick a picture as the background, then set its **Opacity**,
swap it with **Replace image…**, or take it away with **Remove image**. A slide
has either a color or an image, not both — setting one clears the other.

Two actions sit at the bottom:

- **Reset to theme** drops this slide's own background so it inherits from the
  theme again.
- **Apply to all slides** pushes this slide's background onto the deck's master,
  so it becomes the new baseline. Slides that have set their *own* background
  keep it.

The panel always edits the slide you're currently on, and follows you as you
move between slides.

## Placeholders

A **placeholder** is a typed content slot in a layout — a title, a body, an image area, a footer. Placeholders carry the layout's default formatting (font, size, alignment) so text added through them automatically matches the theme.

When you switch layouts, Wafflebase preserves placeholder identity where possible: a title placeholder remains a title even if the new layout positions it differently, so its content survives the change.

## What's Next

- [Build a Deck](./build-a-deck) — End-to-end tutorial
- [Keyboard Shortcuts](./keyboard-shortcuts) — Slide, selection, and formatting shortcuts
