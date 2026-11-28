# Chat UI Polish — Todo

The thread composer's "Also send to #general" checkbox wrapped onto two
lines, and a pass over the chat surfaces (Chat page, thread, the editor's
320px chat panel, phone width) turned up four more layout defects.

## Items

- [x] Composer footer: the keyboard hint yields to the footer below a 448px
      composer (`@container/composer`), so "Also send to #…" stays on one
      line; a long channel name truncates.
- [x] Thread root: its hover toolbar was clipped by the scroller's top edge;
      `pt-1` on the root list keeps it inside.
- [x] Edit box: "Enter to save · Esc to cancel" hides below a 320px box
      instead of wrapping beside Save / Cancel.
- [x] Composer autofocus puts the caret at the end of a restored draft
      (typing used to land in front of it).
- [x] Channel header: the "Files" label hides by the header's width, not
      the viewport's, so an open thread on a laptop no longer squeezes the
      channel name down to a bare `#`.
- [x] Verify in the browser: Chat page with thread (1103px), editor chat
      panel thread (320px), mobile-layout thread at 720px, edit box.
- [x] Chat tests (51 files / 528 tests), eslint, impeccable detector.

## Out of scope

- Three fixed panes (sidebar 256 + channel list 260 + thread 360) leave the
  conversation ~220px on a ~1100px screen. Collapsing the channel list while
  a thread is open is a layout decision for its own change.
- A thread deep link focuses the channel composer, not the thread's.

## Review
