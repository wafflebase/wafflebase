/**
 * The one engine symbol `seed-sheets.ts` needs, declared rather than resolved.
 *
 * WHY NOT MAP `@wafflebase/*` IN tsconfig. Measured, exactly as with the frontend modules
 * in `../frontend-modules.d.ts`: pointing it at `../sheets/src` makes `tsc` typecheck the
 * whole engine under THIS package's options, and `verbatimModuleSyntax` alone produces
 * hundreds of `TS1484`s in files that are correct under the config that owns them.
 *
 * The engines are typechecked by `pnpm sheets typecheck` and friends. Vite resolves the real
 * modules at runtime through the aliases in `vite.config.ts`, which point at the same
 * `src/index.ts` the frontend's own config uses.
 *
 * WHAT IS LOST: if `toSref`'s signature changes, `seed-sheets.ts` fails in the browser, not
 * here. Its shape is transcribed below so a mistake in the CALL is still caught.
 */
declare module '@wafflebase/sheets' {
  /**
   * `{ r, c }` → `"A1"`. BOTH axes are 1-based: `toSref({ r: 1, c: 1 }) === 'A1'`, and row
   * or column 0 yields a bare sref that `parseRef` rejects — see `seed-sheets.ts`'s header.
   */
  export function toSref(ref: { r: number; c: number }): string;
}
