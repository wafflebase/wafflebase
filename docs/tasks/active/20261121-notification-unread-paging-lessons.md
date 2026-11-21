# Notification unread paging — lessons

- A control whose job is to clear a global count must key on that count, not
  on the slice of rows currently loaded. Any paged view of "unread" can hold
  zero unread rows while the total is non-zero.
- The local Postgres is shared with the other clone's dev/test runs and was
  wiped twice mid-check. A "0 unread" read *after* such a wipe proves nothing:
  seed and assert in one step, and re-check the seed exists.
- Global prettier config is single-quote; this repo has none. Format with
  `prettier --no-config` (or not at all), then check `git diff --stat` for
  files you never meant to touch.
