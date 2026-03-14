# CI Export Failure Investigation — Lessons

## Barrel Files Must Separate Type-Only Exports From Runtime Exports

- If a package barrel mixes `type` imports into a plain `export { ... }` list,
  Node ESM can fail at runtime with `Export '<name>' is not defined in module`.
- For packages consumed directly from TypeScript source in Node test lanes, use
  `export type { ... }` or `export { type ... }` for every type-only symbol in
  the barrel.
