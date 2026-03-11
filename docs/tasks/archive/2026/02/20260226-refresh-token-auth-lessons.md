# Lessons

- Start every auth/session change by checking both backend token TTL and frontend 401 handling, because either side alone can create forced logout loops.
- For cookie-based refresh flows, always make refresh failure clear both auth cookies server-side to prevent repeated invalid refresh attempts.
- In frontend auth wrappers, serialize refresh requests with a shared in-flight promise so concurrent 401s do not fan out into parallel refresh storms.
- Before committing, validate the final commit message with `git show --no-patch --pretty=%B HEAD` to ensure no literal `\n` sequences are present.
- For multi-paragraph commit bodies, never use escaped `\n` inside normal quoted `-m` values; use multiple `-m` flags (one paragraph each) or `$'...'`.
- Validate commit-body wrapping with `awk` before finalizing:
  `git show --no-patch --pretty=%B HEAD | awk 'length($0)>80{print}'`.
