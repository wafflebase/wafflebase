# Slides Group / Ungroup — Lessons

Companion to [20260517-slides-group-todo.md](./20260517-slides-group-todo.md).
Capture anything surprising while implementing the design.

## Lessons captured

(Empty — populate during implementation.)

Suggested categories:

- **Renderer / hit-test recursion gotchas** — places where the per-type
  leaf renderer was double-applying frame transforms and had to be
  pushed up into the new wrapper.
- **PPTX import bbox drift** — fixtures where the flattening vs
  group-preserving paths disagreed beyond the property-test
  tolerance, and the reason.
- **Yorkie convergence quirks** — any scenario where two concurrent
  group / ungroup operations produced an unexpected final state.
- **IME inside grouped text boxes** — overlay-position bugs caused by
  the composed transform.
- **Connector edge cases** — surprises in the "endpoints inside vs
  outside the selection" partition.
