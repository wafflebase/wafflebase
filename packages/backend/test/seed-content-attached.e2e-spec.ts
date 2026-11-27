/**
 * The seed content-write path against a real Yorkie server — what
 * `sync:templates` attests with (docs/design/template-catalog-scaling.md §3).
 *
 * `template-sync.spec.ts` and `template-sync.e2e-spec.ts` fake Yorkie; this is
 * the one place `writeContent` / `readContentHash` / `expectedRootHash` run for
 * real, for every seed type:
 *
 * - the write replaces the whole root, so content injected before it (an
 *   extra sheet tab, slide, board element, a stray root key) does not survive;
 * - a read-back of an untouched document hashes to the catalogue's expected
 *   root, through a separate attach;
 * - any edit after the write changes that hash.
 *
 * Gated on `RUN_YORKIE_INTEGRATION_TESTS=true` like
 * `docs-tree-attached.e2e-spec.ts`: `docker compose up -d` locally, the
 * `verify-integration` job in CI.
 */
import { ConfigService } from '@nestjs/config';
import { YorkieService } from 'src/yorkie/yorkie.service';
import { YORKIE_DOC_KEY_PREFIXES } from 'src/yorkie/yorkie-doc-key';
import { TEMPLATE_CATALOG } from 'src/template/seed/catalog';
import {
  expectedRootHash,
  readContentHash,
  writeContent,
} from 'src/template/seed/seed-templates';
import type { SeedContent } from 'src/template/seed/types';

const describeAttached =
  process.env.RUN_YORKIE_INTEGRATION_TESTS === 'true'
    ? describe
    : describe.skip;

function createConfig(): ConfigService {
  return {
    get: (key: string): string | undefined => process.env[key],
  } as unknown as ConfigService;
}

type Root = Record<string, any>;

/** One catalogue seed per type, so the real builders' output is exercised. */
const KINDS: SeedContent['kind'][] = [
  'slides',
  'note',
  'doc',
  'sheet',
  'board',
];
const seedOf = (kind: SeedContent['kind']) => {
  const seed = TEMPLATE_CATALOG.find((s) => s.content.kind === kind);
  if (!seed) throw new Error(`no ${kind} seed in the catalogue`);
  return seed;
};

/** Content a stranger put in the document before the seed was written. */
function inject(kind: SeedContent['kind'], root: Root): void {
  root.injected = { by: 'stranger' };
  if (kind === 'sheet') {
    root.tabs = { 'tab-x': { id: 'tab-x', name: 'Injected', type: 'sheet' } };
    root.tabOrder = ['tab-x'];
    root.sheets = { 'tab-x': { cells: {} } };
  }
  if (kind === 'slides') {
    root.slides = [{ id: 'injected-slide', elements: [], notes: [] }];
  }
  if (kind === 'board') {
    root.elements = [{ id: 'injected-element', type: 'shape' }];
  }
}

/** A stranger's edit after the seed was written. */
function tamper(kind: SeedContent['kind'], root: Root): void {
  if (kind === 'sheet') {
    root.tabs['tab-x'] = { id: 'tab-x', name: 'Extra', type: 'sheet' };
    root.tabOrder.push('tab-x');
    return;
  }
  if (kind === 'slides') {
    root.slides.push({ id: 'extra-slide', elements: [], notes: [] });
    return;
  }
  if (kind === 'board') {
    root.elements.push({ id: 'extra-element', type: 'shape' });
    return;
  }
  root.extra = 'stranger';
}

describeAttached('seed content write path (attached Yorkie)', () => {
  let yorkie: YorkieService;

  beforeAll(() => {
    process.env.YORKIE_RPC_ADDR ??= 'http://localhost:8080';
    yorkie = new YorkieService(createConfig());
  });

  it.each(KINDS)(
    '%s: replaces the whole root, reads back the expected hash, detects a later edit',
    async (kind) => {
      const seed = seedOf(kind);
      const documentId = `seed-attached-${kind}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      const options = { docKeyPrefix: YORKIE_DOC_KEY_PREFIXES[kind] };

      // Something already in the document before the seed is written.
      await yorkie.withDocument<void, Root>(
        documentId,
        (doc) => doc.update((root) => inject(kind, root)),
        options,
      );

      const written = await writeContent(yorkie, documentId, seed.content);
      expect(written).toBe(expectedRootHash(seed.content));

      // A separate attach sees exactly the catalogue root: nothing injected
      // survived the write.
      expect(await readContentHash(yorkie, documentId, kind)).toBe(written);
      const json = await yorkie.withDocument<string, Root>(
        documentId,
        (doc) => doc.toSortedJSON(),
        { ...options, syncMode: 'readonly' },
      );
      expect(json).not.toContain('injected');
      expect(json).not.toContain('stranger');

      // Any edit afterwards is visible to the read-back.
      await yorkie.withDocument<void, Root>(
        documentId,
        (doc) => doc.update((root) => tamper(kind, root)),
        options,
      );
      expect(await readContentHash(yorkie, documentId, kind)).not.toBe(written);

      // And a rewrite restores the catalogue root exactly.
      expect(await writeContent(yorkie, documentId, seed.content)).toBe(
        written,
      );
      expect(await readContentHash(yorkie, documentId, kind)).toBe(written);
    },
  );
});
