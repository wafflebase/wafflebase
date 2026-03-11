# Lessons

- When frontend API modules are hard to run under the Node test runner due to
  alias/bundler resolution, extract critical logic into pure helpers and test
  those directly.
- Concurrency-sensitive auth flows should have explicit single-flight tests to
  prevent refresh storms and race regressions.
- Keep helper APIs generic (`createSingleFlightRunner`) so the same primitive
  can be reused for other deduplicated fetch paths beyond auth refresh.
