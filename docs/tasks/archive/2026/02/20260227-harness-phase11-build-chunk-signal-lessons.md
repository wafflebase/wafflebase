# Lessons

- Build warnings should be treated as signal quality issues; either reduce the
  underlying chunk size or make boundaries explicit with intentional chunking.
- Prefer deterministic manual chunk rules for major dependency clusters before
  raising warning thresholds.
- For this codebase, isolating `antlr4ts` and sheet formula paths into a
  dedicated chunk is an effective first step to remove oversized frontend
  chunks without changing runtime behavior.
