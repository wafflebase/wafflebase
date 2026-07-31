# Lessons: reduce lens samples

- [x] **The attribution table (from #603) turned a guess into a decision.** The prior
      hypothesis was that the verifier was the token sink; the per-lens table on #605
      showed detection was 4× the verifier ($11.60 vs $2.74), and that the verifier
      only looked cheap because its sessions errored out early on 429s. The cut
      landed on the right axis (detection samples) because the data pointed there.

- [x] **`samples` is a pure manifest field with no test coupling.** `sampleCountFor`
      is unit-tested against synthetic lens objects, not the real manifest, and
      `samples: 1` is honored (`Math.max(1, floor)`), so this was a data-only change —
      no code, no test churn (388/388 still green).

- [x] **Recall vs cost is a per-lens call.** The code lenses have a
      verifier/test/CI backstop for a missed finding; `security` does not, so its
      second sample was the one worth keeping on cost/safety grounds. It was
      ultimately dropped too, on request — a deliberate, documented acceptance of
      that risk, not an oversight — and the per-lens knob makes it reversible the
      moment a missed injection/secret says otherwise.
