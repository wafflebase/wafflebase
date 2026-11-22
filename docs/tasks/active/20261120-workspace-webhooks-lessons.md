# Workspace webhooks — Lessons

## Design phase

- **Check a "first consumer" claim against the consumer's contract.** The
  first draft named Slack incoming webhooks as a natural first target; they
  accept only `{"text"}`/`blocks` and reject a generic envelope with 400.
  Before naming a destination in a design, check what body it accepts.
- **"Shown once" only buys security when the secret is hashed.** API keys
  are hashed, so shown-once is forced. A signing secret must be decryptable
  to sign, so hiding it after creation only costs users a rotation.
- **Verify UI-placement claims against the actual screen.** The draft
  placed webhooks "in a tab beside API keys"; Workspace Settings has no
  tabs, it is one scrolling page of sections.
- **A gate on activation blocks the build-the-receiver-later flow.**
  Requiring a 2xx test before a webhook goes active stops people who
  register first and build second; warn instead and let failure handling
  (log, auto-disable) do its job.
- **Re-check visibility assumptions when a new content type lands.** The
  first draft rested on "an owner can read everything in a workspace"; chat
  (#1186) broke it, since an owner may not read a private channel or DM. The
  emit-time visibility filter has to be one function, not a per-emitter
  assumption.
- **Enumerate every write path, not the obvious one.** `member.joined` was
  sourced from `acceptInvite` only; sign-up, workspace create and the GitHub
  workspace claim also create memberships.
- **Walk each use case through to what the receiver does next.** Listing
  events was not enough. Following "the agent writes back" exposed a
  feedback loop, and "add the joiner to a directory" exposed that member
  events have nothing to fetch from. Both were invisible from the event
  catalog alone.

## Build phase (parallel lanes → integration)

- **A lane that adds a constructor dependency owns the module import, or
  says so loudly.** The events lane injected `WebhookEventService` into
  services whose modules it did not own. Three would have failed Nest's DI at
  boot; two used `@Optional()` and would have shipped emitting nothing with
  every unit test green. Unit specs build services by hand and never see
  module wiring: boot the real `AppModule` once before calling it done.
- **`@Optional()` on a production dependency hides a wiring bug.** It is
  tempting for hand-built test instances; prefer passing a stub in the test
  over making the app path silently degrade.
- **Contract the boundaries, not just the shapes.** Lanes agreed on the
  `deliverNow` signature but not its semantics (reset the attempt count, or
  give one more try?), and on `disable` but not what happens to queued rows.
  Write the state transition into the contract, not only the types.
- **Fail-closed config needs a fail-loud path.** The feature was "on" with no
  encryption key, and the first symptom was a 500 on create. Check the
  dependency at boot and answer with the setting's name.
- **Run the docs snippet against the real code.** The verification snippet
  was executed against `signWebhook`, including two-secret rotation and a
  tampered body; VitePress also fails the whole build on a `{{ … }}` in
  inline code (Vue interpolation), which only a build catches.
- **Shared dev services belong to someone else.** Another checkout's Compose
  stack held 5432/8080 and its Yorkie was unreachable; a scratch database on
  the shared Postgres plus a throwaway Yorkie on another port ran every e2e
  suite without touching either.

## Review round 1 (correctness + security-design lenses)

Seven blocking findings; all seven were real on reading the code. Fixed:

1. **Claim starvation** (`webhook-delivery.worker.ts`). The claim scanned the
   500 oldest due rows, then dropped rows of saturated or capped webhooks, so
   one webhook's backlog stopped delivery deployment-wide. Now a `LATERAL`
   per-webhook pick runs after those webhooks are excluded, with a
   `(webhookId, status, nextAttemptAt)` index. New e2e test (busy webhook
   saturated, then capped; idle webhook still served) fails on the old query.
2. **Disable without warning** (`webhook-retry.ts`). `streakDecision` disabled
   any 72 h-old streak, warned or not, and the 12 h span check was implied by
   the 72 h. Disable now needs a warning ≥24 h old (unwarned → warn), and a
   failure >24 h after the previous attempt starts a new streak
   (`STREAK_BREAK_MS`). `MIN_FAILURE_SPAN_MS` removed.
3. **Queued `webhook.test` retried / disabled** (`deliver()`). Tests are now
   one shot wherever sent from: no retry, no streak, no disable on 410; and
   recovery never re-queues them. *Partly rebutted:* "redeliver gives exactly
   one more attempt" already held for rows whose schedule was spent; a row a
   disable stopped early resumes its remaining schedule, which is what
   recovering it would do. Faking `attempts = MAX-1` would make the log lie,
   so the design text was corrected instead.
4. **`creator_removed` left rows pending** (`workspace.service.ts`). One
   helper, `stopQueuedDeliveries`, now serves all four disable paths. Also
   fixed in passing: a row in flight when its webhook was disabled was put
   back `pending` (claim race, expired lease) or rescheduled (mid-send); all
   three now end `failed`.
5. **Bulk trash/move past the 5 s transaction timeout**. Added
   `WebhookEventBatch` (hooks/folders/actor read once, one `createMany`, one
   notify per workspace); bulk trash is one `updateManyAndReturn`; bulk move
   reads its before-rows in one query and sizes its timeout. e2e: 1,000
   documents moved and trashed with webhooks on.
6. **Default "recover since" recovered nothing**. Chose model (b): every
   disable records `Webhook.recoverFrom` (oldest stopped row's `createdAt`),
   the UI default sends it, tests are excluded. e2e covers disable → enable.
7. **Cross-workspace move leaked the other side's folder and links**. Each
   half now describes only its own workspace (source: `to_folder: null`,
   `folder: null`, title before, no links).

Lessons:

- **A filter applied after a LIMIT is a starvation bug.** Any "scan N, then
  exclude" query lets the excluded rows fill the scan. Exclude first.
- **A pure decision function needs the invariant it relies on stated as a
  test.** `streakDecision`'s docstring promised "a stale failure never
  disables" with nothing enforcing it; the test that would have caught it
  ("stale streak, then one failure") is the scenario, not the arithmetic.
- **One state transition, one helper.** Three disable paths agreed on
  "fail pending rows" and the fourth (in another module) forgot. Shared
  semantics belong in a shared function, not in three comments.
- **Default UI choices are the feature.** The recover default was tested only
  as "maps to `disabledAt`" — never against the rows it was meant to find.
- **Per-item work inside an interactive transaction needs a size budget.**
  The feature-off path was one statement; the feature-on path was O(n)
  round trips with a fixed 5 s ceiling. Test bulk paths at realistic N with
  the feature on.
- **Fan-out to two audiences means two payloads.** Building one `extra` and
  sending it to both workspaces of a move is the same mistake as one
  visibility rule per emitter.
