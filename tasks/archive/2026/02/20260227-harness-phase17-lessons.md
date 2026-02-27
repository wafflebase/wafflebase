# Lessons

- **Factory pattern for test user creation**: Using `createUserFactory(prisma, prefix)`
  with a closure-based counter is cleaner than module-level `let userSeq`. The prefix
  parameter prevents email collisions across test files that share the same DB.
- **Fake timers for exact time assertions**: `jest.useFakeTimers()` +
  `jest.setSystemTime()` eliminates wall-clock race conditions entirely. Always pair
  with `jest.useRealTimers()` in `afterEach` to prevent leaking into other tests.
- **Pin infrastructure versions to match CI**: `postgres:latest` in local dev vs
  `postgres:16` in CI is a hidden flake source. Both should use the same version.
- **UUID/auto-increment ordering is not a flake source here**: Tests never assert on
  specific UUID values or integer IDs — they always use returned values. No fix needed.
- **deleteMany vs TRUNCATE RESTART IDENTITY**: Since no test depends on auto-increment
  sequence values, `deleteMany()` is sufficient. TRUNCATE would add complexity for no
  determinism benefit.
