---
name: deck-critic
description: Judge a rendered deck as an independent design critic — app PNGs, the PPTX render and the talk brief in, structured findings out, checked by `slides critique-check`
safety: read-only
tools:
  - wafflebase slides render
  - wafflebase slides export
  - wafflebase slides lint
  - wafflebase slides critique-check
---

# Critique a Rendered Deck (the design-critic lane)

The critic step of [deck-author.md](deck-author.md)'s loop. A deck can pass
`slides lint` and still read badly: an empty bottom half, card padding that
differs between two cards, a line break inside "(58 / 174)", a plain cover,
a bright code panel on a dark theme. A linter cannot see those. A second
pair of eyes that only sees the result can.

The critic is **a separate agent, in its own context**, that has not seen
the author's plan or reasoning. It judges what was rendered, against what
the talk is for, and writes findings in a fixed JSON shape that the CLI
checks. The orchestration (who runs the critic, how many rounds) lives in
`deck-author.md`. The rubric lives here, in the repository next to the
lint rules, so a change to either is reviewed and versioned together.

## Safety

| Step | Safety | Notes |
|------|--------|-------|
| `slides render`, `slides export` | read-only on the server, **write local files** | Run by the orchestrator to produce the critic's inputs (see deck-author.md for their requirements) |
| `slides lint --file deck.pptx` | read-only | Reads the exported PPTX back through the importer; no network |
| `slides critique-check` | read-only | Reads local JSON only. No network, no model |

## Inputs: rendered output and intent, nothing else

The orchestrator hands the critic a folder:

```
critique/round-N/
  brief.md             # the talk's intent: audience, length, the one thing to remember
  sources/             # the same source materials the author had (for faithfulness)
  slide-ids.json       # ["<id of slide 1>", "<id of slide 2>", ...]
  app/slide-1.png …    # wafflebase's own renderer
  pptx/slide-1.png …   # the exported .pptx, rendered by a PPTX reader
  previous.json        # optional: last round's findings
```

How each piece is made:

```bash
# App render (the editor's own renderer, 1920 wide)
wafflebase slides render <doc-id> --out critique/round-N/app --force

# PPTX render: export, then render with a PPTX reader. LibreOffice is the
# headless one available; anything that opens .pptx works.
wafflebase slides export <doc-id> critique/round-N/deck.pptx --force
soffice --headless --convert-to pdf --outdir critique/round-N critique/round-N/deck.pptx
pdftoppm -png -r 96 critique/round-N/deck.pdf critique/round-N/pptx/slide

# Slide ids, so findings name slides the author can find
wafflebase slides content <doc-id> --format json | jq '[.slides[].id]' > critique/round-N/slide-ids.json
```

(`pdftoppm` numbers pages `slide-1.png` or `slide-01.png` depending on the
page count; match them by order.) The PPTX render is the surface a person
opening the downloaded file sees; it is not a stand-in for the app render.
Judge a PPTX-only difference as a **file** problem (bold lost, a run split
across lines, a shape missing) and not as a reader quirk (a substituted font
with slightly different metrics), unless the substitution breaks the slide.
`wafflebase slides lint --file deck.pptx` is a cheap extra signal: it lints
the exported file as re-imported. When no PPTX reader is available, say so
in a deck-wide finding rather than skipping the parity check silently.

**What the critic must not get:** the author's outline, reasoning, chat
history or deck JSON. A critic that knows why a slide looks the way it does
starts agreeing with it. The brief is the talk's intent written for an
audience, not the author's plan for the slides.

## The rubric

Every finding names one category. Judge each slide, then the deck as a
whole (rhythm, curation, consistency).

| category | ask |
| --- | --- |
| `hierarchy` | Is there one obvious first thing to read? Title > key point > support, by size, weight and position. |
| `density` | Can the slide be taken in in the time it is on screen? Walls of text, 19 names on one slide, and also the opposite: half a slide left empty for no reason. |
| `alignment-spacing` | Shared edges line up; gaps repeat; padding is the same inside cards of the same kind; nothing sits 4 px off a guide. |
| `type-scale` | A small, consistent set of sizes. No line breaks in the wrong place: inside a number pair like "(58 / 174)", a widow word, a heading wrapping onto one stray word. |
| `contrast` | Readable, and not harsh: lint checks the WCAG floor; the critic checks what lint passes, such as a bright white code panel on a dark theme. |
| `visual-variety` | Slide-to-slide rhythm. Eight card or table slides in a row is a finding even if each is fine on its own. A cover that is a title on a plain background is a finding. |
| `faithfulness` | Every number, name and claim is in `sources/`. Nothing invented, nothing materially dropped, nothing reworded into a different claim. |
| `curation` | Judged against the **brief**, not the outline: should this slide be cut, merged with a neighbour, or split? A duplicated slide; a point that needs its own slide and is buried in a list; one that does not serve the talk. |
| `skill-rules` | The rules in [slides-author.md](slides-author.md): one layout per idea, decoration from the template, 3–5 parallel bullets, bracketed hints for the user's values, no fabricated data. |
| `pptx-parity` | The PPTX render matches the app render: formatting (bold, colour), line breaks, sizes, shapes and images all survive export. |

