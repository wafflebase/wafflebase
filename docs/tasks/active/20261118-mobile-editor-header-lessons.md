# Lessons: mobile editor header

- Measure before claiming overflow: the sync chip is already icon-only below
  `sm` and hidden in the `saved` state, so the "chip pushes Share off-screen"
  risk from the first audit was overstated.
- Adding a hook to a widely rendered component (`useIsMobile` in
  `SiteHeader`) breaks every jsdom test that renders it without a
  `matchMedia` — mock the hook beside the header's other mocks. And read the
  gate's own exit status: the first `verify:fast` was misread as green from
  the tail of a background log.
