# Docs Phase 2: Lessons Learned

## HTML Paste: Block Semantics

- **Problem:** Initial `parseHtmlToInlines` flattened all HTML into inline runs,
  losing block-level semantics (headings, list items, etc.) and `<br>` separators.
- **Fix:** Rewrote as `parseHtmlToBlocks` returning `Block[]` with proper
  `type`, `headingLevel`, and `listKind` from HTML tags.
- **Lesson:** When parsing external formats, preserve structural semantics from
  the start. Flattening and re-inferring is lossy and error-prone.

## HTML Paste: Trailing Newline Phantom Block

- **Problem:** Block-level HTML tags emit trailing `\n` separators, causing an
  extra empty paragraph at the end of pasted content.
- **Fix:** Guard the final `blocks.push()` with `current.length > 0 || blocks.length === 0`.
- **Lesson:** Any "flush remaining" pattern at the end of a splitting loop
  needs a guard to avoid emitting empty items from trailing delimiters.

## Font Size Units

- **Problem:** CSS `fontSize` was only parsed for `px`, but the document model
  uses points. Also dropped `pt` values entirely.
- **Fix:** Accept both `px` and `pt`, convert px→pt via `(px * 72) / 96`.
- **Lesson:** Always check unit semantics when bridging between external formats
  (CSS) and internal models.

## URL Auto-Detection: Trailing Punctuation

- **Problem:** `detectUrlBeforeCursor` treated the entire whitespace-delimited
  token as the URL, including trailing `.`, `)`, `,` etc.
- **Fix:** Strip trailing punctuation characters from the detected URL.
- **Lesson:** URL boundary detection in natural text must handle sentence-ending
  punctuation explicitly.

## Horizontal-Rule Blocks

- **Problem:** `insertPlainText` and `insertBlocks` assumed the cursor is on a
  text block. When cursor is on a horizontal-rule, `insertText` and
  `splitBlock` can throw or corrupt the block.
- **Fix:** Added `ensureEditableBlock()` guard that splits HR blocks to create
  a new paragraph before insertion.
- **Lesson:** Non-text block types need guards at all text-mutation entry points.

## Editor Prop Reactivity

- **Problem:** `editorRef.current` assignment after `initialize()` didn't
  trigger a re-render, so `DocsLinkPopover`'s `useEffect([editor])` missed
  the editor on first mount.
- **Fix:** Added `mountedEditor` state alongside the ref, passed state to JSX.
- **Lesson:** React refs don't trigger re-renders. Components that subscribe
  to a value in `useEffect` must receive it via state or context, not a ref.

## Store Layer: False Positives

- **Problem:** CodeRabbit flagged `FindReplaceState` as bypassing the store.
- **Reality:** `Doc.deleteText`/`insertText` already route through `DocStore`.
- **Lesson:** Verify automated review findings against actual code paths before
  implementing changes. The mutation chain may be indirect but still correct.
