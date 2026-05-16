---
title: Slides — uturnArrow bbox clamp + flipH/flipV lessons
date: 2026-05-17
owner: hackerwins
---

# Lessons — slides uturnArrow bbox clamp + flipH/flipV

> Filled in after implementation. Capture root causes, decisions, and
> recurring mistakes so future PPTX-fidelity work avoids them.

## What surprised us

- _TBD after implementation._

## Recurring mistakes to avoid

- _TBD — e.g. "shape path builders assume portrait orientation; always
  test landscape w/h ratios"._

## Decisions worth remembering

- _TBD — e.g. "Frame keeps flipH/flipV as optional fields so existing
  Yorkie state stays valid"._

## Open follow-ups

- OOXML 5-adjustment `uturnArrow` exact-match (separate task).
- Audit other arrow path builders for the same width-vs-height
  assumption.
