# Lessons — demo daily reset

## Self-review log

- Round 1 — blocked: security (label-only restore target is spoofable, since
  `CreateRevision` is ungated and the demos are editor links), docs (todo list
  understated finished work). Fixed both: targets are pinned by revision id;
  label is only used to log setup candidates. Todo updated.

## Lessons

- A selector over user-writable data ("newest revision with label X") is an
  authorization decision. Before choosing one, ask who else can write the
  thing being selected; here the README already said `CreateRevision` is
  ungated.
- Docker Desktop's host port forwarding can hang while the container is up
  (curl to :8080 timed out). `docker compose restart yorkie` fixed it.
