# Fail fast on 4xx queries

React Query's default retries every failure three times with backoff, so a
403 / 404 on the documents list (or anywhere) sat on a skeleton for ~7s
before the error screen — four requests for an answer the server already
gave. Found while polishing the documents list (#1134).

- [x] `lib/query-retry.ts`: app-wide default `retry` — no retry for 4xx
      (except 408 / 429) or an expired session, up to 3 otherwise; tests.
- [x] Wire it as the `QueryClient` default in `App.tsx`. Queries with their
      own `retry: false` / predicate are unaffected.
- [x] Documents page error: access-aware copy for 403 / 404, and a
      Try again button for the transient case instead of "try again later".

## Review

Measured in the dev app with the documents request stubbed: 403 → error
screen after 1 request (was 4); 500 → still 4 requests (~10s), as intended.
