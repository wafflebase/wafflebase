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

## A setup example is a design decision

The first draft's runner example was `export WAFFLEBASE_API_KEY=<bot key>`.
The CLI resolves an env key ahead of the login session, so on a laptop that
one line turns the member's own Claude Code sessions into the bot. The
journey critique caught it; the design review did not, because nobody read
the example as a step a user would really take.

**Rule:** for every credential a design asks a user to place, trace where it
lands and what else on that machine reads it (resolve order, hooks,
profiles) before writing the example.

## Two design docs describing one thing will drift

agent-runner.md replaced the bot key handover with pairing, but chat.md §
Bot Members — the doc an implementer of phase 1 reads first — still said
"shown once, like any key". The second critique caught it.

**Rule:** when a new design supersedes part of an older one, edit the older
doc in the same commit to defer to the new section, rather than only adding
a cross-link in the new one.
