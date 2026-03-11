# TODO

- [x] Define phase-13 scope for frontend chunk count guardrail
- [x] Extend frontend chunk verification script with chunk count limit
- [x] Document new guardrail behavior and defaults
- [x] Run verification commands for the updated chunk gate
- [x] Document phase-13 review and lessons
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Extended `scripts/verify-frontend-chunks.mjs` with
  `FRONTEND_CHUNK_COUNT_LIMIT` support and a default count limit of `60`.
- Kept the existing per-chunk size budget gate (`500 kB` default) and now
  enforce both guardrails in one script.
- Updated root and frontend README docs with the new default limits and
  override environment variables.
- Verification:
  - `pnpm verify:self` (pass; includes updated chunk size/count gate)
