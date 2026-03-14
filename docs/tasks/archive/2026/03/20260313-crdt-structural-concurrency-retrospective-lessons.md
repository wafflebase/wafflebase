# CRDT Structural Concurrency Retrospective — Lessons

## Keep Authority and Projection Separate

- When introducing a new collaborative data model, explicitly name the
  authoritative state and every derived projection. Mixed authority creates
  long-lived duplication and hidden consistency work.

## Migrate New Writes Immediately

- Once a new canonical shape exists, create new documents in that shape on day
  one. Lazy migration helpers are useful for old data, but they should not be
  on the hot path for newly created documents.

## Share Types Across Runtime Boundaries

- If the frontend and backend both read the same persisted document, keep the
  document types in one shared module. Model drift hides simplification
  opportunities and weakens refactors.
