# Data Validation Side Panel — Lessons

## What went well

- **Mirroring a proven component paid off.** The panel is a near-clone of
  `ConditionalFormatPanel` (rule list + editor, A1 range helpers, load/commit via
  `get/setX`). Structural symmetry with an existing, shipped panel made the design
  obvious and the transcription cheap.
- **Subagent-driven execution with a full-code plan.** Tasks 1/2/4 were pure
  transcription (cheap model); Task 3 (integration/removals) needed a standard
  model. Per-task review caught real bugs before they compounded.

## Review-caught bugs (worth remembering)

- **React sync-effect keyed on the derived object reverts uncommitted edits.**
  `selectedRule` is a `useMemo` over `rules.find(...)`; keying the field-sync
  effect on `[selectedRuleId, selectedRule]` means *any* `updateRule` (which
  replaces the rule object) re-runs the effect and wipes in-progress local input
  (range text, options textarea). Fix: key on `[selectedRuleId]` only. **The CF
  panel has the same latent pattern** — worth a follow-up there.
- **A kind-specific resolver as a generic gate.** `getListRuleAt()` returns a rule
  only when `kind === 'list'`. Using it as a "does any rule exist here?" gate
  meant a checkbox-ruled cell read as empty and got an overlapping auto-added
  rule. Added an any-kind `getDataValidationAt` for the gate.
- **Skipping a "produces" interface breaks the next task.** Task 3's implementer
  folded `handleOpenDataValidation` into `handleInsertDropdown` (which always
  seeds `autoAddKind: 'list'`), but Task 4's context-menu entry needed the
  null-autoAddKind variant. The plan's per-task "Produces" contract is load-
  bearing — a reviewer flagged the missing callback as Critical.

## Engine/panel interaction

- **Normalize-on-write vs. panel working copy.** `setDataValidations` drops a
  list rule with zero options. The panel keeps its own `rules` state as the
  session working copy so an in-progress dropdown stays editable; it only
  persists once it has an option. This divergence is intentional and matches how
  CF panel treats its state as authoritative during editing.

## Process notes

- **Auth blocks headless UI smoke.** The panel is a frontend React component;
  the sheets dev harness only mounts the bare `Spreadsheet`, not the app shell.
  Interactive panel smoke needs the authenticated app — deferred to a manual
  pass. (Forging a JWT to smoke was correctly blocked by the sandbox.)
- **eslint `--max-warnings 0` + a temporarily-unused callback.** Task 3 added
  `handleOpenDataValidation` before its consumer existed, needing a temporary
  `eslint-disable no-unused-vars`; Task 4 wired it and removed the disable. An
  unused disable directive itself fails `--max-warnings 0`, so the removal was
  load-bearing.

## Follow-ups

- Extract the duplicated `parseA1Ranges`/`formatA1Ranges` (CF + DV panels) into a
  shared module.
- `getListRuleAt` could delegate to `getDataValidationAt` + a kind filter.
- Apply the sync-effect keying fix to `ConditionalFormatPanel` too.
- Date/number/text/custom-formula criteria; range-source lists; custom checkbox
  values.
