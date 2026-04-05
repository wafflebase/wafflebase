# Docs Frontend Integration

**Spec:** `docs/design/docs/docs-frontend-integration.md`

**Goal:** Add document type support so users can create and open docs from the document list UI.

---

## Phase 1: Backend

- [x] Task 1: Add `type` field to Prisma Document model + migration
- [x] Task 2: Update DocumentService and DocumentController to accept `type`
- [x] Task 3: Update REST API v1 documents controller

## Phase 2: Frontend

- [x] Task 4: Update frontend Document type and API layer
- [x] Task 5: Update document-list UI (dropdown, type column, routing)

## Phase 3: Verification

- [x] Task 6: Run `pnpm verify:fast` and manual smoke test
  - Lint: pass
  - Backend tests: 107 passed
  - Frontend test failure: pre-existing `yorkie-doc-store.test.ts` SDK issue (Tree re-export), not related to this change
