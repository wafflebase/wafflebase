# Pivot Table — Lessons

- **Materialized cells** approach reuses all existing infrastructure (Canvas
  renderer, cell formatting, Yorkie CRDT sync) with zero modification to the
  rendering pipeline.
- **TabMeta.kind subtype** keeps the tab type hierarchy clean: `type` for
  fundamentally different rendering (sheet vs datasource), `kind` for
  variations within the same infrastructure.
- **Store interface extension** pattern (setPivotDefinition/getPivotDefinition)
  follows the same shape as filter and hidden state, making it easy to add new
  per-sheet state in the future.
- **Parallel subagent development** works well for independent calculation
  modules (parse, group, aggregate, materialize) but sequential is safer for
  tightly coupled frontend changes.
- **Cross-sheet data access** for pivot source uses the Yorkie document root
  directly rather than GridResolver, since GridResolver is scoped to formula
  evaluation contexts.
