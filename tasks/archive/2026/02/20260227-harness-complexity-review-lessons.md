# Lessons

- Label harness guarantees precisely: HTML snapshot checks are not a substitute
  for browser-rendered visual diffing.
- Wrapper scripts that start local services should implement cleanup in
  `finally` and signal handlers to avoid leaked local runtime state.
- When phase counts and commit counts diverge, anchor reviews to explicit
  phase-to-commit mapping first to avoid ambiguous conclusions.
- When review findings are labeled with priorities (for example P2/P3), reflect
  accepted findings in the corresponding design docs in the same follow-up.
- Prefer action-oriented framing in design docs: when a gap has a clear fix
  path, record it under upcoming work rather than static "known limits".
