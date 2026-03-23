# PR #72 Review Fixes

Address unresolved CodeRabbit review comments on PR #72 (docs-frontend-integration).

## Tasks

- [x] 1. resolve-hooks.mjs — add missing docs exports to virtual stub (Major)
- [x] 2. ruler.ts — update corner background on theme change (Minor)
- [x] 3. editor.ts — getSelectionStyle empty object toggle issue (Minor) — skipped: block-not-found is near-impossible, and applyStyle is also no-op in that case
- [x] 4. yorkie-doc-store — check `as any` cast in initialDocsRoot (Critical) — already fixed in runtime code (docs-detail.tsx), comment was on stale task doc snippet
- [x] 5. docs-frontend-integration.md — update stale wording (Minor)
- [x] 6. docs-frontend-integration.md — add language identifiers to code blocks (Minor)
