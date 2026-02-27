# Lessons

- Centralize frontend API error parsing so status overrides and backend message
  extraction stay consistent across modules.
- Keep error helper tests focused on `Response` semantics (status/body/content
  type) to validate behavior without any network or UI dependencies.
- Preserve existing user feedback side-effects (such as toasts) at call sites
  and only centralize response parsing/throwing behavior in shared helpers.
