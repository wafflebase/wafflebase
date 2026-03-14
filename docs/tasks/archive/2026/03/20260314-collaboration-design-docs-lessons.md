# Collaboration Design Docs — Lessons

## Add A Focused Design Doc When Overview Docs Go Stale

- If a subsystem has evolved enough that the package overview is mixing current
  behavior with obsolete details, add a dedicated design doc for the subsystem
  and keep the overview doc short. Trying to stuff every new concurrency detail
  into `frontend.md` alone would have made that document harder to scan and
  easier to let drift again.

## Fix The Stale Reference, Not Just The New Doc

- Adding a new design doc is not enough when an existing overview doc actively
  describes the old model. Update the old entry point to summarize the new
  shape and link to the deeper document, or readers will keep following the
  stale path first.
