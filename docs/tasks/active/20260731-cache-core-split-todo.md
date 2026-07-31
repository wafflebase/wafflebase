# Keep the review panel's prompt cache working at one sample per lens

#607 cut the code-quality lenses to `samples: 1` and #610 did the same for
`security`, which halved detection cost — and, as an unnoticed side effect, took
most of #594's prompt-cache saving with it. Every lens now runs a single sample.

Prompt caching needs **byte-identical** prefixes. At two samples a lens shared a
prefix with *itself*, so every lens cached regardless of what any other lens read.
At one sample that is gone and **cross-lens sharing is the only caching left** —
which excludes precisely the lenses with the largest slices:

| Lens | Why it fell out of the shared group |
| --- | --- |
| `security` | reads `design-spec` + `prose` on top of the core, so its slice is unique on any PR carrying a design doc or a task file |
| `design-fit` | `needsIssueSpec` appended the issue to its prefix, making it unique on **every** PR, code-only ones included |
| `docs` | prose-only; shares with nobody either way (correctly) |

Measured with `cache-report.mjs` on #591's diff (code + policy + design-spec +
prose), against the manifest as shipped today: **23.4% projected input saving,
30.1% cache-hit** — down from 29.4% / 40.5% when `security` still ran two samples,
with 3 of 6 lenses paying full price for their whole slice.

## The change

- [x] `cacheCoreClasses(lenses)` — the file classes every code-reviewing lens has
      in common, derived from the manifest (today `code`, `code-adjacent`,
      `policy`). Not hardcoded, so it tracks lens edits, and it fails safe: a lens
      that drops a class shrinks the core, and it can never grow to include a class
      some code lens does not read.
- [x] `splitLensDiff(lens, fileBlocks, coreClasses)` → `{ core, extra }`. `core` is
      computed without reference to the lens, which is exactly why every
      participating lens gets identical bytes and lands in one warm-up group.
- [x] `lensCacheKey({ diff, scopeNote })` no longer takes a lens at all. The
      `needsIssueSpec` branch — the one thing that could put a lens-specific byte in
      the shared prefix — is gone; the issue spec moved to the user prompt.
- [x] `buildLensPrompt` gained `extraDiff` + `issue`, framed as DATA, with
      `LENS_CLOSING_INSTRUCTION` still **last**.
- [x] `countPrefixSessions` and `cache-report.mjs`'s `planSessions` group on the
      core, so the pre-pass, the round loop and the projection all agree.
- [x] Design-doc paragraph (`harness-engineering.md`) — #594 shipped code-only, so
      the caching model was undocumented; this fills that gap and records the split.

## Result

Same diff, same shipped manifest: **50.4% projected saving, 60.2% cache-hit** —
five lenses on one warm-up instead of three, and `security` and `design-fit` back
inside it. 436/436 agent tests green (was 430).

## Why the remainder is not cached

`security`'s extra hunks are read by `security` alone. A cache write costs `~1.25×`
and only that one session could ever read it back, so caching the remainder would
be a loss, not a saving. Full price in the user prompt is the cheapest those bytes
can be — and it is what they already cost before this change.

## Why not nest the slices instead

The obvious alternative is to let `security` (which reads everything) warm the
cache and have the narrower lenses read a prefix of it. Two problems:

1. **Subset ≠ prefix.** The API matches a cacheable prefix as a *leading byte run*.
   `correctness`'s slice is a subset of `security`'s by file class but diverges from
   it at byte 3,578 of 32,194 on #591's diff, because git emits files alphabetically
   and security's `docs/` blocks sit between correctness's policy and code blocks.
   Reordering by class would fix this part.
2. **One breakpoint.** A cache entry is only readable at the position it was
   written. The SDK exposes a single `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, so a lens
   sending `[CORE][EXTRA]` creates one entry for the whole run, and a lens asking
   for `CORE` finds nothing. Nesting needs multiple breakpoints.

And it would buy nothing: the shared region is the core either way, so the
identical-core split reaches the same token economics with no ordering constraint —
no dependency on `security` warming first, and no round of misses if it errors.

## Not done here

- **No manifest change.** `scripts/agent/lenses/lenses.json` is untouched; the
  sample counts stay where #607 and #610 put them. This change is worth more at one
  sample but is correct at any count.
- **The saving is a projection**, from `cache-report.mjs`'s `~4 chars/token` estimate
  over prompt input only. Confirm against `weightedTokens` / `cache_read_input_tokens`
  in the metrics ledger after the next real round.
- A prose-only PR leaves the core empty; `splitLensDiff` falls back to the whole
  slice, so those rounds cache exactly as much (or as little) as they did before.
