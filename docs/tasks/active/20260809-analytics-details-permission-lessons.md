# Lessons — Analytics "Details" link 403s for non-manager members (#732)

## Notes

- The workspace analytics endpoint is member-gated while the per-document
  one is manager-gated. Whenever a list endpoint links into a
  narrower-gated detail endpoint, the list payload has to carry the
  detail endpoint's predicate — otherwise the UI can only discover the
  answer by failing. `isDocumentManager` already exists as the single
  source of that predicate, so the list just annotates with it (the same
  pattern `GET /documents` uses for `canManage`).

## Follow-ups

- (fill in during review)
