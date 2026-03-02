# Mobile Edit Panel Multiline — Lessons

## Auto-grow textarea

- Set `height: auto` first, then `height: scrollHeight` to shrink
  correctly when lines are deleted. Without the reset step the textarea
  only ever grows.
- Cap at `LineHeight * MaxLines` to prevent the panel from consuming
  the entire screen.

## Enter key behavior

- On mobile, Enter = newline is more natural because the confirm button
  is always visible. Desktop convention (Enter = commit) doesn't
  translate well to touch.
- Removed `enterKeyHint="done"` since Enter no longer commits.

## Layout

- Switched `items-center` → `items-start` so the cell-ref badge and
  action buttons stay top-aligned as the textarea grows.
- Added `mt-0.5` / `mt-1` nudges to vertically align buttons and badge
  with the first line of the textarea.
