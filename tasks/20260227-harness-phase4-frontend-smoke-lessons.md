# Lessons

- Prefer extracting risky data-migration paths into pure modules so they can
  be validated by deterministic tests without browser or backend dependencies.
- Keep frontend smoke tests runnable in the existing Node test runner to avoid
  introducing external tooling dependencies before coverage expands.
- Use `import type` for type-only dependencies in frontend shared modules, so
  Node-based smoke tests do not require runtime resolution of bundler aliases.
