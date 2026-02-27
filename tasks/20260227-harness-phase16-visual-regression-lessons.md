# Lessons

- Visual regression baselines should render from deterministic routes that
  avoid auth/network state so snapshot diffs remain actionable.
- When environment constraints block browser tooling, prefer a dependency-free
  SSR baseline verifier that still fails deterministically in CI.
