/**
 * Tests for the HMR push that follows a token regeneration.
 *
 * `pushArtifacts` takes a narrow structural `ArtifactHost` rather than a `ViteDevServer`
 * precisely so this is testable: the rest of the bridge is middleware and needs a live
 * dev server, which is why 8a's plugin half landed with no automated gate.
 *
 * What it must get right is not the happy path but the two silent failures. If a
 * regenerated artefact is missing from the module graph, or its reload rejects, the symptom
 * is "I saved, the emitter ran, and the page still shows the old value" — with nothing in
 * the log to work from.
 */

import { describe, expect, it } from 'vitest';
import { pushArtifacts, type ArtifactHost } from '../../src/plugin/bridge';

type Mod = Parameters<ArtifactHost['reloadModule']>[0];

/** A host whose module graph is a plain map, and whose warnings are collected. */
function host(
  files: Record<string, string[]>,
  opts: { failOn?: string } = {},
): ArtifactHost & { warnings: string[]; reloaded: string[] } {
  const warnings: string[] = [];
  const reloaded: string[] = [];
  return {
    warnings,
    reloaded,
    moduleGraph: {
      getModulesByFile: (file) => {
        const ids = files[file];
        return ids ? new Set(ids.map((id) => ({ id }) as unknown as Mod)) : undefined;
      },
    },
    reloadModule: async (mod) => {
      const id = (mod as unknown as { id: string }).id;
      if (opts.failOn === id) throw new Error(`reload failed for ${id}`);
      reloaded.push(id);
    },
    config: { logger: { warn: (m) => warnings.push(m) } },
  };
}

describe('pushArtifacts', () => {
  it('reloads every module backing the file, not just one', async () => {
    // A single file can back several modules — the reason this uses `getModulesByFile`
    // rather than `getModuleById`, which also could not find a module by filesystem path
    // once the id carried a query or a plugin prefix.
    const h = host({ '/abs/tokens.css': ['/abs/tokens.css', '/abs/tokens.css?direct'] });
    await pushArtifacts(h, ['/abs/tokens.css']);
    expect(h.reloaded).toEqual(['/abs/tokens.css', '/abs/tokens.css?direct']);
    expect(h.warnings).toEqual([]);
  });

  it('warns when a regenerated artefact is not in the module graph', async () => {
    const h = host({});
    await pushArtifacts(h, ['/abs/tokens.css']);
    expect(h.reloaded).toEqual([]);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain('/abs/tokens.css');
    expect(h.warnings[0]).toContain('not in the module graph');
  });

  it('warns and continues when a reload rejects', async () => {
    // The rejection used to be discarded by a bare `.catch(() => {})`.
    const h = host({ '/a.css': ['/a.css'], '/b.css': ['/b.css'] }, { failOn: '/a.css' });
    await pushArtifacts(h, ['/a.css', '/b.css']);
    expect(h.reloaded).toEqual(['/b.css']);
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain('could not reload /a.css');
    expect(h.warnings[0]).toContain('reload failed');
  });

  it('is a no-op for an empty artefact list', async () => {
    const h = host({});
    await pushArtifacts(h, []);
    expect(h.warnings).toEqual([]);
  });
});
