# Lessons

- Keep CI integration checks strict, but provide a local wrapper that degrades
  gracefully when required services are unavailable.
- Reachability checks should print clear host/port guidance so contributors can
  quickly resolve missing dependency setup.
- Local wrappers that intentionally skip should exit `0` and emit explicit
  "skipped" wording, so callers can distinguish it from silent pass/failure.
