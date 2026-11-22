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
