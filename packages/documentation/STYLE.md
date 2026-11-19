# Wafflebase documentation style guide

How we write the user-facing pages in `packages/documentation`. The goal: a
reader finds the task, does it, and moves on. When in doubt, cut.

## Audience and scope

- **User pages** (Get started, Collaborate & organize, Sheets, Docs, Slides,
  Notes, Board, Files) are for people using Wafflebase in a browser. Assume
  no technical background.
- **Developer pages** (`developers/`) are for people scripting or self-hosting.
  Assume a terminal, not knowledge of our codebase.
- **Not here:** architecture, data models, CRDT/Yorkie behavior, why a design
  was chosen, security derivations, or code paths. Those belong in
  `docs/design/` and package READMEs. Link there from a developer page only
  when an operator truly needs the depth.

Test: if a sentence explains *why the code works that way*, delete it or move
it. State behavior and limits as facts: "Zoom ranges from 10% to 800%."

## Voice and tense

- Second person, present tense, active voice: "Click **Share**. The dialog
  opens." Not "The user should click" or "will open".
- Imperative for instructions. Start steps with a verb.
- Plain words: "use", not "utilize"; "turn on", not "enable" where natural.
- Short sentences (aim under 25 words) and paragraphs of 1-4 sentences.
- No competitor comparisons ("Miro-style", "like Google Docs"). Say what the
  reader can do.
