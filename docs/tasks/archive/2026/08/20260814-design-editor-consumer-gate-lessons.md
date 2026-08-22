# Lessons — consumer gate (PR 9c/gate, #849)

## The fixture has to be a stranger, not a smaller us

`fixtures/consumer` has its own `app/` layout, its own `@` alias and plain CSS custom
properties — no wafflebase package, no `TokenAdapter` of its own. That is what makes it able
to fail: a fixture shaped like our repo would pass whatever our repo happens to do.

## A gate nobody has broken is a guess

Re-checked while archiving this task: renaming one `--color-*` alias in the fixture stylesheet
takes the gate from 54/54 to 53/54, naming the alias list it no longer matches. Doing that once
is what separates "the gate passes" from "the gate would notice".
