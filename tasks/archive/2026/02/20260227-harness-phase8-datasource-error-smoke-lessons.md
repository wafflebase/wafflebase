# Lessons

- Once a shared API error helper exists, complete adoption module-by-module to
  avoid partial behavior drift between endpoints.
- Prefer helper-based parsing for query/connection failures so backend-provided
  messages are surfaced consistently to callers.
- Treat datasource query endpoints as first-class API clients and keep them on
  the same error contract as document/share-link endpoints.
