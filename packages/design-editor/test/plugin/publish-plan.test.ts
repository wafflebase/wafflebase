/*
 * `publishPlan` — the invalidation half of `POST /plan`.
 *
 * `POST /plan` shipped setting the plan map and returning, so `scene-patch` never got
 * asked to re-transform anything: a staged class edit was invisible until Approve wrote
 * it to disk. These tests pin the two properties whose absence caused that, and one the
 * design doc singles out as the case a naive implementation gets wrong.
 */
import { describe, it, expect } from 'vitest';
import { publishPlan, type ArtifactHost } from '../../src/plugin/bridge.ts';

type Mod = Parameters<ArtifactHost['reloadModule']>[0];

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

const ok = (rel: string) => ({ abs: `/repo/${rel}` });

describe('publishPlan', () => {
  it('reloads only the side it was given', async () => {
    // `before` and `after` are two transforms of one file. Reloading both would move
    // one side's preview because the other's plan changed.
    const h = host({
      '/repo/a.tsx': ['/repo/a.tsx?wbFrame=before', '/repo/a.tsx?wbFrame=after'],
    });
    await publishPlan(h, 'after', ['a.tsx'], ok);
    expect(h.reloaded).toEqual(['/repo/a.tsx?wbFrame=after']);
  });

  it('ignores an unqualified module', async () => {
    // The shell imports the same files. They are not previewing anything.
    const h = host({ '/repo/a.tsx': ['/repo/a.tsx'] });
    await publishPlan(h, 'after', ['a.tsx'], ok);
    expect(h.reloaded).toEqual([]);
  });

  it('REVERTS: a file the plan no longer names is still reloaded', async () => {
    /*
     * The union property, stated as the failure it prevents. The caller passes old ∪ new;
     * if it passed only the new plan's files, `a.tsx` would keep serving the patch it got
     * when it WAS in the plan, and dropping an edit would never revert on screen. An
     * emptied plan is the extreme case — it names no files at all.
     */
    const h = host({
      '/repo/a.tsx': ['/repo/a.tsx?wbFrame=after'],
      '/repo/b.tsx': ['/repo/b.tsx?wbFrame=after'],
    });
    await publishPlan(h, 'after', new Set(['a.tsx', 'b.tsx']), ok);
    expect(h.reloaded.sort()).toEqual([
      '/repo/a.tsx?wbFrame=after',
      '/repo/b.tsx?wbFrame=after',
    ]);
  });

  it('warns rather than throwing when a file is unreachable', async () => {
    const h = host({});
    const out = await publishPlan(h, 'after', ['../escape.tsx'], () => ({ error: 'outside root' }));
    expect(out).toEqual([]);
    expect(h.warnings[0]).toContain('outside root');
  });

  it('keeps going when ONE module fails to reload', async () => {
    // Losing the rest of the plan to one bad module is how a preview half-applies.
    const h = host(
      {
        '/repo/a.tsx': ['/repo/a.tsx?wbFrame=after'],
        '/repo/b.tsx': ['/repo/b.tsx?wbFrame=after'],
      },
      { failOn: '/repo/a.tsx?wbFrame=after' },
    );
    const out = await publishPlan(h, 'after', ['a.tsx', 'b.tsx'], ok);
    expect(out).toEqual(['/repo/b.tsx?wbFrame=after']);
    expect(h.warnings[0]).toContain('could not reload');
  });
});
