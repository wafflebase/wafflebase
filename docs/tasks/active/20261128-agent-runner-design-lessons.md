# Agent Runner Design — Lessons

Paired with [20261128-agent-runner-design-todo.md](20261128-agent-runner-design-todo.md).

## A credential policy has two questions, not one

The first pass called the member-run runner "free of policy risk" because
Wafflebase never stores the token. That answered *who holds the credential*
and skipped *whose usage it bills*: a team-mentionable bot backed by one
person's Pro/Max token routes the whole team through an individual plan,
which the terms' "ordinary, individual usage" sentence rules out.

**Rule:** when judging a credential design against vendor terms, answer both
"who stores or intermediates it" and "on whose behalf is it spent" before
calling it safe. Here that produced `botInvokers` (owner-only for a
subscription token).

## Check "the API can do X" before designing on it

The first draft had the agent snapshot a revision before its first write.
Neither the CLI nor `/api/v1` exposes revisions — claude-plugin.md lists it
as future work. **Rule:** every capability a design leans on gets a grep of
the CLI commands and `/api/v1` controllers before it goes in the doc.
