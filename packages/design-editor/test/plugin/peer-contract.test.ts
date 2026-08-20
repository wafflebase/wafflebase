import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * WHAT THE CONSUMER MUST SUPPLY, derived rather than restated.
 *
 * `src/scenes/scene-entry.tsx` is not reached through the `exports` map — `plugin/index.ts`
 * resolves it from the installed package root and hands that PATH to the consumer's Vite,
 * which then resolves its bare imports from the CONSUMER's `node_modules`. So reading
 * `exports` says the package needs no React, while a consumer without React fails at frame
 * load with nothing explaining why.
 *
 * This walks the served directory instead and requires every bare specifier in it to be a
 * declared peer, so a new import into the frame graph fails here rather than in someone
 * else's project.
 */
const SCENES = join(process.cwd(), 'src/scenes');

function bareImports(): string[] {
  const out = new Set<string>();
  for (const f of readdirSync(SCENES).filter((n) => /\.tsx?$/.test(n))) {
    const src = readFileSync(join(SCENES, f), 'utf8');
    for (const m of src.matchAll(/^\s*import\s[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1];
      if (spec.startsWith('.') || spec.startsWith('virtual:')) continue;
      // `react-dom/client` is supplied by the `react-dom` package.
      out.add(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'));
    }
  }
  return [...out].sort();
}

describe('the frame graph declares what the consumer must provide', () => {
  it('every bare import under src/scenes is a peerDependency', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const peers = Object.keys(pkg.peerDependencies ?? {});
    const undeclared = bareImports().filter((s) => !peers.includes(s));
    expect(undeclared).toEqual([]);
  });

  it('React is among them, because the frame entry is served by path', () => {
    // Pinned explicitly: the derived check above passes vacuously if the graph ever stops
    // importing anything, and React is the one this package was shipping undeclared.
    expect(bareImports()).toEqual(expect.arrayContaining(['react', 'react-dom']));
  });
});
