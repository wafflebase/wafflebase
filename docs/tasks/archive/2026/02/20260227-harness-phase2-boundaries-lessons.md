# Lessons

- Enforce architecture with dedicated lint profiles first, so boundary checks
  can become mandatory even when general lint debt still exists.
- Scope boundary rules per directory role (api, hooks, ui, database, auth)
  and validate against current imports before making the checks required.
- Use `verify:architecture` as a stable gate and compose it into
  `verify:fast`, so CI and local workflows cannot skip boundary checks.
