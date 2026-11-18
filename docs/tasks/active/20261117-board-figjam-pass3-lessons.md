# Board FigJam pass 3: lessons

## Seven parallel agents on one engine

Each wave 1 agent worked in its own worktree and was told to keep its
edits to hub files small and additive. That kept most merges mechanical.
The conflicts that took real work were semantic, not textual:

- **One option, three signatures.** Sections, stamps and polish each
  added `hostElementMenuItems`, with different arguments. A key in the
  board's options literal silently overrides the same key spread in from
  `sections.editorOptions`. A type check catches the signature mismatch;
  nothing catches the lost items.
  - **Rule:** when two features want the same host option, unify it into
    one context type and compose the callers explicitly in the host.
  - **Rule:** brief agents with the list of options the others are
    adding, so they can coordinate up front.
- **Tool exclusivity is cross-cutting.** Each feature disarmed the tools
  it knew about, but not each other's: the section tool vs the stamp
  tool, and a sticky drop vs an armed marker.
  - **Rule:** one place should own "one tool armed at a time". Until it
    does, test every pair at integration.
- **Sticky placement saw sections as obstacles.** A sticky dropped inside
  a section was pushed out of it. Two features, each correct alone.

## Process

- The session usage limit stopped six agents mid-work. Resuming them via
  `SendMessage` kept their context and worktrees; nothing was lost. When a
  wave is large, expect that and say so.
- The auto-mode permission classifier refused a subagent's `git merge`.
  The parent must not re-run a denied action on the agent's behalf. Ask
  the user, then start each merge in the parent and let the agent resolve
  it.
- Under parallel load (load average ≈ 60), the pre-commit `verify:fast`
  timed out in unrelated docs, cli, notes and sheets tests. Every flaky
  test passed in isolation and on retry. No `--no-verify` was used.
- `verify:self` caught what `verify:fast` cannot:
  - the frontend chunk-count budget (252 > 244), raised to 257 with the
    reason recorded;
  - the UI-hunter rubric reading an optional `on*` prop as an unwired
    control.

## Self-review log

- Round 1: sticky Tab/Mod+Enter/"+" stepped off sections; backend board
  templates duplicated the sticky/section factories; board copy and template
  use carried stamps, vote ballots and the timer; a board content PUT cleared
  `meta.anonymous`; untrusted group trees were walked with no depth bound;
  no test proved a board move is a granular write → all six fixed, each with
  a regression test (none disputed).
- Round 2:
  - design-fit and security failed on infrastructure (no verdict). Those
    lenses did not run, so round 2 is not clean.
  - Three round-1 findings came back as UNVERIFIED because the verifier
    errored. All three were already fixed, and are disputed with file:line
    evidence in the rebuttals file.
  - One new blast-radius finding: the board's peer follow stayed live
    under a revision preview. Fixed by withholding `onSelectPeer` /
    `getJumpHint` while previewing, and added to the containment test.
- Round 3, the bound:
  - design-fit ran and passed.
  - The three rebuttals were adjudicated in our favour.
  - Five new findings came in: export skipped section paint (hidden
    content leaked), a mislabelled agent test, no test for
    `board-rituals.tsx`, sticky authors kept in copies and templates, and
    O(sections × elements) agent endpoints.
  - All five were judged real and fixed after the loop, without a fourth
    round. The loop is bounded, so a human review of the PR is the next
    gate.

## Environment

- Port 5173 served a *different checkout* (`wafflebase@chore/...`), and
  the first browser smoke would have tested the wrong code.
  - **Rule:** before any browser check, confirm which directory each
    dev-server PID runs from (`lsof -p <pid> | grep cwd`).
  - Run the branch on its own ports (:5180 / :3001 with `FRONTEND_URL`
    and `VITE_BACKEND_API_URL`).
- The Yorkie container runs in memory, so restarting it erases every
  local document. When its port forward wedged, the right move was to ask
  rather than restart it.
