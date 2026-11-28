# Lessons — board text edit focus

- jsdom does not fire `blur` when a focused element is removed; Chrome does.
  A jsdom test of "focus survives a DOM rebuild" sees `activeElement` fall
  to `<body>` but misses the real symptom (the blur commits and closes the
  edit). Assert the root cause — the node is never detached — not only the
  focus.
- Re-appending a node after a rebuild does not undo a detach: the blur (and
  any IME composition loss) already happened. Persistent DOM must never
  leave the tree, so reorder the chrome around it instead of moving it.
- A collaborator can be simulated from Node with `@yorkie-js/sdk` attached
  to `board-<id>`; synthetic pointer events in a background tab do not
  drive the board editor.

## Self-review

- Round 1: blast-radius blocked — the persistent mark lived in
  `mountSlidesTextBox`, so an injected `mountTextBox` would lose its
  container on every repaint. Fixed: the editor marks (and, if needed,
  mounts) `tb.container` right after any `mountTextBox`;
  `text-box-editor.ts` is back to `main`.
