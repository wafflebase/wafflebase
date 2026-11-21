# Lessons: chat default #general

- The chat e2e helper defaults `DATABASE_URL` to the dev database and
  `clearDatabase` truncates it. Run e2e against a throwaway database
  (`CREATE DATABASE wafflebase_chat_test` + `prisma migrate deploy`) when other
  checkouts' dev servers share the Postgres container.
- "One per workspace" without a Prisma-unrepresentable partial index: reuse
  the `dmKey` idiom — a nullable unique column holding the scope id.
- A redirect that reads a remembered id must re-check the condition that made
  it valid (membership), not just existence: a left public channel stays in
  the list, so "exists and not archived" sent the user straight back.
- Unit specs that mock Prisma need the new `tx.chatChannel.*` methods whenever
  a creation path gains a write; `expect.objectContaining` trips
  `no-unsafe-assignment` — assert the exact object instead.

## Self-review log

(rounds recorded below)
