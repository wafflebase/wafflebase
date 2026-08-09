# Lessons — workspace settings owner gating (issue #733)

## What we learned

- The page already had the right primitive (`isOwner`); the bug was that
  sections added later (Members, Invites) never applied it. When a page
  grows section by section, the permission predicate has to be applied at
  each new section, not just defined once.
- "Hide every control the backend rejects" is not quite the rule. Check
  the backend guard per action: `WorkspaceService.removeMember` skips
  `assertOwner` when requester == target, so the member row's own trash
  icon is a working "leave workspace" action. Hiding it wholesale behind
  `isOwner` would have removed working functionality while fixing a
  cosmetic one.
- The Invites *list* endpoint is owner-gated too, so for a non-owner the
  whole section was dead weight (a 403'd query rendering "No active
  invites"). Gating the section — rather than just its buttons — also
  drops a request that could only ever fail.

## Follow-ups

- None. The backend authorization was already correct; this was purely a
  UI-affordance fix.
