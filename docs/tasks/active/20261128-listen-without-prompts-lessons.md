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
a directory from `/usr/local/bin/wafflebase`. **Rule:** in this repo, run
commands from the repo root with relative paths, and write files with the
Write tool rather than a heredoc that mentions `wafflebase`.
