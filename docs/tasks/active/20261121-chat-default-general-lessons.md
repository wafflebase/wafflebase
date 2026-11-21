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
- Round 1 (correctness/tests): blocked by design-fit + blast-radius on the
  same defect — `UserService.claimGithubWorkspaces` adds an owner without
  joining #general. Fixed (join in the claim transaction + pg_notify), test
  added. Lesson: grep every `workspaceMember.(create|upsert|createMany)` when
  an invariant is "every member is in X", not just the paths you remember.
- Round 2 (design fit / blast radius, panel + superpowers-style code review):
  panel clean on cddf7e93b — loop stops. The parallel code review raised
  non-blocking items, fixed in a follow-up: picker said "only one here"
  while members loaded (now a loading state), invite link offered to
  non-owners who cannot invite (now "ask an owner"), Browse opened on Create
  for one frame (dialog tab now owned by the page, effect removed), members
  route answered for DMs (now 400), and a duplicated pg_notify helper
  (`announceMembershipRaw` in chat-bus). Deferred to the PR body: rolling
  deploy window (an old pod creating a workspace/accepting an invite after
  the backfill leaves it without #general; the backfill SQL is re-runnable),
  and the Add-people "Already here" list not refreshing on others' joins.
- Default params hide `undefined`: a test helper `inviteHref = "/x"` turned
  an explicit `undefined` back into the default. Use an explicit flag.
- `/code-review` (high, after round 2): 9 findings. Fixed — picker showed
  "you're alone" on a failed load (now an error + retry), self-heal for a
  missing default / a member an old pod left out (`ensureDefaultChannel` on
  list; replaces the rolling-deploy known limitation), Add people pickable
  before channel members load, e2e wait loop keyed on any NOTIFY (now the
  exact payload), members() listing rows that outlived workspace
  membership, duplicated workspace-members query (`useWorkspaceMembersQuery`),
  a DateTimeFormat per gutter line. Rejected — badge ignoring unmentioned
  private-channel traffic: that is the rule the user chose (mentions + DMs).
  Accepted — gutter time across noon reads without AM/PM, as in Slack; the
  title tooltip has the full time.
