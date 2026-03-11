# Phase 20: PR Evidence Trust Automation — Lessons

## What Worked

- **HTML comment marker** (`<!-- harness-verification -->`) for idempotent
  comment upsert — verify-self creates, verify-integration updates the same
  comment without duplication.
- **`if: always()`** on artifact upload and comment steps ensures reports are
  available even when lanes fail.
- **Pending placeholder** pattern — verify-self posts "verify:integration
  pending..." which verify-integration replaces with actual result.
- **Step outcome** (`steps.integration.outcome`) is the cleanest way to
  capture pass/fail across jobs without artifacts.

## Decisions

- Kept artifact retention at 14 days (sufficient for PR review cycles, avoids
  storage bloat).
- Used `actions/github-script@v7` over dedicated comment actions for full
  control over comment format and upsert logic.
- PR template simplified but kept checklist items as visual reminders (CI
  comment is the source of truth, not the checklist).
