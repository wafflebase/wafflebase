# Sheet Cell Comments — Lessons

Captured patterns and mistakes during implementation. Update as you go; review
before starting each task.

## Patterns to repeat

- Anchor as discriminated union from day one — keeps the door open to Docs /
  Slides extraction without rewriting Thread logic.
- Pure helpers in `packages/sheets/src/comment/thread.ts` take injected
  `now()` / `newId()` so unit tests are deterministic.

## Mistakes to avoid

(empty — populate as encountered)

## Open questions for phase C

- Mention parsing — at the body level or as a separate `mentions: string[]` on
  Comment? Decide before introducing notifications.
- Per-user unread state — presence-based or persisted per user?
