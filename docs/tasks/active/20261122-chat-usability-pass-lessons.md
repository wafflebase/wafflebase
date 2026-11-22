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
- Round 2 (panel, all six lenses): no blocking findings — loop stops. Design-fit second opinion via requesting-code-review run alongside.
- Design-fit second opinion (round 2): no blockers, but the count-back divider trusted a guessed `unreadCount` (wrong after arrivals in an open-but-scrolled channel, or a delete). Replaced with `(lastReadSeq, lastSeq]` from the summary — deletes `settled`/catch-up gating. Lesson: placing a marker from a *count* is fragile when the count is client-maintained; carry the server's position instead. `lastReadSeq` alone was not enough: live arrivals would grow a divider, hence `lastSeq` too.
- e2e gotcha: `channels.list` heals a workspace with no default channel by adopting one named "general", which joins everyone — use `summaryOf` for membership assertions in tests that name a channel general.
- Round 3 (panel, after the lastSeq rework): 1 blocking — blast-radius: `ChannelSummary` gained `lastSeq`/`lastReadSeq` but 8 test fixtures typed as it were not updated; vitest does not typecheck and `tsconfig.app.json` excludes tests, so no lane caught it. Fixed, confirmed with a temporary tsconfig over src+chat tests (0 chat errors, was 20+). Bound reached; no round 4.
- Lesson: after widening a shared type, typecheck the *tests* too — `tsc -p` a temp config that includes them, placed inside the package so type roots resolve.
