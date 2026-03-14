# CRDT Structural Concurrency Analysis — Lessons

## Identity Before Algorithms

- When collaboration bugs appear around row/column insert/delete, inspect the
  persisted identity model before focusing on shift helpers. If coordinate keys
  are the durable identity, structural concurrency is already on shaky ground.

## Single-User Correctness Is Not Collaborative Correctness

- Passing insert/delete and formula-shift tests only proves local remapping
  logic. It does not prove multi-peer intent preservation. Always check whether
  there are explicit concurrent tests for structure-changing operations.

## Multi-Step Structural Writes Need Extra Scrutiny

- If a structural user action spans multiple CRDT transactions, treat that as a
  correctness risk in concurrent editing, not just an undo/redo detail.
