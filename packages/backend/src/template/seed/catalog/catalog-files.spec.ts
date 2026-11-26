import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { SeedDocumentType, TemplateSeed } from '../types';
import type { TemplateBrief } from './brief';
import { TEMPLATE_BRIEFS } from './briefs';
import { TEMPLATE_CATALOG } from './index';

/**
 * The catalogue is registered per *file*: `index.ts` imports each
 * `<kind>/<family>.ts` once and `briefs.ts` each `slides/<family>.briefs.ts`.
 * A runtime glob would remove even that line, but neither Jest nor
 * `nest build` offers one, so this test is the glob: a file on disk that
 * nobody imports — the easy mistake when adding one — fails here instead of
 * silently never being seeded.
 */

const KINDS: SeedDocumentType[] = ['slides', 'sheet', 'doc', 'note', 'board'];

/** `<kind>/<name>` for every catalogue module on disk, `.ts` stripped. */
function modulesOnDisk(): string[] {
  const out: string[] = [];
  for (const kind of KINDS) {
    for (const entry of readdirSync(join(__dirname, kind), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.spec.ts')) continue;
      out.push(`${kind}/${entry.name.slice(0, -'.ts'.length)}`);
    }
  }
  return out.sort();
}

/** The `./<kind>/<name>` specifiers a registry file imports. */
function importedBy(file: string): string[] {
  const src = readFileSync(join(__dirname, file), 'utf8');
  return [...src.matchAll(/from '\.\/([a-z]+\/[a-z0-9.-]+)'/g)]
    .map((m) => m[1])
    .sort();
}

const isBriefs = (m: string) => m.endsWith('.briefs');

const load = (m: string): Record<string, unknown> =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(`./${m}`) as Record<string, unknown>;

describe('catalogue file registration', () => {
  const modules = modulesOnDisk();
  const seedModules = modules.filter((m) => !isBriefs(m));
  const briefModules = modules.filter(isBriefs);

  it('finds the catalogue files', () => {
    expect(seedModules.length).toBeGreaterThan(0);
    expect(briefModules.length).toBeGreaterThan(0);
  });

  it('index.ts imports exactly the seed files on disk', () => {
    expect(importedBy('index.ts')).toEqual(seedModules);
  });

  it('briefs.ts imports exactly the brief files on disk', () => {
    expect(importedBy('briefs.ts')).toEqual(briefModules);
  });

  it('names files <kind>/<family>.ts in lower kebab case', () => {
    for (const m of modules) {
      expect(m).toMatch(/^[a-z]+\/[a-z0-9]+(-[a-z0-9]+)*(\.briefs)?$/);
    }
  });

  it.each(seedModules)(
    '%s exports `seeds`, all of its kind, all in the catalogue',
    (m) => {
      const seeds = load(m).seeds as TemplateSeed[];
      expect(Array.isArray(seeds)).toBe(true);
      expect(seeds.length).toBeGreaterThan(0);
      const kind = m.split('/')[0];
      for (const seed of seeds) {
        expect(seed.content.kind).toBe(kind);
        expect(TEMPLATE_CATALOG).toContain(seed);
      }
    },
  );

  it('concatenates every file, each once', () => {
    const total = seedModules.reduce(
      (n, m) => n + (load(m).seeds as TemplateSeed[]).length,
      0,
    );
    expect(TEMPLATE_CATALOG).toHaveLength(total);
  });

  it.each(briefModules)(
    '%s exports `briefs` for the seeds of the file beside it',
    (m) => {
      const briefs = load(m).briefs as TemplateBrief[];
      expect(Array.isArray(briefs)).toBe(true);
      expect(seedModules).toContain(m.slice(0, -'.briefs'.length));
      const sibling = load(m.slice(0, -'.briefs'.length))
        .seeds as TemplateSeed[];
      const slugs = new Set(sibling.map((s) => s.slug));
      for (const brief of briefs) {
        expect(slugs.has(brief.slug)).toBe(true);
        expect(TEMPLATE_BRIEFS).toContain(brief);
      }
    },
  );
});
