import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { TEMPLATE_CATALOG } from './catalog';
import { seedContentHash } from './seed-hash';
import type { SeedContent, TemplateSeed } from './types';

/**
 * Write the seed catalogue as JSON, for the offline thumbnail renderer
 * (docs/design/template-catalog-scaling.md §3).
 *
 *   pnpm backend template:dump [slug...] --out <file>
 *
 * No Nest context and no database: the catalogue is plain TypeScript, and the
 * consumer is `pnpm frontend render:thumbnails`, which has no backend either.
 * Each entry carries its `contentHash` so the renderer can echo it into its
 * manifest, and `sync:templates` can refuse a thumbnail of stale content.
 */

/** One catalogue entry, as `render:thumbnails` reads it. */
export interface DumpedSeed {
  slug: string;
  type: SeedContent['kind'];
  contentHash: string;
  content: SeedContent;
}

export interface TemplateDump {
  version: 1;
  seeds: DumpedSeed[];
}

/** Pure, so a test can assert the shape without touching the filesystem. */
export function dumpCatalog(
  catalog: readonly TemplateSeed[],
  slugs: readonly string[] = [],
): TemplateDump {
  const bySlug = new Map(catalog.map((seed) => [seed.slug, seed]));
  const unknown = slugs.filter((slug) => !bySlug.has(slug));
  if (unknown.length > 0) {
    throw new Error(`Unknown seed slug(s): ${unknown.join(', ')}`);
  }
  const picked =
    slugs.length > 0 ? slugs.map((slug) => bySlug.get(slug)!) : catalog;
  return {
    version: 1,
    seeds: picked.map((seed) => ({
      slug: seed.slug,
      type: seed.content.kind,
      contentHash: seedContentHash(seed.content),
      content: seed.content,
    })),
  };
}

function parseArgs(argv: string[]): { out: string; slugs: string[] } {
  let out: string | undefined;
  const slugs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (!a.startsWith('--')) slugs.push(a);
    else throw new Error(`Unknown option: ${a}`);
  }
  if (!out) {
    throw new Error('Usage: pnpm backend template:dump [slug...] --out <file>');
  }
  return { out, slugs };
}

async function main(): Promise<void> {
  const { out, slugs } = parseArgs(process.argv.slice(2));
  const dump = dumpCatalog(TEMPLATE_CATALOG, slugs);
  // `pnpm --filter` runs this from the package directory; resolve against
  // where the operator actually typed the command.
  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), out);
  await writeFile(file, `${JSON.stringify(dump)}\n`);
  console.log(`${dump.seeds.length} seed(s) → ${file}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
