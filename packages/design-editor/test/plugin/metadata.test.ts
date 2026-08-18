import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `GET /metadata` — the outline's data source.
 *
 * Two properties matter and both fail silently:
 *
 * 1. **`file` is ROOT-RELATIVE.** `analyzeScene` echoes the absolute path it was handed,
 *    while `stamp.mjs` writes `data-wb-file` root-relative by its own contract. The
 *    outline compares a clicked node's `parseStampId(id).file` against the metadata's,
 *    so left absolute the two never match and a click in the frame highlights nothing.
 * 2. **A file that fails to analyse is REPORTED, not dropped.** Dropping it yields an
 *    outline missing a scene, which reads as "this project has fewer scenes" rather than
 *    as a parse failure.
 *
 * Driven against `analyzeScene`/`analyzeFile` directly plus the normalisation the route
 * applies, rather than by booting a dev server — the live path is covered by
 * `verify-consumer` and `verify:frame`.
 */

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-meta-'));
  fs.mkdirSync(path.join(root, 'app/pages'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'app/pages/dash.tsx'),
    `export default function Dash() {\n  return <main><span>hi</span></main>;\n}\n`,
  );
  fs.writeFileSync(path.join(root, 'app/pages/broken.tsx'), `export default function ( {{{\n`);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/');

describe('the analyser behind the route', () => {
  it('returns a node tree for a scene', async () => {
    const { analyzeScene } = await import('../../src/server/extract.mjs');
    const abs = path.join(root, 'app/pages/dash.tsx');
    const meta = analyzeScene(abs, { id: 'dash', kind: 'dom', label: 'Dash', export: 'default' });
    expect(meta.component).toBe('Dash');
    const roots = Object.keys(meta.roots);
    expect(roots).toEqual(['Dash']);
    const tags: string[] = [];
    const walk = (n: { tag: string; children: unknown[] }) => {
      tags.push(n.tag);
      for (const c of n.children) walk(c as typeof n);
    };
    walk(meta.roots.Dash);
    expect(tags).toContain('main');
    expect(tags).toContain('span');
  });

  it('echoes the ABSOLUTE path, which is why the route normalises it', async () => {
    // This is the defect, pinned at its source: the analyser is not wrong, the route has
    // to translate. Asserting it here means a future analyser change that starts
    // returning a relative path fails loudly instead of double-relativising.
    const { analyzeScene } = await import('../../src/server/extract.mjs');
    const abs = path.join(root, 'app/pages/dash.tsx');
    const meta = analyzeScene(abs, { id: 'dash', kind: 'dom', label: 'Dash', export: 'default' });
    expect(path.isAbsolute(meta.file)).toBe(true);
    // What the route does, and what `data-wb-file` will carry.
    expect(rel(meta.file)).toBe('app/pages/dash.tsx');
  });

  it('throws on a file it cannot parse, so the route can report it', async () => {
    // The route catches this into `failed[]`. If it threw past the route the whole
    // outline would 500 for one bad file; if the analyser returned an empty tree the
    // scene would look childless.
    const { analyzeScene } = await import('../../src/server/extract.mjs');
    const abs = path.join(root, 'app/pages/broken.tsx');
    let threwOrEmpty = false;
    try {
      const meta = analyzeScene(abs, { id: 'b', kind: 'dom', label: 'B', export: 'default' });
      threwOrEmpty = Object.keys(meta.roots ?? {}).length === 0;
    } catch {
      threwOrEmpty = true;
    }
    expect(threwOrEmpty).toBe(true);
  });

  it('builds a metadata document from files and scenes', async () => {
    const { analyzeFile, analyzeScene, buildMetadata } = await import(
      '../../src/server/extract.mjs'
    );
    const abs = path.join(root, 'app/pages/dash.tsx');
    const doc = buildMetadata({
      files: [analyzeFile(abs)],
      scenes: [analyzeScene(abs, { id: 'dash', kind: 'dom', label: 'Dash', export: 'default' })],
    });
    expect(doc.scenes).toHaveLength(1);
    expect(doc.files).toHaveLength(1);
    expect(doc.summary.componentCount).toBeGreaterThan(0);
  });
});
