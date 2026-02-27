# Lessons

- When introducing browser-based harness checks, fail with concrete install
  commands so work can continue outside constrained environments.
- Signal-handler cleanup should be idempotent because the same stop path can be
  reached from both interruption and `finally` flows.
- Add new high-cost verification lanes as explicit commands first; promote them
  into default verify paths only after provisioning is stable in CI/local docs.
- When dependency installation is blocked by network/store constraints and the
  user chooses to run install manually, update `package.json`/lock metadata
  first and hand off exact follow-up install commands.
- When implementation scope changes test/baseline locations, ensure design
  docs reflect the new canonical paths, not only command additions.
