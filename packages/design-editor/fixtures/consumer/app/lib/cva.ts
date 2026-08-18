/*
 * This project's own `cva`, not the npm package.
 *
 * WHY IT IS LOCAL. Through 11a nothing in this fixture ever ran: the gate drove the
 * JSON API, the plugin read these files with its own parser, and `badge.tsx` could
 * import `class-variance-authority` without it being installed — the import existed to
 * make the source honest, not to resolve. 11b's frame MOUNTS the scene, so every
 * import on the path has to resolve for real, and `dashboard.tsx` imports `badge.tsx`.
 *
 * Adding the npm package to `@wafflebase/design-editor` would be wrong twice: our own
 * code never uses it, so knip would report it unused, and it is the CONSUMER's
 * dependency, not ours. Making the fixture a workspace member to give it a
 * `package.json` would reach into `pnpm-workspace.yaml` and the CI path classifier for
 * one import.
 *
 * A local one costs nothing and stays faithful to what the plugin actually reads:
 * `extract.mjs` recognises a variant table by the CALLEE BEING NAMED `cva`
 * (`decl.initializer.expression.getText() === 'cva'`), never by where it came from. So
 * the source shape the gate exercises is unchanged, and this fixture keeps being what
 * it is for — a project that is NOT wafflebase and does not use its libraries.
 */

type Variants = Record<string, Record<string, string>>;

interface Options<V extends Variants> {
  variants?: V;
  defaultVariants?: { [K in keyof V]?: keyof V[K] };
}

/** The same call shape as the package: a base class string plus a variant table. */
export function cva<V extends Variants>(base: string, opts: Options<V> = {}) {
  return (props: { [K in keyof V]?: keyof V[K] } = {} as never): string => {
    const picked = Object.entries(opts.variants ?? {}).map(([group, table]) => {
      const key = props[group] ?? opts.defaultVariants?.[group];
      return key === undefined ? '' : (table[key as string] ?? '');
    });
    return [base, ...picked].filter(Boolean).join(' ');
  };
}
