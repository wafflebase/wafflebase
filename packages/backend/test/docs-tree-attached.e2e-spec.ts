/**
 * Attached round-trip test for `writeDocsRoot` / `readDocsRoot`.
 *
 * The colocated `docs-tree.spec.ts` exercises the writer/reader pair against
 * an unattached Yorkie document, which bypasses the proxy semantics that
 * motivated the `readPageSetup` helper. This test attaches to a real Yorkie
 * server (the one started by `docker compose up -d`) so the read path goes
 * through proxy-wrapped objects and would catch a regression where a naive
 * spread re-introduces double-encoding for `pageSetup`.
 *
 * Gated on `RUN_YORKIE_INTEGRATION_TESTS=true` — distinct from
 * `RUN_DB_INTEGRATION_TESTS` because this test requires both Postgres
 * and a running Yorkie server. Locally: `docker compose up -d` brings
 * both up. In CI: the `verify-integration` job
 * (`.github/workflows/ci.yml`) runs Postgres as a service and starts
 * the Yorkie container as a background step, then sets both gates, so
 * this test runs there too. Opt in locally via:
 *   RUN_YORKIE_INTEGRATION_TESTS=true pnpm --filter @wafflebase/backend test:e2e
 */
import { ConfigService } from '@nestjs/config';
import { YorkieService } from 'src/yorkie/yorkie.service';
import {
  DocsYorkieRoot,
  readDocsRoot,
  writeDocsRoot,
} from 'src/yorkie/docs-tree';
import type { DocsDocument } from 'src/yorkie/yorkie.types';

const runYorkieIntegrationTests =
  process.env.RUN_YORKIE_INTEGRATION_TESTS === 'true';
const describeAttached = runYorkieIntegrationTests ? describe : describe.skip;

function createConfig(): ConfigService {
  return {
    get: (key: string): string | undefined => process.env[key],
  } as unknown as ConfigService;
}

function makeDoc(): DocsDocument {
  return {
    blocks: [
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [
          { text: 'Hello, ', style: {} },
          { text: 'world', style: { bold: true } },
        ],
        style: {
          alignment: 'center',
          lineHeight: 1.5,
          marginTop: 0,
          marginBottom: 8,
          textIndent: 0,
          marginLeft: 0,
        },
      },
    ],
    pageSetup: {
      paperSize: { name: 'A4', width: 595, height: 842 },
      orientation: 'portrait',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
    },
    header: {
      marginFromEdge: 36,
      blocks: [
        {
          id: 'h1',
          type: 'paragraph',
          inlines: [{ text: 'Header', style: {} }],
          style: {
            alignment: 'left',
            lineHeight: 1.5,
            marginTop: 0,
            marginBottom: 0,
            textIndent: 0,
            marginLeft: 0,
          },
        },
      ],
    },
    footer: {
      marginFromEdge: 36,
      blocks: [
        {
          id: 'f1',
          type: 'paragraph',
          inlines: [{ text: 'Footer', style: {} }],
          style: {
            alignment: 'right',
            lineHeight: 1.5,
            marginTop: 0,
            marginBottom: 0,
            textIndent: 0,
            marginLeft: 0,
          },
        },
      ],
    },
  };
}

describeAttached('docs-tree attached round-trip', () => {
  let yorkieService: YorkieService;

  beforeAll(() => {
    process.env.YORKIE_RPC_ADDR ??= 'http://localhost:8080';
    yorkieService = new YorkieService(createConfig());
  });

  it('round-trips a Document with pageSetup through an attached Yorkie document', async () => {
    const original = makeDoc();
    // Use a unique key so each run starts with an empty document.
    const documentId = `attached-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Write inside an attached doc.update block.
    await yorkieService.withDocument<void, DocsYorkieRoot>(
      documentId,
      (doc) => {
        doc.update((root) => {
          writeDocsRoot(root as DocsYorkieRoot, original);
        });
      },
      { docKeyPrefix: 'doc-' },
    );

    // Read back through a separate attach. This forces `pageSetup` to be
    // observed via the Yorkie object proxy on the new client, which would
    // double-encode under the previous spread-based reader.
    const result = await yorkieService.withDocument<DocsDocument, DocsYorkieRoot>(
      documentId,
      (doc) => readDocsRoot(doc.getRoot()),
      { docKeyPrefix: 'doc-', syncMode: 'readonly' },
    );

    expect(result).toEqual(original);

    // The HTTP layer serializes via JSON.stringify before sending to the
    // CLI. If `pageSetup` retained Yorkie proxy wrappers it would emit
    // double-encoded scalars here, so round-trip through JSON to confirm
    // the read result is plain JSON-safe data.
    const jsonRoundTrip = JSON.parse(JSON.stringify(result)) as DocsDocument;
    expect(jsonRoundTrip).toEqual(original);
  });
});
