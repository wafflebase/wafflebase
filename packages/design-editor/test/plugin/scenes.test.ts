import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  providersSpecifier,
  readManifest,
  renderScenesModule,
  sceneSpecifier,
  type SceneConfig,
} from '../../src/plugin/scenes';

/**
 * The manifest is the consumer's to author, and §5 calls it the real onboarding
 * cliff. What is unit-tested here is narrow and deliberate: the tolerance of a bad
 * manifest (which must not take down a dev server), and the SHAPE of the generated
 * module (whose specifiers Vite's dependency scanner reads statically — if they
 * are wrong the failure is a mid-session frame reload, not an error).
 */

const dir = mkdtempSync(path.join(tmpdir(), 'wb-scenes-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
const manifestFile = (body: string): string => {
  const p = path.join(dir, `m${n++}.json`);
  writeFileSync(p, body, 'utf8');
  return p;
};

const ROOT = path.resolve('/proj');
const scene = (over: Partial<SceneConfig> = {}) => ({
  id: 'documents',
  kind: 'dom' as const,
  label: 'Documents',
  file: 'src/pages/documents.tsx',
  ...over,
});

describe('readManifest', () => {
  it('reads scenes and components', () => {
    const p = manifestFile(JSON.stringify({ components: ['a.tsx'], scenes: [scene()] }));
    const m = readManifest(p);
    expect(m.components).toEqual(['a.tsx']);
    expect(m.scenes?.map((s) => s.id)).toEqual(['documents']);
  });

  it('returns an EMPTY manifest for malformed JSON rather than throwing', () => {
    // The manifest is the consumer's file and the plugin is dev-only: a typo in it
    // must not take down their dev server during config resolution. They get an
    // editor with no scenes, which says what is wrong better than a stack trace.
    expect(readManifest(manifestFile('{ not json'))).toEqual({ components: [], scenes: [] });
  });

  it('returns an empty manifest for a missing file and for no configured path', () => {
    // `null` is every project's state before onboarding.
    expect(readManifest(path.join(dir, 'nope.json'))).toEqual({ components: [], scenes: [] });
    expect(readManifest(null)).toEqual({ components: [], scenes: [] });
  });

  it('defaults both keys when the JSON is valid but empty', () => {
    expect(readManifest(manifestFile('{}'))).toEqual({ components: [], scenes: [] });
  });
});

describe('sceneSpecifier', () => {
  it('is always /@fs/ with the frame side attached', () => {
    // The prototype preferred the consumer's `@` alias so the specifier survived
    // `vite build`. The plugin is `apply: "serve"` and dev-only by declared
    // Non-Goal, so there is no build to survive — and preferring an alias would
    // mean the plugin had to know the consumer's alias config, which is the exact
    // coupling §6 removes.
    expect(sceneSpecifier(ROOT, 'src/pages/a.tsx', 'before')).toBe(
      `/@fs/${path.resolve(ROOT, 'src/pages/a.tsx').split(path.sep).join('/')}?wbFrame=before`,
    );
  });

  it('uses POSIX separators, because /@fs/ is a URL path', () => {
    expect(sceneSpecifier(ROOT, 'a/b/c.tsx', 'after')).not.toContain('\\');
  });

  it('is stable for providers too', () => {
    expect(providersSpecifier(path.resolve('/x/providers.tsx'), 'after')).toBe(
      `/@fs/${path.resolve('/x/providers.tsx').split(path.sep).join('/')}?wbFrame=after`,
    );
  });
});

describe('renderScenesModule', () => {
  const providers = path.resolve('/proj/design/providers.tsx');

  it('emits one loader per scene per SIDE, both side-qualified', () => {
    // Providers wrap the scene, so a single shared providers module would put both
    // sides' trees in one React realm and the engines' module-level state would be
    // shared between "before" and "after".
    const out = renderScenesModule(ROOT, { scenes: [scene()] }, providers);
    expect(out).toContain('"documents|before"');
    expect(out).toContain('"documents|after"');
    expect(out).toContain('?wbFrame=before');
    expect(out).toContain('?wbFrame=after');
    expect(out.match(/wbFrame=before/g)).toHaveLength(2); // scene + providers
  });

  it('emits LITERAL import() specifiers, which is the whole point', () => {
    // A runtime `import(variable)` would leave Vite's scanner blind to the scene's
    // subtree, and the first mount would trigger "new dependencies optimized,
    // reloading" — a full frame reload mid-session that discards the selection.
    const out = renderScenesModule(ROOT, { scenes: [scene()] }, providers);
    expect(out).toMatch(/import\("\/@fs\/[^"]+\?wbFrame=before"\)/);
  });

  it('omits a deferred scene entirely', () => {
    const out = renderScenesModule(ROOT, { scenes: [scene({ deferred: true })] }, providers);
    expect(out).not.toContain('documents|before');
    expect(out).toContain('export const scenes = []');
  });

  it('omits a scene whose kind it cannot mount', () => {
    const out = renderScenesModule(
      ROOT,
      { scenes: [scene({ kind: 'pdf' as unknown as 'dom' })] },
      providers,
    );
    expect(out).toContain('export const scenes = []');
  });

  it('still generates a loader when no providers are configured', () => {
    // Bare-rendered is wrong-looking for a nested route, but it is not a crash,
    // and generating nothing would leave the editor empty with no explanation.
    const out = renderScenesModule(ROOT, { scenes: [scene()] }, null);
    expect(out).toContain('"documents|before"');
    expect(out).toContain('export const hasProviders = false');
    expect(out.match(/wbFrame=before/g)).toHaveLength(1); // the scene only
  });

  it('rejects an unknown scene id at RUNTIME, not just in the generated text', () => {
    // Evaluated rather than string-matched: the generated module is executed in the
    // browser, and "the source contains this message" does not establish that
    // `loadScene` reaches it — a missing entry could just as easily throw
    // "load is not a function". Only the unknown-id branch is exercised, so no
    // `import()` of a real scene file is ever evaluated.
    const out = renderScenesModule(ROOT, { scenes: [scene()] }, providers);
    return (async () => {
      const mod = (await import(
        `data:text/javascript,${encodeURIComponent(out)}`
      )) as { loadScene: (id: string, side: string) => Promise<unknown>; scenes: unknown[] };
      expect(mod.scenes).toHaveLength(1);
      await expect(mod.loadScene('nope', 'before')).rejects.toThrow('no such scene: nope (before)');
    })();
  });

  it('de-duplicates scenes sharing an id, keeping the first', () => {
    // The loader table is keyed by `${id}|${side}`, so a duplicate id silently
    // overwrote the earlier entry while BOTH scenes stayed in the exported list: the
    // outline showed two rows and one of them loaded the other's file. Same rule as
    // `findJsxRoots`' `ambiguous` set — ambiguity is reported, never resolved by
    // picking silently.
    const out = renderScenesModule(
      ROOT,
      { scenes: [scene({ file: 'src/first.tsx' }), scene({ file: 'src/second.tsx' })] },
      providers,
    );
    expect(out.match(/"documents\|before"/g)).toHaveLength(1);
    expect(out.match(/"documents\|after"/g)).toHaveLength(1);
    expect(out).toContain('src/first.tsx');
    expect(out).not.toContain('src/second.tsx');
    // Exactly one entry in the exported list, not two.
    expect(out.match(/"id": "documents"/g)).toHaveLength(1);
  });
});
