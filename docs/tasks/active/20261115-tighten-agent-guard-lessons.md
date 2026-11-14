# Tighten the Agent Workflow Guard — Lessons

- An allow-list of command names is half an allow-list. `git`, `cut` and `gh`
  were each allowed for one use and accepted with any argument; an allowed
  command needs its arguments listed too, down to whether a word may come from
  a variable.
- Text that was never read is text that was never checked. Assignments,
  `env:` values and a step's `if:` were skipped by the reader, and each one
  changes what a checked command does without changing the command.
- A lexer that is honest about what it cannot read still needs a list of what
  the shell reads differently: `$'…'`, `${x@P}`, an array subscript, a `#`
  inside `$( … )`. Each was checked against bash 5.2 before being refused or
  allowed.
- Pre-processing can open holes the reader never sees. Dropping YAML comment
  lines also dropped `#` lines inside `run:` blocks, which can close a quote;
  matching `uses:` at any indentation let a line of a script turn the step
  into an action. Read structure at the level it lives at.
- A deny-list of words in JavaScript loses to string concatenation. A small
  tokenizer with an allow-list of calls, and a refusal for anything it cannot
  place, is less code than chasing spellings.
- Mutation cases belong in the suite, named for the rule that must catch them:
  a mutation harness outside the repository proves the guard once, a named
  case keeps proving it.
