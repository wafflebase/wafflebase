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
- Round 2: correctness + blast-radius blocked on the same defect — the
  `innerHTML` wipe had been the only reaper for a box whose commit no-ops
  (focus on a keepalive control) before the next edit opens. Fixed in
  `enterEditMode` + test. Minor (peer-cursor layer above the box) fixed by
  inserting the layer below the box. Docs lens blocked on MCP instructions
  injected into its own session, not on the diff — disputed via rebuttal.
- A persistent DOM node loses the implicit cleanup the old wipe gave it:
  every path that drops ownership of one must remove it explicitly.
- Round 3 (last): correctness, design-fit and test-adequacy blocked on the
  same root — `commit()` rode the textarea blur, a no-op from a keepalive
  control, so every `exitEditMode('commit')` caller (Done, click-out,
  setStore, crop) could leave a ghost box. Fixed at the root with a
  focus-independent docs `commit()`, plus a chokepoint guard in
  `exitEditMode`; round 2's per-call-site guard removed. Correctness also
  caught a remote delete of the edited element no longer ending the edit —
  fixed in `markDirty`. Docs lens re-raised the session-injection item
  (no file, so no rebuttal can match it) and flagged the round-2 lessons
  line that recorded it; both concern the reviewer's environment, not the
  change. Bound reached; no round 4.
- Removing an accidental behaviour (here: the wipe→blur→commit that closed
  every edit) also removes whatever it was silently fixing. List those
  side effects before deleting the mechanism.
