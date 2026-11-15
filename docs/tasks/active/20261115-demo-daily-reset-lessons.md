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
- Round 2 — blocked: test-adequacy (no assertion that `withDocument` hands
  the callback its client), blast-radius (sheet/doc/slides stores ignore
  Yorkie `snapshot` events). Fixed the first with a spec. Disputed the second
  in `20261115-demo-daily-reset-rebuttals.json`: measured on local Yorkie, a
  server restore reaches an up-to-date client as `remote-change` (also after
  600 changes); the `snapshot` gap is pre-existing and deferred. Also applied
  two non-blocking findings from the independent design-fit review: no timer
  re-arm after shutdown, README marks the tokens as credentials.
- Round 3 (bound) — blocked: test-adequacy (token redaction untested; fixed,
  mutation-checked), security (setup candidate list still filters on the
  attacker-writable label, 5 slots can be crowded), blast-radius (the
  `snapshot` finding re-raised despite the rebuttal; plus the owner spreadsheet
  editor does not re-pick a tab removed remotely). The last three are left for
  a human decision; loop stopped at the bound.
