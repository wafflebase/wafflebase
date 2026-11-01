# Live document-title sync — Task Tracking

Reported on notes: with two people in the same note, one renaming it does not
update the other's header until a reload (or a window refocus, react-query's
default refetch). Every collaborative type has the same defect.

## Root cause

The title lives only in Postgres (`PATCH /documents/:id`). Each editor reads
it once through `useQuery(["document", id])`, and the renamer invalidates only
its own cache. Nothing tells a peer the row changed — no Yorkie signal, no
server push.

## Approach

Signal the rename over Yorkie **presence**, then let each peer refetch from
Postgres (still the single source of truth).

- The renamer, after the `PATCH` succeeds, sets `presence.titleRev` to a fresh
  value. Presence is ephemeral — not part of the snapshot, revisions, or copies.
- Every peer watches `others` events; a `presence-changed` whose `titleRev`
  differs from the last one seen for that client invalidates
  `["document", id]` and `["documents"]`. A `watched` event (peer joining)
  only records the value: the joiner's rev is stale news to anyone who already
  fetched.

Rejected:

- A title field in the CRDT root: duplicates Postgres (CLI / v1 renames would
  not update it), changes the backend root readers, and the notes root is
  byte-compatible with CodePair ("do NOT add fields").
- `Channel.broadcast`: in SDK 0.7.25 broadcast lives on `Channel`, not
  `Document` — a second attachable per editor plus auth-webhook registration.

Out of scope: share-link pages already re-resolve on an interval
(`SHARE_LINK_REVALIDATE_MS`) and on focus.

## Plan

- [x] Failing test for the title-sync hook (remote rev change → invalidate;
      join / unrelated presence change → no invalidate; announce sets presence)
- [x] `hooks/use-document-title-sync.ts` via `createDocumentSelector` (no
      whole-store subscription in layouts)
- [x] Wire into notes, docs, slides (desktop + mobile), board, sheets layouts
- [x] `pnpm verify:fast`
- [x] Transport check: two real SDK clients against the docker Yorkie server —
      a `titleRev` presence write on A arrives at B as `presence-changed`, with
      A's identity fields intact (partial `set` merges)
- [ ] Manual two-browser smoke in `pnpm dev` (needs OAuth login; not run here)

## Review

- One shared hook (`useDocumentRename`) replaces all six rename handlers
  (sheets, docs, slides desktop + mobile, notes, board), not just notes — every
  type had the same gap.
- The hook reads `doc` through `createDocumentSelector`, so no layout gains a
  whole-store subscription.
- `document-detail-lakehouse-tab.test.tsx` mocks `@yorkie-js/react` and needed
  a `createDocumentSelector` stub.
- Self-review round 1 → the hook now owns the whole rename (PATCH, own-cache
  refresh, then a best-effort announce), so one test covers all six layouts.
