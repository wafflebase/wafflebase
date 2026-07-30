# Notes: empty nested bullet turns parent list item into an H2 (#517)

## Problem

In the Notes markdown preview, a list item followed by an *empty* indented
nested bullet renders the parent's text as an `<h2>`:

```
- 1
  -
```

renders as

```html
<ul><li><h2>1</h2></li></ul>
```

Root cause: this is CommonMark's setext-heading ambiguity. The lone `-` on the
indented line is a valid setext-heading *underline* for the paragraph `1`
directly above it, and markdown-it's `lheading` block rule claims it before the
`list` rule ever runs. A blank line between the two lines avoids it (breaks the
setext syntax), which is the reporter's workaround.

Confirmed with markdown-it 14.3.0 (`md.render("- 1\n  -")` → `<h2>1</h2>`).

## Desired behavior

The parent keeps body-text styling and the empty bullet renders as an empty
nested child:

```html
<ul><li>1<ul><li></li></ul></li></ul>
```

Neither strict CommonMark nor simply disabling `lheading` yields this: CommonMark
also forbids an *empty* bullet from interrupting a paragraph (it becomes lazy
`1<br>-` text), so two guards must be relaxed together.

## Plan

Add a small markdown-it plugin `list-empty-bullet-plugin.ts` used by the notes
preview that makes a *lone single dash* behave as an empty bullet rather than a
setext underline:

1. Replace the `lheading` rule with a copy that rejects a setext underline made
   of exactly one `-` (the empty-bullet shape). Multi-dash `---` and `=` setext
   underlines are unchanged.
2. Wrap the `list` rule so that, in paragraph-terminator (silent) mode, an empty
   bullet is allowed to interrupt the paragraph. Non-silent list creation already
   accepts empty items, so the actual nested list forms naturally.

Deliberate deviation from CommonMark, scoped to the notes preview, matching user
expectation. Documented as such.

## Steps

- [x] Reproduce + root-cause (markdown-it lheading + list interrupt guards)
- [ ] Add `packages/notes/src/view/list-empty-bullet-plugin.ts`
- [ ] Wire it into `preview.ts`
- [ ] Unit tests in `preview.test.ts` (bug case, workaround, `---` setext still
      works, non-empty nested list unaffected, top-level lone dash)
- [ ] Note the deviation in `docs/design/notes/notes.md`
- [ ] Draft PR

## Acceptance criteria

- `- 1\n  -` → parent stays body text, empty nested `<li>` (no `<h2>`)
- `- 1\n\n  -` (workaround) still renders correctly
- `Heading\n---` still renders `<h2>` (multi-dash setext preserved)
- `- 1\n  - 2` unchanged (non-empty nested list)
