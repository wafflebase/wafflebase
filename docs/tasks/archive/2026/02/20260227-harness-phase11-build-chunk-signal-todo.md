# TODO

- [x] Define phase-11 scope for frontend build chunk warning reduction
- [x] Add Vite manual chunk strategy for large dependency groups
- [x] Run frontend build and self verification to compare chunk warnings
- [x] Document phase-11 review and lessons
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added `build.rollupOptions.output.manualChunks` in
  `packages/frontend/vite.config.ts` to split major dependency groups:
  `vendor-react`, `vendor-ui`, `vendor-app`, `vendor-yorkie`,
  `sheet-core`, and `sheet-formula`.
- Before change, `pnpm frontend build` emitted chunk-size warnings with
  `index-*.js` at `637.98 kB` and `use-mobile-sheet-gestures-*.js` at
  `653.96 kB`.
- After change, the largest frontend chunk became
  `sheet-formula-*.js` at `465.73 kB`, and chunk-size warnings no longer
  appeared.
- Verification:
  - `pnpm frontend build` (pass)
  - `pnpm verify:self` (pass)
