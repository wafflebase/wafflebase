# Lessons: mobile editor header

- Measure before claiming overflow: the sync chip is already icon-only below
  `sm` and hidden in the `saved` state, so the "chip pushes Share off-screen"
  risk from the first audit was overstated.
- Adding a hook to a widely rendered component (`useIsMobile` in
  `SiteHeader`) breaks every jsdom test that renders it without a
  `matchMedia` — mock the hook beside the header's other mocks. And read the
  gate's own exit status: the first `verify:fast` was misread as green from
  the tail of a background log.

## Self-review

- Round 1 (correctness / test adequacy) — blocked on 3: the phone export lost
  its in-flight guard when the More menu unmounted (I had filed it as a known
  limit; it was a real duplicate-export bug), and the export / Slideshow
  menu and compact forms had no tests. Fixed: the busy flag lives in
  `SiteHeader` (`HeaderBusyContext`, More trigger spins while busy); new
  `site-header-phone-slots.test.tsx`, its guard case proven to fail without
  the fix.
- Reverting a file to prove a test fails: back it up and restore from the
  backup — `git checkout` restores HEAD and silently drops uncommitted work.
- Round 2 (design fit + `superpowers:requesting-code-review`) — panel
  blocked on 1: no test that the busy flag clears after an export settles.
  Fixed with a test. The independent reviewer found no blockers; took its
  minors: Export rows grouped under a labelled `DropdownMenuGroup` (screen
  readers heard a bare "PDF (.pdf)"), no shortcut hint in the phone menu, a
  separator after the primary's rows (never doubled), `HeaderPanelToggle`
  on `HEADER_CONTROL_SIZE`, a Docs menu test. Deferred: the `primary`
  slot's placement contract is a doc comment, not enforced (one primary
  today).
- Round 3 (security / docs) — clean: all six lenses passed. Loop stopped.
