# Chat usability pass — lessons

## Parallel agents in one checkout

- Three agents with disjoint file ownership in the same working tree
  worked: no merge step, and the two cross-boundary edits (a prop line in
  `chat-page.tsx`, a hook in `use-chat.ts`) were small and reported.
- **An agent ran the backend e2e suite against the local dev database**
  (`DATABASE_URL` from `packages/backend/.env`), whose `clearDatabase`
  emptied it. Rule: any agent brief that may run backend e2e must name a
  scratch database (`createdb wafflebase_<agent>` + `prisma migrate deploy`)
  and forbid the default `DATABASE_URL`.
- A spec check is not a page check: the reviewer, not the implementer,
  caught that the Browse "Open" on an archived channel led to a page that
  still offered Join. Review the surface a new entry point lands on.

## Self-review

- Round 0 (workflow reviewers, one per item): 2 blocking — archived
  non-member preview offered Join (409); jump pill focused the composer on
  pointer clicks in Chrome (raises the soft keyboard on Android). Fixed with
  failing tests first. Nits taken: divider ref instead of a global id,
  members dialog refetches on a failed remove, dialog closes on channel
  change, duplicate "Archived" accessible name.
- Round 1 (panel): 2 blocking — security: private-channel removal reused canManage, letting any member evict the creator and owners → new stricter `canRemove` (creator/owner; owners only by owners) with per-row `canRemove` on GET members; test-adequacy: no e2e for the route → added, run on a scratch DB (58/58).
