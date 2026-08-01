# Board Miro Import (SP3) — Lessons

Companion to `20260801-board-miro-import-todo.md`. Design:
`docs/design/board/board-miro-import.md`.

## Context

SP3 of the board infinite canvas: import a Miro board into a new `"board"`
document via the Miro REST v2 API. A one-shot pasted access token is used
backend-only and never stored; a pure mapper in `@wafflebase/board` turns the
Miro JSON into `ElementInit[]`; persistence reuses `applyImportedContent`.

## Lessons

### Verify a third-party API's shape before designing against it

The first draft of the spec assumed `GET /boards/{id}/items` returned
connectors. It does not — connectors live on a **separate** paginated endpoint
(`/v2/boards/{id}/connectors`), and `connector` is not even a valid `type`
filter on `/items`. Had this reached implementation, every imported board would
have silently lost its arrows, and the loss would have looked like a mapper bug
rather than a missing fetch. Two other facts only surfaced from the same check:
image URLs require the bearer token and **expire in ~60 seconds** (so the
re-host must happen inside the same request), and sticky colors are **named**
(`light_yellow`) while shape colors are **hex**. Research the API before the
design hardens, not while debugging.

_(Remaining lessons to be filled in during/after implementation.)_

## Verification notes

_(Filled in during/after implementation — test counts, verify:self lanes,
manual smoke against a real Miro board.)_
