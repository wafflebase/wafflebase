# Chat UI critique fixes — lessons

- **Parallel agents need file ownership and named seams.** Three agents
  edited the chat UI at once without conflict because each owned a disjoint
  file set, and every cross-file contract was named up front: the composer's
  `onArrowUpWhenEmpty` prop, the `useMentionAutocomplete` API for the edit
  box, and the `data-thread-link` hook the page uses to return focus after
  Esc. The one seam left implicit (finding the replies button by its text)
  was the one that needed a fix-up.
- **`role="log"` is a live region.** Putting it on a scroller that loads
  history makes a screen reader read whole pages; announce arrivals from a
  separate sr-only region instead.
- **Decide the failure owner once.** Optimistic send could recover in the
  composer (restore text on throw) or on the row (Retry). Doing both doubles
  the recovery path; the row owns it and `onSend` resolves.
- **A one-off vitest failure under parallel load did not reproduce** in nine
  reruns; rerun before chasing it.

## Self-review rounds

(logged below)
- Round 1 (correctness/tests): blocked on 4. Fixed: Retry/Discard now
  asserted to call `retry`/`discard` with the client id; `chat-shortcuts`
  gained its own tests; the composer's restore-on-throw path was dead under
  the resolve-only `onSend` contract, so it was deleted rather than tested;
  Layout and the Chat page both wrote `document.title` and Layout's effect
  (parent, runs after child) overwrote the page on mount — route titles
  moved to `route-titles.ts` with `null` meaning "the page owns it".
- Round 2 (design fit + `requesting-code-review`): panel blocked on 4,
  reviewer flagged 1 important + minors. Fixed: posts are queued per channel
  (the composer clears at once, so quick sends raced); unanswered sends are
  mirrored to `sessionStorage` (`pending-store.ts`) since the cleared draft
  was the only copy of a failed message's text; an empty channel draws its
  pending/failed first send instead of the empty state; same-origin links
  route in-app only for app paths (`/docs`, API and images load normally);
  a failed row whose message the server took is hidden like a pending one;
  arrivals and the waiting count got separate live regions; one send path
  (`usePostMessage` removed). Disputed: "restore-to-draft path untested" —
  that path was deleted in round 1 (rebuttal with grep evidence). Deferred:
  sharing `modalSurfaceOpen` with board's identical selector; focus dropping
  when a focused pending row swaps for the server row.
- **Clearing input optimistically moves durability, not just UX.** The
  draft was the only persisted copy of unsent text; clearing it on send
  made the pending row the copy, so that row had to become persistent too.
- Round 3 (security/docs — the bound): rebuttal upheld (overturned the
  finding). Five new findings, all from round 2's changes, all fixed without
  a fourth panel round: failed rows are no longer twin-hidden (text matching
  could claim a later same-text message's row and hide an undelivered one —
  reverting the round-2 reviewer suggestion); the pending store is keyed by
  user so a sign-out/sign-in in one tab neither shows nor re-sends the last
  user's text; the send queue waits at most 15 s on a hung post; channel
  keys stand down while a message edit is open. Loop stopped at the bound;
  the PR asks a human to look at the optimistic-send path first.
- **A fix suggested by one reviewer can be the next round's critical.**
  Hiding failed twins (round 2) traded a rare duplicate for a silent loss.
  When a "fix" changes what the user can lose, weigh the failure modes
  instead of applying it because it was asked for.
