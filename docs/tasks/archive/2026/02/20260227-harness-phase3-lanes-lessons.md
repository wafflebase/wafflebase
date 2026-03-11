# Lessons

- Separate self-contained verification from integration checks so contributors
  can always validate core changes without external services.
- Keep integration checks explicit and callable via a dedicated command, then
  compose aliases for backward compatibility instead of removing old entry
  points abruptly.
- Document integration prerequisites (`localhost:5432` or CI service) in both
  command docs and PR verification fields so failures are interpreted quickly.
