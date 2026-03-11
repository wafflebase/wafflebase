# TODO

- [x] Define phase-9 scope for frontend lint signal cleanup
- [x] Fix shared-document hook dependency warning with stable tab derivation
- [x] Tune react-refresh lint rule for intentional non-component exports
- [x] Run frontend lint/test and self verification
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Fixed `shared-document.tsx` dependency warning by memoizing tab derivation
  (`useMemo`) from the Yorkie root before the selection-sync effect.
- Tuned `react-refresh/only-export-components` allowlist for intentional
  non-component exports used by this codebase:
  - `ThemeProviderContext`, `useTheme`
  - `badgeVariants`, `buttonVariants`, `toggleVariants`
  - `useSidebar`
- Result: removed recurring frontend lint warnings, improving signal quality for
  future regressions.
- Verification:
  - `pnpm frontend lint` passed with no warnings
  - `pnpm frontend test` passed (20 tests)
  - `pnpm verify:self` passed
