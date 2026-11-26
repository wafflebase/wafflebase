import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { TEMPLATE_CATALOG } from './catalog';
import { seedContentHash } from './seed-hash';
import { dumpCatalog } from './template-dump';
import { ThumbnailDirectory } from './thumbnail-manifest';

describe('ThumbnailDirectory', () => {
  let dir: string;
  const bytes = Buffer.from('thumbnail');
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'thumbs-'));
    await writeFile(path.join(dir, 'a.webp'), bytes);
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        version: 1,
        items: {
          a: {
            file: 'a.webp',
            mimeType: 'image/webp',
            sha256,
            contentHash: 'c',
          },
          tampered: {
            file: 'a.webp',
            mimeType: 'image/webp',
            sha256: 'not-the-hash',
            contentHash: 'c',
          },
          escape: {
            file: '../a.webp',
            mimeType: 'image/webp',
            sha256,
            contentHash: 'c',
          },
        },
        skipped: { sheet: 'no renderer yet' },
        failed: { broken: 'render threw' },
      }),
    );
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('returns a thumbnail whose bytes match the manifest', async () => {
    const thumbs = await ThumbnailDirectory.open(dir);
    await expect(thumbs.get('a')).resolves.toMatchObject({
      kind: 'ok',
      thumbnail: { sha256, contentHash: 'c', mimeType: 'image/webp' },
    });
  });

  it('refuses bytes that no longer match, and paths outside the directory', async () => {
    const thumbs = await ThumbnailDirectory.open(dir);
    await expect(thumbs.get('tampered')).resolves.toMatchObject({
      kind: 'failed',
    });
    await expect(thumbs.get('escape')).resolves.toMatchObject({
      kind: 'failed',
    });
  });

  it('separates an unsupported type from a failed or missing render', async () => {
    const thumbs = await ThumbnailDirectory.open(dir);
    await expect(thumbs.get('sheet')).resolves.toEqual({
      kind: 'skipped',
      reason: 'no renderer yet',
    });
    await expect(thumbs.get('broken')).resolves.toEqual({
      kind: 'failed',
      reason: 'render threw',
    });
    await expect(thumbs.get('nowhere')).resolves.toMatchObject({
      kind: 'failed',
    });
  });
});

describe('dumpCatalog', () => {
  it('carries each seed with the content hash sync compares against', () => {
    const [first] = TEMPLATE_CATALOG;
    const dump = dumpCatalog(TEMPLATE_CATALOG, [first.slug]);
    expect(dump).toEqual({
      version: 1,
      seeds: [
        {
          slug: first.slug,
          type: first.content.kind,
          contentHash: seedContentHash(first.content),
          content: first.content,
        },
      ],
    });
    expect(dumpCatalog(TEMPLATE_CATALOG).seeds).toHaveLength(
      TEMPLATE_CATALOG.length,
    );
  });

  it('gives every seed the same content hash on every load of the catalogue', () => {
    // Two loads generate different placeholder ids; `template:dump` and
    // `sync:templates` run in different processes and must still agree.
    const load = (): string[] => {
      let hashes: string[] = [];
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { TEMPLATE_CATALOG: catalog } = require('./catalog') as {
          TEMPLATE_CATALOG: typeof TEMPLATE_CATALOG;
        };
        hashes = catalog.map((seed) => seedContentHash(seed.content));
      });
      return hashes;
    };
    expect(load()).toEqual(load());
  });

  it('refuses an unknown slug', () => {
    expect(() => dumpCatalog(TEMPLATE_CATALOG, ['no-such-seed'])).toThrow(
      /no-such-seed/,
    );
  });
});
