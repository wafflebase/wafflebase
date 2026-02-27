# Lessons

- Keep lint output actionable by resolving noisy recurring warnings; this makes
  new warnings meaningful during agent-driven iteration.
- For react-refresh rules, allowlist intentional non-component exports instead
  of disabling the rule globally.
- Prefer fixing hook dependency warnings with stable derivations (`useMemo`)
  instead of suppressing the rule, so effect intent stays explicit and safe.
