import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveAliases } from '../../src/plugin/aliases.ts';
import { resolveOptions } from '../../src/plugin/options.ts';

const ROOT = path.resolve('/project');

describe('resolveAliases', () => {
  it('keeps a string alias and reports it root-relative', () => {
    expect(
      resolveAliases([{ find: '@', replacement: path.join(ROOT, 'app') }], ROOT),
    ).toEqual([{ find: '@', replacement: 'app' }]);
  });

  it('resolves a relative replacement against the root, because Vite does not', () => {
    // Measured against a real resolved config: an alias configured as
    // `'./app/components'` is STILL `'./app/components'` in `config.resolve.alias`,
    // while one given absolutely stays absolute. Handing the client both forms
    // would make it guess which it had.
    expect(
      resolveAliases([{ find: '~lib', replacement: './app/components' }], ROOT),
    ).toEqual([{ find: '~lib', replacement: 'app/components' }]);
  });

  it('drops a RegExp find, which cannot cross the wire', () => {
    // In practice every one of these is Vite's own — `^/?@vite/client` and
    // `^/?@vite/env` are injected into every resolved config, and neither is a
    // drill-in target.
    expect(
      resolveAliases(
        [
          { find: /^\/?@vite\/client/, replacement: '/@fs/x/vite/dist/client/client.mjs' },
          { find: '@', replacement: path.join(ROOT, 'src') },
        ],
        ROOT,
      ),
    ).toEqual([{ find: '@', replacement: 'src' }]);
  });

  it('drops an alias that escapes the root', () => {
    // A drill-in into `node_modules` would invite editing a dependency, and the
    // write boundary refuses it anyway — so offering it is worse than omitting it.
    expect(
      resolveAliases(
        [
          { find: 'vendor', replacement: path.resolve(ROOT, '../elsewhere') },
          { find: 'ok', replacement: path.join(ROOT, 'lib') },
        ],
        ROOT,
      ),
    ).toEqual([{ find: 'ok', replacement: 'lib' }]);
  });

  it('drops an alias pointing at the root itself', () => {
    // `path.relative(root, root)` is `''`, which would compose as a bare join and
    // resolve every aliased specifier to the project root rather than to a file.
    expect(resolveAliases([{ find: '~', replacement: ROOT }], ROOT)).toEqual([]);
  });

  it('drops an empty find rather than matching every specifier', () => {
    expect(resolveAliases([{ find: '', replacement: path.join(ROOT, 'a') }], ROOT)).toEqual([]);
  });

  it('reaches ResolvedOptions, so the bridge has something to report', () => {
    const opts = resolveOptions(undefined, ROOT, [
      { find: '@', replacement: path.join(ROOT, 'app') },
    ]);
    expect(opts.aliases).toEqual([{ find: '@', replacement: 'app' }]);
  });

  it('is empty when the consumer configured none', () => {
    expect(resolveOptions(undefined, ROOT).aliases).toEqual([]);
  });

  it('resolves against an explicit `root`, not the Vite root', () => {
    // A monorepo consumer serving `apps/web` but editing `packages/ui` passes
    // `root`; an alias relative to the Vite root would then land outside it.
    const opts = resolveOptions({ root: path.join(ROOT, 'packages/ui') }, path.join(ROOT, 'apps/web'), [
      { find: '@', replacement: path.join(ROOT, 'packages/ui/src') },
    ]);
    expect(opts.aliases).toEqual([{ find: '@', replacement: 'src' }]);
  });
});
