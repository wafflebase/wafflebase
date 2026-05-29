/**
 * Attached round-trip test for inline font styles (`fontFamily`,
 * `fontSize`, `color`).
 *
 * Mirrors `docs-tree-attached.e2e-spec.ts`: writes a `DocsDocument`
 * through `writeDocsRoot` inside an attached Yorkie document, then
 * reads it back through a separate attach with `syncMode: 'readonly'`
 * and asserts the result deep-equals the original. The companion
 * regression test for `clearFormatting` (i.e. that `applyStyle` with
 * explicit `undefined` values tears attributes off the Yorkie Tree
 * node, not just the in-memory cache) lives in the frontend
 * `yorkie-doc-store.test.ts` because it operates at the
 * `YorkieDocStore` level and doesn't need a running Yorkie server.
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
          { text: 'Roboto 18 ', style: { fontFamily: 'Roboto', fontSize: 18 } },
          {
            text: 'Noto KR 14 red bold',
            style: {
              fontFamily: 'Noto Sans KR',
              fontSize: 14,
              color: '#ff0000',
              bold: true,
            },
          },
        ],
        style: {
          alignment: 'left',
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

describeAttached('docs-tree attached font styles round-trip', () => {
  let yorkieService: YorkieService;

  beforeAll(() => {
    process.env.YORKIE_RPC_ADDR ??= 'http://localhost:8080';
    yorkieService = new YorkieService(createConfig());
  });

  it('round-trips fontFamily / fontSize / color through an attached Yorkie document', async () => {
    const original = makeDoc();
    // Use a unique key so each run starts with an empty document.
    const documentId = `attached-font-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

    // Read back through a separate attach so the read path goes through
    // proxy-wrapped objects on a fresh client — would catch a regression
    // where font style attrs are dropped or double-encoded across the
    // Yorkie boundary.
    const result = await yorkieService.withDocument<DocsDocument, DocsYorkieRoot>(
      documentId,
      (doc) => readDocsRoot(doc.getRoot()),
      { docKeyPrefix: 'doc-', syncMode: 'readonly' },
    );

    expect(result).toEqual(original);

    // JSON round-trip to confirm no Yorkie proxy wrappers leaked into
    // the read result (mirrors the pageSetup regression check in
    // docs-tree-attached.e2e-spec.ts).
    const jsonRoundTrip = JSON.parse(JSON.stringify(result)) as DocsDocument;
    expect(jsonRoundTrip).toEqual(original);
  });
});
