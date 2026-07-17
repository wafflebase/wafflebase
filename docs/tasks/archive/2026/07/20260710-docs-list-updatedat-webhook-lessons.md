# Lessons — Documents list `updatedAt` via Yorkie event webhook

## Debug root cause with the live system, not just the code

The two API samples the user pasted were byte-identical and stable — which
looked like it *disproved* a per-request `updatedAt` flip. Reading the code
alone couldn't resolve it. `kubectl logs` on the backend pod showed the
`getSummaries` 800ms timeout firing ~every 5s poll, and a `port-forward` +
timed `curl` proved the gateway RTT was ~25ms — so the slowness was the
authenticated presence query straddling the 800ms cut, exactly the flip.
The identical samples were just two "timeout → fallback" polls. **Measure the
running system before committing to a mechanism.**

## Don't propose a store you can't fill

The first fix idea ("persist `updatedAt` in Postgres") was hollow until the
user pushed: edits live only in Yorkie, so Postgres had no signal to write.
The real design work was *how the value gets there* — the webhook — not the
column. Verify the data flow feeding a field before proposing the field.

## Verify the external contract from source, not memory

Yorkie's event-webhook contract (event name `DocumentRootChanged`, payload
shape, `X-Signature-256` = `sha256=hex(HMAC-SHA256(rawBody, project.SecretKey))`,
at-least-once + throttled delivery) was read from the pinned `v0.7.12` tag via
`gh api`, not guessed. The signing key being the *project secret key* is what
let us reuse the existing `YORKIE_SECRET_KEY` with no new secret.

## Implementation notes

- HMAC must run over the **raw request bytes** — captured via
  `bodyParser.json({ verify })`, not a re-serialized `@Body()` object.
- Webhook receivers must be **idempotent + monotonic** (advance-only
  `updateMany where updatedAt < at`) because delivery is at-least-once and
  unordered; and **200-swallow** unrecognized input so the sender won't retry.
- Prisma `@updatedAt` is the wrong tool when the app isn't on the write path —
  use a plain `DateTime` column set explicitly.
