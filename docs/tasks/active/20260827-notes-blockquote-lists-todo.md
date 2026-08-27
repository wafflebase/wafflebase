# Notes list commands inside blockquotes (issue #754 remainder)

PR #925 landed most of issue #754 but was linked as `Refs`, not `Fixes`: two
of its acceptance criteria still fail on a line inside a blockquote, plus two
smaller items found while auditing it.

## Problem

`LIST_RE` in `packages/notes/src/view/list-commands.ts` admits no `>` prefix,
so `> - [ ] a` parses as a plain paragraph whose "content" is the whole line,
`> ` included. Consequences today:

- a blockquoted task renders an **enabled** preview checkbox whose click does
  nothing — `setTaskChecked` bails on `check === null`, so the box visibly
  snaps back on the next render;
- the toolbar shows nothing pressed for a quoted list, and Bullet / Numbered /
  Checkbox / Indent / Outdent are no-ops there (#925 added a `quoted` bail-out
  so they at least stop corrupting the line into `- > - x`).

## Plan

1. **Carry the quote prefix through the parser.** Add `quote: string` to
   `ParsedLine` (replacing the `quoted: boolean` bail-out flag): strip a
   leading `(\s*>\s?)+` run, parse the remainder with `LIST_RE`, and have
   `prefixOf` re-emit `quote + indent + marker + gap + box`. Every existing
   command then works on the quoted line unchanged, because `indent` is now
   measured *inside* the quote.
2. **`toggleKind`'s off-path preserves the quote** — return `p.quote` instead
   of `''`, so unlisting a quoted item leaves it quoted rather than pulling it
   out of the blockquote.
3. **Quote floor for indent/outdent.** `indentStep` / `outdentStep` key on
   `indent.length`, which is now post-quote, so outdenting stops at the quote
   prefix instead of eating it. `itemAbove` / `parentOf` must additionally
   stop when the neighbouring line's quote prefix differs — a different quote
   depth is a different container, not a parent.
4. **Drop `replacePrefixes`' `quoted` skip** and the `ParsedLine.quoted`
   comment that documents the limitation.
5. **Bare `[ ]` inside a quote.** `BARE_BOX_RE` in `checkbox-input.ts` gets the
   same quote prefix, so the issue's first criterion (`[ ]` + space becomes a
   checkbox) holds inside a blockquote too.
6. **Accessible name on preview checkboxes.** Give each rendered task checkbox
   an `aria-label` from its own item text (not `markdown-it-task-lists`'
   `label: true`, whose `<label>` wrapper forwards a click on the item text to
   the checkbox inside it — the same tick reported twice against the
   click-anywhere handler `onTaskClick` already provides). Applies to
   read-only mounts too, which is where it matters most.
7. **Documentation pass** over `packages/documentation/notes/writing-a-note.md`:
   the toolbar table lists only B / I / S / Link / Table and is stale for
   Undo/Redo, Quote, Code block, Foldout, Image and now the five list buttons;
   the preview section should mention click-to-toggle checkboxes.

## Acceptance criteria (from the issue + review comment)

- [ ] `[ ]` / `[x]` at line start becomes a checkbox — including after `> `
- [ ] Clicking anywhere on a preview task item toggles it — including a
      blockquoted one
- [ ] Bullet / Numbered / Checkbox toggles, Indent / Outdent, all multi-line —
      including on blockquoted lines, with correct pressed/disabled state
- [ ] Outdenting a quoted item never strips its `> `
- [ ] Preview checkboxes have an accessible name
- [ ] `writing-a-note.md` documents the whole toolbar

## Non-goals

Nested/mixed quote depths within one selection beyond "same prefix = same
list"; lazy continuation lines; rewriting the quote prefix itself (the Quote
button owns that).
