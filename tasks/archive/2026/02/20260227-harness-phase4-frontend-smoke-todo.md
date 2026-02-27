# TODO

- [x] Define phase-4 scope for self-contained frontend smoke coverage
- [x] Extract high-risk frontend document migration logic into a pure helper
- [x] Add smoke tests for migration scenarios (legacy, already-migrated, invalid)
- [x] Ensure frontend test command includes new smoke tests
- [x] Run frontend and self verification commands
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Extracted legacy-root migration logic from `document-detail.tsx` into
  `migration.ts` with two pure functions:
  - `shouldMigrateLegacyDocument(root)`
  - `buildLegacySpreadsheetDocument(root)`
- Kept runtime behavior intact in `migrateDocument()` by reusing helper output
  and preserving old-key cleanup after migration.
- Added frontend smoke tests for migration paths:
  - legacy shape detection
  - successful migration with data preservation
  - missing-field defaults
  - non-legacy/no-sheet null handling
- Updated frontend test script to include all `src/**/*.test.ts`, so new smoke
  tests are automatically included in normal verification.
- Converted worksheet type import to `import type` to keep runtime module load
  minimal and test-friendly.
- Verification:
  - `pnpm frontend test` passed (11 tests)
  - `pnpm verify:self` passed
