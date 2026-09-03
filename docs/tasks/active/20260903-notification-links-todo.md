# Notification click-through links

## Problem

The notification dropdown has exactly one link mapper, and it switches on
whether a document is attached rather than on the notification type
(`packages/frontend/src/components/notifications/notification-text.ts:54`):

```ts
export function notificationHref(n: Notification): string | null {
  if (!n.document) return null;
  return getDocumentPath({ id: n.document.id, type: n.document.type });
}
```

Two types are wrong under that rule.

1. **`workspace_member_joined` names no workspace and goes nowhere.** The row
   stores `workspaceId` (`notification.service.ts:167`) but `LIST_SELECT`
   (`:24-35`) deliberately drops it — "things the caller already knows or has
   no use for". That premise was wrong: for a workspace-level notification the
   caller knows neither *which* workspace joined nor how to reach it. With
   `documentId` null too, the mapper returns null, so the row marks itself read
   and does nothing. A user in several workspaces cannot tell them apart.

2. **`template_review_queued` links somewhere its recipient cannot go.** It is
   addressed to the reviewer allowlist, and a reviewer "belongs to neither the
   publisher's workspace nor the document" (backend README). The mapper still
   sends them to `/s/:documentId`. The service comment that justifies the
   notification (`:277-284`) names `/admin/templates` as the page nobody
   remembers to open — which is exactly where the click does not go.

The remaining types are correct: the comment three and the four
publisher-facing template ones all address someone with access to the
document, and the document is what they want.

## Plan

- [x] Backend: add `workspace: { select: { id, name } }` to `LIST_SELECT`, and
      correct the comment that says `workspaceId` has no use
- [x] Frontend API type: `workspace: { id: string; name: string } | null`
- [x] Sentence: `${actor} joined ${workspaceName}`, falling back to
      `the workspace` when the relation is missing
- [x] `notificationHref`: switch on type first
      - `workspace_member_joined` → `/w/:workspaceId/settings`
      - `template_review_queued` → `/admin/templates`
      - everything else → the document path as today
- [x] Update `notification-text.test.ts` (it currently asserts a join is null)
      and add cases for both corrected destinations
- [x] Backend service spec: assert the workspace relation is selected
- [x] `pnpm verify:fast`

## Decisions

**Why `/w/:workspaceId/settings` and not a members page** — there is no
members route; the member list is a section of the settings page
(`workspace-settings.tsx:298`). Both recipient classes (workspace owners and
the invite's creator) are members, so `fetchWorkspace` is authorized for them.

**Why the mapper switches on type** — the destination is a property of what
happened, not of what rows the notification happens to carry. `template_review_queued`
carries a document and must not use it; `workspace_member_joined` carries none
and still has a destination.

## Not in scope

**Comment notifications do not anchor to their thread.** `threadId` /
`commentId` reach the client and are unused: clicking a mention opens the
document at the top. Fixing it needs a `?thread=` deep link the editors do not
implement (comment state is view-local — `docs-view.tsx:664`). Separate issue.

**`template_needs_review` keeps opening its document.** Raised in review: the
publisher's listing state lives on the workspace templates page, not on the
document. But the document is what *changed* and what caused the listing to
leave the gallery, so opening it is defensible; changing it is a product call,
not a correctness fix.

## Review

Implemented as planned; no deviations.

`notificationHref` is now a `switch (n.type)` whose two special cases return
early and whose `default` keeps the previous document behaviour — so a type
added later still degrades to "open the document" rather than to nothing. The
workspace href is guarded on `n.workspace` being present: an older backend, or
a workspace deleted since the row was written, gives a dead row rather than a
link to `/w/undefined/settings`.

`docs/design/notifications.md` gained a "Where a click goes" subsection under
the frontend section, since the previous text asserted the old rule ("Item
click routes by document type") as the whole story.

### Review round

A reviewer pass over the branch diff returned two Important findings, both
applied:

- **The `LIST_SELECT` justification was factually wrong.** It claimed "a
  notification only ever addresses a member", which this very diff disproves:
  `template_review_queued` addresses the global reviewer allowlist, who are
  members of nothing, and now receives the publishing workspace's name. The
  disclosure is small next to the document title that row already carries and
  the preview token that lets a reviewer open the document — but a comment
  future readers will check the *next* field against must not be wrong. Now
  states the exception and points at that recipient.
- **Five ESLint errors in the new spec block.** `.mock.calls[0][0]` on a bare
  `jest.fn()` is `any`, tripping `no-unsafe-*`. Typed the calls array instead.
  Worth noting that nothing would have caught this: backend ESLint is in
  neither `verify:fast` nor CI.

Three Minor findings applied too: the stale "navigates if it points at a
document" docstring on `NotificationList`, an untested default arm (an unknown
type now asserts `/s/doc-1`), and the design doc's test inventory.

Verification: `pnpm verify:fast` green (exit 0), plus `eslint` clean on the two
backend files. New coverage —
`notification-text.test.ts` (join sentence names the workspace, falls back
without one, join links to settings, a workspace-less join links nowhere,
a queued review links to `/admin/templates` and *not* to its document, a
publisher-facing decision still links to its document), a `LIST_SELECT`
assertion in `notification.service.spec.ts` that also re-asserts `dedupeKey` /
`recipientId` stay server-side, and the workspace relation in the
`notification.e2e-spec.ts` join case.
