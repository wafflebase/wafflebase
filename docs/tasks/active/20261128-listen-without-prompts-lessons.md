# Listen Without Prompts — Lessons

Paired with [20261128-listen-without-prompts-todo.md](20261128-listen-without-prompts-todo.md).

## A guard that asks for every command is a bug, not safety

The listen skill told Claude to reply with a heredoc that the guard always
asked about, and the loop's other three commands asked too: four prompts
per chat message. Every rule was individually defensible; together they
made the feature unusable, and no test exercised the loop as a user runs
it. **Rule:** when a skill prescribes exact command forms, test those exact
strings against the guard, and state the prompts per task the user will see.

## The repo path itself trips the guard

Once the plugin is installed in a session that develops this repo,
`cd /…/wafflebase/wafflebase && git …` asks, because `MENTION` cannot tell
a directory from `/usr/local/bin/wafflebase`. The first workaround was to change how commands are typed;
the maintainer's verdict was that the boundary itself was wrong. The guard
now judges calls, not mentions, and asks about the plugin's files only
when a command can change them.

**Rule:** when a safety check prompts on work that is plainly not what it
guards against, narrow what it matches (a call, a write) before asking
people to type around it. Keep the cases that are real (a substitution in
double quotes, a call behind a wrapper) as tests.

## Removing a prompt needs a consent, an end, and a record of what really ran

The first cut removed prompts by recording "listening" when the guard saw
`agent next` proposed. Round 1 showed that anything able to make Claude
*propose* that command — injected document text included — could grant
itself unattended writes, that nothing ended it, and that a heredoc could
smuggle commands past the allow. **Rule:** when a guard stops asking,
(1) one explicit approval must start it, (2) a user action must end it,
(3) record the state from what actually ran (PostToolUse), never from what
was proposed, and (4) only strip shell syntax you can prove is inert.

- Self-review round 1: 8 blocking (2 critical); all fixed by the redesign.
- Self-review round 2: 19 blocking (3 critical). The critical one was
  self-inflicted by the "mentions" change: narrowing plugin protection to a
  list of writer programs. Rule: to narrow a security check, allow-list
  what is provably harmless (readers), never deny-list what is harmful.
- Tooling trap: in a Node `String.replace` replacement string, `$\``
  inserts the text before the match. A regex containing `[$\`]` was
  silently mangled. Use a replacer function, `s.replace(a, () => b)`.
