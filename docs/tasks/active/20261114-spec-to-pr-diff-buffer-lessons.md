# Lessons — stream the self-review diff

- A fixture "origin" made with `git init` is non-bare with `main` checked
  out, so a push to it is refused. Commit in the origin repo directly and
  `fetch` + `rebase` the work tree instead.