- No "simply", "just", "easy", "obviously". No exclamation marks. No emoji.
- American English. Use the serial comma.
- Name things consistently: *workspace*, *document* (any type), *sheet*,
  *doc*, *presentation*/*deck*, *note*, *board*; *share link*; *editor* and
  *viewer* for share roles.

## Frontmatter

Every page starts with:

```yaml
---
title: Add and style sticky notes
description: Add sticky notes to a board, change their color, and resize them.
type: how-to   # tutorial | how-to | reference | explanation | overview | troubleshooting
---
```

`description` is the opening sentence; VitePress uses it for search and
link previews.

## Page anatomy

Pick one type per page and stay in it. Templates:

**Overview** (editor hub): definition sentence + 3 "Use it to..." bullets,
orientation screenshot, Get started in 3 steps (create, edit, share) linking
out, tasks grouped by goal, phone summary, reference links, Next steps.

**Tutorial**: what you will build + time estimate, Before you start,
numbered milestone H2s ("1. Create the sheet") with 2-6 steps each and
copyable sample data, a final checkpoint screenshot, Next steps. One path, no
options, no rationale.

**How-to**: outcome sentence, optional `Before you start`, one verb-first H2
per task with numbered steps, optional alternative routes as H3s, "On a
phone" where the path differs, Known limitations, Related. Keep under about
1,500 words; split larger pages into a hub plus child pages.

**Reference**: one-line purpose, conventions note, how to open the in-app
equivalent, grouped tables. No narrative. One page per CLI namespace or API
resource.

**Explanation**: "How X works". Short answer first, then concepts, then "What
this means for you". User-observable behavior only.

**Troubleshooting**: one H2 per symptom, titled by what the reader sees, with
What it means, Try this (ordered fixes), and Still stuck.

## Titles and headings

- Sentence case everywhere: page titles, headings, sidebar labels.
  "Create a board", not "Create a Board".
- How-to titles and H2s start with a verb and name a goal:
  "Share a document with a link", "Set page size and margins".
  Avoid noun headings ("The toolbar", "Pagination") outside reference pages.
- Tutorials: "Build a budget", "Run a retro on a board".
- Reference: nouns ("Keyboard shortcuts", "Supported file formats").
- Troubleshooting: the symptom ("A share link opens read-only") or the
  literal error in a code span.
- Use H2 and H3 only. No H4. No headings that are bare links or code.
- The sidebar label matches the page H1, except a section's `index.md`,
  which is labeled "Overview" under its section heading.

## Opening

The first line under the H1 is one sentence that says what the reader will
do or what the thing is:

> A board is an infinite canvas where you arrange sticky notes, shapes, and
> images with your team.

Then, if needed, 1-3 sentences of scope: who can do it and the main caveat.

## Before you start

Use when a task has a role, platform, or limit requirement. Max 3 bullets.

```md
::: info Before you start
- You need **Editor** access. A viewer link can't change the board.
- Works on a phone, except drawing with the marker.
- Images: PNG, JPEG, GIF, or WebP, up to 25 MB.
:::
```

## Steps

- Number every procedure. One action per step. 2-7 steps; more means split.
- First step sets context: "Open the document." / "In your workspace, click
  **New**."
- Name the control, then its location if needed: "Click **Share** in the top
  right."
- Menu paths use ` > ` between bold labels: **Format > Text > Bold**.
- Put a default or a branch inside the step: "By default this exports every
  slide. To export one, choose **Current slide**."
- End with the visible result, as a plain sentence after the list: "The
  board opens framed on its content."
- Use "click" for mouse, "tap" for touch, "select" for choosing from a list
  or menu, "press" for keys, "type" or "enter" for text.
- Explanation goes after the steps in one sentence, or not at all.

## UI labels

- Bold, spelled exactly as on screen, including ellipses and carets:
  **Upload files…**, **Zoom ▾**, **New from template**.
- Do not bold for emphasis; use emphasis sparingly with `*italics*`.
- For icon-only buttons, describe the icon once, then use its tooltip name:
  "Click the clock icon (**Version history**)."
- Keys, file names, cell references in prose, typed values, and commands go in
  code spans: `Tab`, `budget.xlsx`, `=SUM(B2:B10)`. Cell names used as
  locations may be bold, matching existing pages: click cell **A1**.

## Shortcuts

- Notation: Mac first, each in its own code span, separated by ` / `:
  `⌘+C` / `Ctrl+C`. Single keys without modifiers: `Tab`, `Escape`.
- Join simultaneous keys with `+` and no spaces: `⌘+Shift+Z`.
- Use symbols for arrows (`↓`) and `⌘`; spell out `Shift`, `Alt`
  (Mac: `Option`), `Ctrl`, `Enter`, `Escape`, `Space`.
- In mouse gestures, the key is in code and the gesture in prose:
  "hold `Space` and drag".
- How-to pages mention only the shortcut for the task at hand, then link to
  the reference. Do not copy shortcut tables into how-to pages.
- Each editor has one `keyboard-shortcuts.md`. It opens with how to show the
  in-app list (`⌘+/` / `Ctrl+/`), uses a "To do this | Press" table, starts
  with a **Most used** group, and keeps the same group order across editors:
  Most used, Navigation, Selection, Editing, Formatting, Objects, View.
- When the app's shortcut dialog changes, update the page in the same PR.

## Admonitions

Use sparingly: at most one per screen, two sentences max. Never put a step
inside one. Fixed meanings:

| Block | Use for |
|---|---|
| `::: tip` | A faster route or a handy shortcut |
| `::: info` | Behavior worth knowing; `Before you start` |
| `::: warning` | You can lose work or share more than intended (restoring a version, a public link) |
| `::: danger` | Irreversible or security-sensitive (permanent delete, API keys, auth webhook off) |

Give a custom title only for `info Before you start` and when the default
title would mislead.

## Screenshots and GIFs

**Add one when** it orients (one labeled toolbar shot per editor overview),
confirms (tutorial checkpoint: "Your sheet should look like this"), locates
a non-obvious dialog (Share, Page setup, Version history, Miro import), or
shows a gesture text explains badly (pinch-zoom, connector snapping, drag
into a section; short silent GIF, under 10 seconds).

**Do not add one** for a single obvious button, a menu that the steps already
name, anything purely decorative, or UI that changes often without a way to
regenerate it. Never put information only in an image; the steps must work
without it.

**Files**: `public/images/<section>/<page>-<what>[-mobile].png`, lowercase,
hyphens, e.g. `public/images/board/sticky-notes-colors.png`,
`public/images/slides/build-a-deck-final-mobile.png`. Reference them as
`/images/<section>/<file>`. Existing root-level images may stay until the page
is next edited.

**Capture**: desktop at 1440x900, browser chrome cropped, default light
theme, sample data that looks real (no lorem ipsum, no real personal data or
tokens). Phone at **393x659** (iPhone 16 with Safari toolbars), only where the
phone layout differs. Prefer reproducible captures with the Playwright tooling
(`packages/frontend/scripts/capture-before-after.mjs shoot`, with
`--desktop` for 1440x900 and no flag for 393x659). Compress PNGs; keep each under 300 KB.

**Alt text** says what the image shows or proves, not "screenshot":
`![Budget sheet with a Total row summing each month](...)`. Under 125
characters. Decorative images don't belong on the site.

## Platform notes (phones)

- Default to desktop steps. When the phone path differs, add an
  `### On a phone` H3 under the task (or a step note) that says where the
  control lives (**More** menu, the ⋮ overflow, a bottom sheet) and which
  gestures apply ("Pinch to zoom", "Tap and hold to select").
- State what is view-only on a phone plainly: "On a phone you can view and
  comment on a board, but not draw."
- Do not split whole pages into platform tabs; use `::: code-group`-style
  tabs only when every step differs.
- Keep the capability matrix on `start/phone.md` current; link it
  from `Before you start` instead of repeating caveats.

## Examples

- Use realistic, copyable data: names (Alice, Bob, Carol), `@example.com`
  emails, plausible amounts and dates. Never real people, tokens, or URLs that
  aren't ours or `example.com`.
- Formulas and commands in fenced blocks with a language (`text`, `bash`,
  `json`). One command per line; show output only when the reader checks it.
- Caption every CLI or API example with a sentence saying what it does.
- Where a template exists, link it: "Or start from the **Retro** template."

## Tables and lists

- Tables for lookups (options, formats, shortcuts, flags). Header row in
  sentence case; keep cells short.
- Bullets for unordered items, numbers only for sequences. Parallel
  grammar within a list. No period on fragments; periods on full sentences.

## Links and endings

- Link text is the target's title or the action: "see
  [Version history](/collaborate/version-history)". Never "click here".
- Use root-relative links without `.html` (`/sheets/formulas#lookup`).
- Link a concept the first time it appears on a page, not every time.
- Every page ends with a closing block of 2-5 curated links:
  - Tutorials and overviews: `## Next steps`.
  - How-to, reference, troubleshooting, explanation: `## Related`.
  Add a few words on why: "[Share a document](...) to invite reviewers."
- Shared concepts (sharing, comments, version history, templates, import and
  export) are documented once in `collaborate/` or `files/` and linked from
  every editor. Link to a page's current URL, never to a moved-page stub.

## Limits and known issues

- State limits as facts in `Before you start` or a `## Known limitations`
  list at the end. Not inline in the main flow.
- Name the workaround if there is one: "To replace an image, delete it and
  insert a new one."
- A user-visible error or warning gets a symptom-titled entry in
  troubleshooting; link to it from the task.

## Developer pages

- Same voice and structure rules. Split by namespace (CLI) or resource (REST).
- Each command block: purpose, example, synopsis, flags table
  (Flag | Description | Default), output, notes, related.
- Configuration as tables (Variable | Required | Default | What it does),
  grouped by feature. Security implications go in `::: danger`.
- Mark version requirements inline: "Requires CLI 0.7 or later."
- Rationale for a security design links to `docs/design/`; the page says
  what to configure and what happens if you don't.

## Keeping pages current

- A PR that changes user-visible behavior updates the matching page, its
  screenshots, and the shortcut reference in the same PR.
- New features get a task heading, not a new bullet in an inventory.
- Before merging a docs change, run `pnpm dev`, open the page, and check every
  link, image, and step against the running app.
