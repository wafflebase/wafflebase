# Clean Up After the Switch to yorkie's Shared Harness Core — Lessons

- A wait loop that greps the process table for a script's name matches
  itself when that name is in its own command line. `pgrep -f` needs a
  pattern that cannot match the loop (`[c]ommit.sh`).
- A pre-commit hook that runs the whole fast suite is a load test on a shared
  machine. Starting it below a load of 8 was not enough: the suite itself
  pushed the load past 15 and vitest timed out. Starting below 6 held.
- "Nothing calls it" needs two greps: callers of the command, and readers of
  what it wrote. The classifier had no caller, but its labels and hidden
  comment could still have had readers; none did.
- An override that matches nothing in the lockfile is not proof it is dead
  for every manifest: root `pnpm.overrides` never reached `scripts/agent`,
  which has its own lockfile. Check the floor there separately.
