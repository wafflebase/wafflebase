# Lessons — fail fast on 4xx queries

- `isAuthExpiredError` narrows `error` to `never`: `AuthExpiredError` adds
  nothing structurally to `Error`. Widen to `unknown` before a second
  `instanceof` check.
