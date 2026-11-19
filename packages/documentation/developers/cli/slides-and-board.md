---
title: Slides and boards
description: Command reference for decks, individual slides, PowerPoint import and export, deck checks, and board elements with the wafflebase CLI.
type: reference
---

# Slides and boards

Reference for the `slides` and `board` commands.

Conventions: `<doc-id>` is the deck's or board's document ID. Slide positions are 1-based. Every write accepts `--dry-run`. On a document of another type these commands fail, usually with `400` or `TYPE_MISMATCH`.

## Manage decks

```bash
wafflebase slides list
wafflebase slides create "Kickoff"
wafflebase slides get <doc-id>
wafflebase slides rename <doc-id> "Kickoff (v2)"
wafflebase slides delete <doc-id>
```

`slides list` shows only decks. `slides delete` moves the deck to the trash. To copy a deck or file it in a folder, use [`docs copy` and `docs move`](/developers/cli/documents#manage-any-document).

## Read a deck

```bash
wafflebase slides content <doc-id> --format md --notes
wafflebase slides content <doc-id> > deck.json
```

| Flag | Description | Default |
|---|---|---|
| `--format <fmt>` | `json` prints the whole deck. `md` and `text` print the text of each slide: text boxes, shape text, and table cells. | `json` |
| `--notes` | Include speaker notes in `md` and `text` | off |
| `--out <file>` | Write to a file. `-` writes to standard output. | standard output |
| `--force` | Overwrite an existing `--out` file | off |

The JSON has each slide's `id`, which the [slide commands](#add-move-and-delete-slides) take.

## Export to PowerPoint

```bash
wafflebase slides export <doc-id> kickoff.pptx
wafflebase slides export <doc-id> - --format pptx > kickoff.pptx
```

The export writes text, shapes, images, tables, connectors, groups, effects, the theme and layouts, speaker notes, transitions, and animations. The format comes from the `.pptx` extension; to write to standard output, pass `-` and `--format pptx`. `--force` overwrites an existing file. Images the deck embeds are fetched while exporting; one that can't be reached is reported on standard error and left out.

## Import a PowerPoint file

```bash
wafflebase slides import kickoff.pptx --title "Kickoff"
wafflebase slides import kickoff-v2.pptx --replace <doc-id> --yes
```

| Flag | Description | Default |
|---|---|---|
| `--title <title>` | Title of the new deck | file name without extension, or `Untitled` from standard input |
| `--replace <doc-id>` | Replace the content of an existing deck | |
| `--yes` | Skip the confirmation prompt for `--replace` | off |

A new deck prints `{ "id", "title", "report" }`; a replace prints `{ "id", "replaced": true, "report" }`. `report` counts what the import couldn't carry over exactly: `groupsFlattened`, `textBoxesPreScaled`, `unknownShapes`, `unknownLayoutTypes`, and `skippedImages`. `-` reads the file from standard input. In a terminal, `--replace` asks before it overwrites; in a script, it fails with `CONFIRMATION_REQ` unless you pass `--yes`.

## Replace a deck from JSON

```bash
wafflebase slides content <doc-id> > deck.json
# edit deck.json
wafflebase slides set-content <doc-id> < deck.json
```

::: danger This replaces the whole deck
`slides set-content` overwrites every slide. It doesn't merge and doesn't ask first. Make a restore point with `docs copy <doc-id>`, and check the request with `--dry-run`.
:::

## Add, move, and delete slides

```bash
wafflebase slides layouts <doc-id>
wafflebase slides slide add <doc-id> --layout <layout-id> --index 4
wafflebase slides slide duplicate <doc-id> <slide-id>
wafflebase slides slide move <doc-id> <slide-id> 2
wafflebase slides slide delete <doc-id> <slide-id>
```

| Command | What it does |
|---|---|
| `slides layouts <doc-id>` | Lists the layouts this deck's slides can use, each with `id`, `name`, and its placeholders. |
| `slides slide add <doc-id>` | Adds a slide at the end, or at `--index <n>`. `--layout <layout-id>` picks the layout; the default is `blank`. |
| `slides slide duplicate <doc-id> <slide-id>` | Copies the slide and puts the copy right after it. |
| `slides slide move <doc-id> <slide-id> <index>` | Moves the slide to a position. |
| `slides slide delete <doc-id> <slide-id>` | Deletes the slide. You can't delete the last one. |

Each command prints the slide's `id`, its `index`, and the deck's `slideCount`. See [Themes and layouts](/slides/themes-and-layouts) for what each layout looks like.

## Check a deck before you share it

Use `lint` to find slides that look broken, and `render` to look at them.

1. Find problems without opening a browser:

   ```bash
   wafflebase slides lint <doc-id> --format table
   ```

2. Fix the slides the report names, in the editor or with the commands above, and run `lint` again.
3. Render the slides to PNG files and look at them:

   ```bash
   wafflebase slides render <doc-id> --out ./shots
   ```

`lint` prints one row per open finding, with `slide`, `rule`, `severity`, `element`, `text`, and `message`. `render` writes `slide-1.png`, `slide-2.png`, and so on, each 1920 pixels wide, using the editor's own renderer.

### slides lint

```bash
wafflebase slides lint <doc-id>
wafflebase slides lint --file kickoff.pptx --rules overflow,contrast --fail-on warning
```

| Flag | Description | Default |
|---|---|---|
| `--file <path>` | Check a local `.pptx` or deck `.json` file instead of a document | |
| `--slide <n>` | Check one slide | all slides |
| `--rules <list>` | Comma-separated rules: `overflow`, `out-of-bounds`, `overlap`, `contrast`, `min-font`, `edge-margin` | all rules |
| `--allowlist <file>` | JSON array of findings you accept on purpose: `[{ "rule", "slideId", "elementId" or "text", "reason" }]`. Each entry needs a reason. | |
| `--fail-on <severity>` | Exit with code `1` when a finding is at least `error`, `warning`, or `info`. `never` always exits `0`. | `never` |

Findings are advice: a slide can break a rule on purpose. Record those in the allowlist rather than turning a rule off.

### slides layout-report

```bash
wafflebase slides layout-report <doc-id> --slide 3 --format table
```

Prints one row per element as laid out, without rendering: `slide`, `element`, `type`, its box (`x`, `y`, `w`, `h`), the fraction `visible` on the slide, `autofit`, `lines`, `textHeight`, `boxHeight`, `shrink`, and `overflows`. Takes `--file` and `--slide` like `lint`.

### slides render

| Flag | Description | Default |
|---|---|---|
| `--out <dir>` | Folder for the PNG files. Required. | |
| `--slide <n>` | Render one slide | all slides |
| `--frontend <url>` | Web app URL | worked out from `--server`, or `WAFFLEBASE_FRONTEND_URL` |
| `--force` | Overwrite existing PNG files | off |

`render` needs a browser session from `wafflebase login`; an API key can't sign a browser in. It also needs Playwright and Chromium, which the CLI doesn't install. Install them in the folder you run `render` from:

```bash
npm install playwright
npx playwright install chromium
```

Without `--frontend`, an API server on `localhost` maps to `http://localhost:5173`, and an `api.` host maps to the same host without `api.`, so `https://api.example.com` becomes `https://example.com`. For any other server, pass `--frontend https://office.example.com`. The CLI sends your session only to an `https` address or to your own computer.

## Boards

Create a board in the web app; the CLI can't create one. These commands read and change an existing board. Coordinates are canvas pixels.

```bash
wafflebase board elements <doc-id> --kind sticky
wafflebase board add-stickies <doc-id> --text "Faster onboarding" --text "Dark mode" --color yellow
wafflebase board add-section <doc-id> --title "Ideas" --ids <id1>,<id2> --grid
wafflebase board move <doc-id> --data '[{"id": "<id1>", "x": 400, "y": 200}]'
wafflebase board add-text <doc-id> --text "Top theme: onboarding" --near <section-id> --bold
```

### board elements

Lists each element with `id`, `kind`, plain `text`, `color`, `frame`, the innermost `section` it sits in, `stamps`, `votes` from ended votes, and `author`. `--kind` keeps one kind: `sticky`, `section`, `shape`, `freeform`, `text`, `connector`, `image`, or `group`.

### board add-stickies

Adds stickies laid out as a grid in free space, one per `--text` or one per line of `--file`. Prints the new `ids` in input order.

| Flag | Description | Default |
|---|---|---|
| `--text <text>` | Sticky text. Repeat for more stickies. | |
| `--file <path>` | Read texts from a file, one per line. `-` reads standard input. | |
| `--color <color>` | `yellow`, `green`, `blue`, `pink`, `orange`, `purple`, or `#RRGGBB` | |
| `--near <element-id>` | Place the grid beside this element | beside the board's content |
| `--columns <n>` | Columns in the grid | close to square |

### board add-section

Adds a titled section. Prints its `id`, `frame`, its `members`, and the ids the grid `moved`.

| Flag | Description |
|---|---|
| `--title <title>` | Section title |
| `--ids <ids>` | Comma-separated element ids to wrap |
| `--grid` | Lay the `--ids` out as a grid in free space first, then wrap them |
| `--at <x,y>` | Top-left corner, with `--grid` or for an empty section |
| `--columns <n>` | Grid columns, with `--grid` |
| `--frame <x,y,w,h>` | Make the section this size and place instead of wrapping elements |
| `--color <color>` | `gray`, `yellow`, `green`, `blue`, `pink`, or `purple` |

### board move

Moves or resizes elements from a JSON array of `{ "id", "x", "y", "w"?, "h"? }`, read from `--data`, `--file`, or standard input. A section carries the elements inside it, and connectors attached to a moved element follow. Prints `moved` and `carried`. Moving a locked section, or anything in one, fails with `409`.

### board add-text

Adds a text box, for a heading or summary. Newlines start new paragraphs. Prints its `id` and `frame`.

| Flag | Description | Default |
|---|---|---|
| `--text <text>` or `--file <path>` | The text, or a file holding it (`-` for standard input) | |
| `--near <element-id>` | Place it beside this element | beside the board's content |
| `--side <side>` | `right`, `left`, `below`, or `above` the `--near` element | `right` |
| `--x <x>`, `--y <y>` | Top-left corner instead | |
| `--width <w>` | Box width | `400` |
| `--font-size <n>` | Font size | `18` |
| `--bold` | Bold text | off |

### Read or replace a whole board

`board content <doc-id>` prints the board as JSON. `board set-content <doc-id>` writes that JSON back from `--data` or standard input and replaces everything on the board, without asking. Prefer the commands above for edits.

## Related

- [Automation and agents](/developers/cli/automation) to cluster a board's stickies with an agent.
- [Documents and notes](/developers/cli/documents) to copy, move, and delete decks and boards.
- [Files and images](/developers/cli/files-and-images#workspace-images) to upload images for a deck.
- [Boards API](/developers/api/board) for the HTTP endpoints behind the board commands.
- [Slides](/slides/) and [Board](/board/) for working in the editors.
