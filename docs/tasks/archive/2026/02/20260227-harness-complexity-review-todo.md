# TODO

- [x] Define review scope for harness phase 1 through 16 complexity
- [x] Map phase 1 through 16 to concrete commits and changed surfaces
- [x] Execute current harness lanes to validate present behavior
- [x] Review phase 17 through 19 plan scope for projected complexity risks
- [x] Document findings, residual risks, and recommended next actions
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Phase mapping (1..16) validated against `design/harness-engineering.md`:
  - 1: `348bbee`
  - 2: `9fa31f7`
  - 3: `7b28106`
  - 4: `f4ae1ab`
  - 5: `82f275b`
  - 6: `fe18849`
  - 7: `11e765c`
  - 8: `9a93f45`
  - 9: `faa13f4`
  - 10: `159c552`
  - 11: `e3ad562`
  - 12: `7b3a83c`
  - 13: `a5bf120`
  - 14: `c8b348e`
  - 15: `6a51edb`
  - 16: `edc3a28`
- Complexity trend assessment:
  - Phases 1..10 are mostly low-to-medium complexity, incremental, and
    cohesive per commit.
  - Phases 11..16 raise complexity due to build output control, policy loading,
    local docker orchestration, and visual baseline management.
  - The sequence remains understandable because each phase keeps scope narrow
    and verification evidence is recorded.
- Verification executed during this review:
  - `pnpm verify:self` (pass)
  - `pnpm verify:integration:local` (pass; expected skip without DB)
  - `pnpm verify:integration:docker` (pass; migrate + backend e2e)
- Primary risks identified:
  - Phase 16 visual gate is deterministic markup regression (SSR HTML diff),
    not rendered pixel regression. It protects structure/class drift, but not
    CSS rendering-only regressions.
  - Phase 14 docker wrapper currently cleans up only on normal exit paths;
    interruption handling (for example SIGINT) is not hardened.
- Phase 17..19 forward-looking complexity:
  - 17 (integration determinism hardening): medium-high complexity
  - 18 (machine-readable lane reports): medium complexity
  - 19 (PR evidence trust automation): high cross-system complexity
  - Recommended implementation order is 17 -> 18 -> 19 as already proposed.
- Follow-up update:
  - Reflected P2/P3 review viewpoints directly in
    `design/harness-engineering.md` by clarifying visual gate scope (SSR markup
    baseline) and documenting docker interruption cleanup as pending hardening
    work under phase 17.
- Follow-up update (wording/placement):
  - Replaced `Known Limits` framing with actionable next-work framing in
    `design/harness-engineering.md` so the same items are tracked as upcoming
    implementation tasks.
