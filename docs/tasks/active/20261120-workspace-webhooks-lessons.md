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
