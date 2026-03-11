# Lessons

- **Bridge pattern works well**: Exposing `window.__WB_INTERACTION__` from the
  harness page lets the Playwright script drive interactions without fragile DOM
  selectors. This pattern should be reused for future interaction scenarios.
- **Separate harness routes per concern**: `/harness/visual` and
  `/harness/interaction` keep visual and interaction tests independent. Each
  harness page owns its own test bridge and scenarios.
- **Wheel scroll testing needs careful coordinate setup**: Scroll tests require
  dispatching wheel events at specific canvas coordinates. The harness bridge
  must expose scroll position state for assertion.
- **Desktop+mobile profile matrix**: Visual baselines already cover two
  viewport profiles. Interaction tests currently run desktop-only — mobile
  interaction coverage can be added as a follow-up if needed.