On curation, read the brief first and ask what the audience should leave
with. The literal outline is the author's guess at that; the critic may
disagree with it. In the #1112 dogfood the agent fit 19 people onto 4 dense
slides because the outline listed 19 people; a human picked 8 and gave each
a slide, because the talk was about those people.

## Severity

Two levels. When unsure, ask: would a careful presenter stop the talk to
fix this?

**major** — a viewer notices it, or the deck says something it should not.
Fix before anything else.

- a broken line wrap that splits a word, a number or a name
- text overflowing its card or the slide
- a duplicated slide, or two slides that say the same thing
- a long run of same-shaped slides (8 card/table slides in a row)
- formatting that is lost in the PPTX (bold gone, a heading wrapped)
- a number or claim not in the sources
- a curation miss against the brief (19 people crammed onto 4 slides)

**minor** — the deck works, but a designer would fix it.

- an empty bottom half on a slide that could use the space, or a smaller
  layout
- inconsistent card padding or gaps
- a line break inside "(58 / 174)" that still reads
- a plain cover where the theme offers a stronger one
- a dark-theme code panel that is brighter than it needs to be

For scale: the #1112 dogfood's round 1 had 7 major findings (broken line
wraps, card overflow, a duplicated slide, 8 card/table slides in a row,
bold lost in PPTX); round 2 had 0 major and 13 minor. Three of the findings
were visible only in the PPTX render.

## Output

Write one JSON file per round. `slideId` is the slide's id from
`slide-ids.json`, or `"deck"` for a finding about the deck as a whole.

```json
{
  "round": 1,
  "findings": [
    {
      "slideId": "s7",
      "severity": "major",
      "category": "type-scale",
      "problem": "The subtitle wraps inside \"(58 / 174)\": \"(58 /\" ends line 1.",
      "fix": "Keep the pair together: shorten the subtitle or widen the box by ~120 px."
    },
    {
      "slideId": "deck",
      "severity": "major",
      "category": "visual-variety",
      "problem": "Slides 4–11 are all card grids or tables.",
      "fix": "Turn slide 6 into a main-point statement and slide 9 into a big-number slide."
    }
  ]
}
```

Fields are exactly `slideId`, `severity` (`major` | `minor`), `category`
(one of the ten above), `problem` (what is wrong, as seen) and `fix` (what
to change). Unknown keys are rejected. A bare array of findings is also
accepted. One finding per problem: three slides with the same padding issue
are three findings, so the count reflects the work left.

Then check it:

```bash
wafflebase slides critique-check --file round-2.json --previous round-1.json
```

It validates the file (every problem listed, exit 1 on any), counts findings
by severity and category, and prints the verdict for the loop:

| reason | verdict | when |
| --- | --- | --- |
| `max-rounds` | stop | `round >= --max-rounds` (default 3); `escalate: true` if majors remain — hand the deck to a human with the open findings |
| `major-open` | continue | any major finding |
| `clean` | stop | no findings |
| `polish-round` | continue | no majors, some minors, and the previous round had majors (or there is none) |
| `minor-decreasing` | continue | no majors, fewer minors than the previous round |
| `minor-plateau` | stop | no majors, minors flat or rising: the critic is now trading taste, not fixing defects |

`round` comes from `--round`, else the file's `round`, else the previous
file's round + 1, else 1. The command never calls a model; it only reads
JSON.

## Calibration: when to trust the critic

A critic's verdict is a judgement, and it can drift. Before relying on it
for a new kind of deck (or after changing this rubric), check it against
human A/B labels — the procedure is in
`docs/design/slides/deck-critic.md` (§ Calibration). In short: show a human
two renders of the same slide, blind to which one the critic preferred,
record which is better; agreement below the bar there means the critic's
findings are advice, not a gate.

## Checklist

- [ ] The critic ran in its own context, with only renders, `brief.md`, `sources/` and slide ids.
- [ ] Both renders were judged: app PNGs and the PPTX render (or a deck-wide finding says why not).
- [ ] Curation was judged against the brief, not the outline.
- [ ] Every finding has `slideId`, `severity`, `category`, `problem`, `fix`; `critique-check` accepted the file.
- [ ] The loop followed `critique-check`'s verdict.
