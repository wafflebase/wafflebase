# Lessons

- Keep task archival deterministic (unchecked todo stays active, completed todo
  archives) so automation does not require manual triage.
- When generating markdown link indexes, compute links relative to each output
  file's directory (`tasks/README.md` vs `tasks/archive/README.md`) to avoid
  broken paths.
