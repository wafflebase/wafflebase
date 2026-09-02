/**
 * Attached round-trip test for the JSON-root arm of "Make a copy"
 * (`sheet` / `slides` / `board`).
 *
 * The colocated `document-copy.service.spec.ts` stubs `YorkieService`, so the
 * snapshot it copies is a plain JS object — it never touches the root proxy
 * whose `toJSON()` returns a *string*, which is exactly what makes the
 * snapshot path non-trivial. This test attaches to a real Yorkie server (the
 * one `docker compose up -d` starts) on both ends, so the fallback chain in
 * `snapshotJsonRoot`, the comment stripping, and the Long re-coercion are
 * exercised against real CRDT values.
 *
 * Gated on `RUN_YORKIE_INTEGRATION_TESTS=true`, like
 * `docs-tree-attached.e2e-spec.ts`. Locally:
 *   docker compose up -d
 *   RUN_YORKIE_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e
 */
import { ConfigService } from '@nestjs/config';
import { YorkieService } from 'src/yorkie/yorkie.service';
import { DocumentCopyService } from 'src/document/document-copy.service';
import { snapshotJsonRoot } from 'src/yorkie/yorkie-json';

const runYorkieIntegrationTests =
  process.env.RUN_YORKIE_INTEGRATION_TESTS === 'true';
const describeAttached = runYorkieIntegrationTests ? describe : describe.skip;

type Root = Record<string, unknown>;

function createConfig(): ConfigService {
  return {
    get: (key: string): string | undefined => process.env[key],
  } as unknown as ConfigService;
}

function uniqueId(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describeAttached('document copy — JSON root arm, attached', () => {
  let yorkieService: YorkieService;

  beforeAll(() => {
    process.env.YORKIE_RPC_ADDR ??= 'http://localhost:8080';
    yorkieService = new YorkieService(createConfig());
  });

  it('copies a live sheet root: cells kept, comments dropped, Longs intact', async () => {
    const sourceId = uniqueId('copy-src');
    const targetId = uniqueId('copy-dst');

    await yorkieService.withDocument<void, Root>(
      sourceId,
      (doc) => {
        doc.update((root) => {
          const r = root as Root;
          r.tabs = { t1: { id: 't1', name: 'Sheet1' } };
          r.sheets = {
            t1: {
              cells: {
                A1: { v: 'hello' },
                // A control character Yorkie's raw JSON string path does not
                // escape: `JSON.parse(doc.toJSON())` throws on it, which is
                // what the snapshot fallback chain exists for.
                A2: { v: 'a\u0001b' },
              },
              comments: {
                'th-1': { id: 'th-1', resolved: false, comments: [] },
              },
              // Written as a Long, as the frontend writes timestamps.
              importedAt: BigInt(1_780_000_000_000) as unknown as number,
            },
          };
        });
      },
      { docKeyPrefix: 'sheet-' },
    );

    const documentService = {
      documents: jest.fn(async () => []),
      createDocument: jest.fn(async () => ({ id: targetId })),
      deleteDocument: jest.fn(async () => ({ id: targetId })),
    };
    const fileService = { copy: jest.fn(), delete: jest.fn() };
    // This copy stays inside `ws-1`, so re-hosting never runs and neither
    // dependency is reached — they are here to satisfy the constructor.
    const imageService = { copy: jest.fn(), size: jest.fn(), delete: jest.fn() };
    const config = { get: () => undefined };
    const service = new DocumentCopyService(
      documentService as never,
      fileService as never,
      yorkieService,
      imageService as never,
      config as never,
    );

    await service.copy(
      {
        id: sourceId,
        title: 'Report',
        type: 'sheet',
        workspaceId: 'ws-1',
        folderId: null,
        fileId: null,
        fileSize: null,
        mimeType: null,
        authorID: 7,
      } as never,
      42,
    );

    const copied = await yorkieService.withDocument<Root, Root>(
      targetId,
      (doc) => snapshotJsonRoot(doc),
      { docKeyPrefix: 'sheet-', syncMode: 'readonly' },
    );

    const sheets = copied.sheets as Record<string, Root>;
    expect(copied.tabs).toEqual({ t1: { id: 't1', name: 'Sheet1' } });
    expect(sheets.t1.cells).toEqual({
      A1: { v: 'hello' },
      A2: { v: 'a\u0001b' },
    });
    // The container survives (worksheets seed `comments: {}`), the threads do not.
    expect(sheets.t1.comments).toEqual({});
    // A 32-bit Integer would have decoded as a 1970 timestamp.
    expect(Number(sheets.t1.importedAt)).toBe(1_780_000_000_000);
  }, 30000);
});
