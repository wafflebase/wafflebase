/**
 * Connector-parity suite (design doc §8): ONE set of assertions runs against
 * every reachable storage backend so parity is guaranteed without duplicated
 * tests. Matrix: storage backend × format (Iceberg / Delta) × auth mode
 * (S3 key/secret · GCS HMAC-interop · Azure connection string · local FS).
 *
 *   for backend in [ minio-s3, gcs-interop, azurite-azure, local-fs ]:
 *     - secret minting from encrypted creds succeeds (implicit in every read)
 *     - read N rows (matches the manifest's latest row set)
 *     - history length == fixture commit count, ordered oldest→newest
 *     - asOf(commit K) returns the historical row set for every K
 *
 * Real-cloud fidelity: point LAKEHOUSE_MINIO_ENDPOINT at any real
 * S3-compatible endpoint (R2 / B2 / S3) with matching credentials and set
 * ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED=true — the same minio-s3 leg then runs
 * unchanged against the real service (design §8's opt-in cloud smoke).
 *
 * The Iceberg fixture embeds absolute URIs, so the az/gs legs read a
 * seed-time rewritten copy (see rewriteFixtureFile); Delta embeds only
 * relative paths and is byte-identical across all legs.
 */
import { LakehouseSource } from '@prisma/client';
import { resolve } from 'node:path';
import { PrismaService } from 'src/database/prisma.service';
import { encrypt } from 'src/datasource/crypto.util';
import { DuckDbService } from 'src/lakehouse/duckdb.service';
import { LakehouseService } from 'src/lakehouse/lakehouse.service';
import {
  LakehouseHistoryEntry,
  LakehouseQueryResponse,
} from 'src/lakehouse/lakehouse.types';
import {
  LakehouseFixtureManifest,
  LAKEHOUSE_GCS_FIXTURE_BUCKET,
  assertSafeFixtureEndpoint,
  lakehouseAzuriteConfig,
  lakehouseMinioConfig,
  readLakehouseFixtureManifest,
  seedAzuriteFixtures,
  seedGcsInteropFixtures,
  seedLakehouseFixtures,
} from './helpers/lakehouse-fixtures';
import { TEST_ENCRYPTION_KEY } from './helpers/integration-helpers';

const describeLakehouse =
  process.env.RUN_LAKEHOUSE_INTEGRATION_TESTS === 'true'
    ? describe
    : describe.skip;

jest.setTimeout(180_000);

describe('Lakehouse fixture seed safety', () => {
  it('requires an explicit opt-in for non-loopback endpoints', () => {
    const previous = process.env.ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED;
    delete process.env.ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED;
    try {
      expect(() =>
        assertSafeFixtureEndpoint('https://object-storage.example.com'),
      ).toThrow('Refusing to seed a non-loopback object store');

      process.env.ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED = 'true';
      expect(() =>
        assertSafeFixtureEndpoint('https://object-storage.example.com'),
      ).not.toThrow();
    } finally {
      if (previous === undefined) {
        delete process.env.ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED;
      } else {
        process.env.ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED = previous;
      }
    }
  });
});

type LakehouseFormat = 'iceberg' | 'delta';

type ParityLeg = {
  name: string;
  formats: readonly LakehouseFormat[];
  seed: () => Promise<unknown>;
  source: (
    format: LakehouseFormat,
    manifest: LakehouseFixtureManifest,
  ) => LakehouseSource;
};

const FIXTURE_ROOT = resolve(__dirname, 'fixtures/lakehouse');

function baseSource(
  overrides: Partial<LakehouseSource> & Pick<LakehouseSource, 'id' | 'format'>,
): LakehouseSource {
  return {
    name: overrides.id,
    storage: 's3-compatible',
    endpoint: null,
    region: null,
    bucket: null,
    basePath: null,
    catalogMode: 'direct_metadata',
    catalogUri: null,
    credentials: encrypt(JSON.stringify({})),
    authorID: 1,
    workspaceId: 'lakehouse-parity-workspace',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function buildLegs(): ParityLeg[] {
  const minio = lakehouseMinioConfig();
  const azurite = lakehouseAzuriteConfig();
  const s3Credentials = encrypt(
    JSON.stringify({
      accessKeyId: minio.accessKeyId,
      secretAccessKey: minio.secretAccessKey,
    }),
  );

  const legs: ParityLeg[] = [
    {
      name: 'minio-s3',
      formats: ['iceberg', 'delta'],
      seed: () => seedLakehouseFixtures(minio),
      source: (format, manifest) =>
        baseSource({
          id: `minio-s3-${format}`,
          format,
          storage: 's3-compatible',
          endpoint: minio.endpoint,
          region: minio.region,
          bucket: minio.bucket,
          basePath:
            format === 'iceberg'
              ? manifest.iceberg.currentMetadataKey
              : 'delta-events',
          credentials: s3Credentials,
        }),
    },
    {
      name: 'gcs-interop',
      formats: ['iceberg', 'delta'],
      seed: () => seedGcsInteropFixtures(minio),
      source: (format, manifest) =>
        baseSource({
          id: `gcs-interop-${format}`,
          format,
          storage: 'gcs',
          endpoint: minio.endpoint,
          basePath:
            format === 'iceberg'
              ? `gs://${LAKEHOUSE_GCS_FIXTURE_BUCKET}/${manifest.iceberg.currentMetadataKey}`
              : `gs://${LAKEHOUSE_GCS_FIXTURE_BUCKET}/delta-events`,
          credentials: s3Credentials,
        }),
    },
    {
      name: 'local-fs',
      // The committed Iceberg fixture embeds object-store URIs; the local leg
      // covers the relocatable Delta format plus the path-confinement plumbing.
      formats: ['delta'],
      seed: () => Promise.resolve(),
      source: (format) =>
        baseSource({
          id: `local-fs-${format}`,
          format,
          storage: 'local',
          basePath: resolve(FIXTURE_ROOT, 'delta-events'),
          credentials: encrypt(JSON.stringify({})),
        }),
    },
  ];

  if (azurite) {
    legs.push({
      name: 'azurite-azure',
      formats: ['iceberg', 'delta'],
      seed: () => seedAzuriteFixtures(azurite),
      source: (format, manifest) =>
        baseSource({
          id: `azurite-azure-${format}`,
          format,
          storage: 'azure',
          basePath:
            format === 'iceberg'
              ? `az://${azurite.container}/${manifest.iceberg.currentMetadataKey}`
              : `az://${azurite.container}/delta-events`,
          credentials: encrypt(
            JSON.stringify({ connectionString: azurite.connectionString }),
          ),
        }),
    });
  }
  return legs;
}

function fixtureRows(result: LakehouseQueryResponse): string[] {
  return result.rows
    .map((row) => `${String(row.id)}:${String(row.value)}`)
    .sort();
}

function expectedRows(
  rows: LakehouseFixtureManifest['rowsByCommit'][number],
): string[] {
  return rows.map(({ id, value }) => `${id}:${value}`).sort();
}

describeLakehouse('Lakehouse connector parity', () => {
  // buildLegs() encrypts credentials at collection time, before beforeAll
  // runs, so the key default has to be in place here as well.
  process.env.DATASOURCE_ENCRYPTION_KEY ??= TEST_ENCRYPTION_KEY;
  const legs = buildLegs();
  let duckDb: DuckDbService;
  let service: LakehouseService;
  let manifest: LakehouseFixtureManifest;
  // Jest reuses a worker across spec files, so every variable set below is
  // snapshotted here and restored in afterAll; otherwise a later suite could
  // inherit LAKEHOUSE_ALLOW_LOCAL_PATHS=true and pass a test that should fail.
  const overriddenEnv = [
    'LAKEHOUSE_DUCKDB_POOL_SIZE',
    'LAKEHOUSE_DUCKDB_MEMORY_LIMIT',
    'LAKEHOUSE_ALLOW_LOCAL_PATHS',
    'LAKEHOUSE_LOCAL_ROOT',
    'LAKEHOUSE_ALLOWED_ENDPOINTS',
  ] as const;
  const previousEnv = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const key of overriddenEnv) previousEnv.set(key, process.env[key]);
    process.env.LAKEHOUSE_DUCKDB_POOL_SIZE = '1';
    process.env.LAKEHOUSE_DUCKDB_MEMORY_LIMIT = '256MB';
    process.env.LAKEHOUSE_ALLOW_LOCAL_PATHS = 'true';
    process.env.LAKEHOUSE_LOCAL_ROOT = FIXTURE_ROOT;
    // Every custom endpoint the legs dial must be allowlisted, mirroring prod.
    process.env.LAKEHOUSE_ALLOWED_ENDPOINTS = [
      lakehouseMinioConfig().endpoint,
      ...(lakehouseAzuriteConfig() ? [lakehouseAzuriteConfig()!.endpoint] : []),
    ].join(',');

    manifest = await readLakehouseFixtureManifest();
    for (const leg of legs) await leg.seed();

    const sources = new Map<string, LakehouseSource>();
    for (const leg of legs) {
      for (const format of leg.formats) {
        const source = leg.source(format, manifest);
        sources.set(source.id, source);
      }
    }
    sources.set(
      'missing-delta',
      baseSource({
        id: 'missing-delta',
        format: 'delta',
        storage: 's3-compatible',
        endpoint: lakehouseMinioConfig().endpoint,
        region: lakehouseMinioConfig().region,
        bucket: lakehouseMinioConfig().bucket,
        basePath: 'missing-delta-events',
        credentials: encrypt(
          JSON.stringify({
            accessKeyId: lakehouseMinioConfig().accessKeyId,
            secretAccessKey: lakehouseMinioConfig().secretAccessKey,
          }),
        ),
      }),
    );

    const prisma = {
      lakehouseSource: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(sources.get(where.id) ?? null),
        ),
      },
    } as unknown as PrismaService;

    duckDb = new DuckDbService();
    service = new LakehouseService(prisma, duckDb);
  });

  afterAll(async () => {
    await duckDb?.onModuleDestroy();
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const cases = legs.flatMap((leg) =>
    leg.formats.map((format) => [leg.name, format] as const),
  );

  // A "connector-parity" suite that quietly drops a backend is worse than no
  // suite: `legs` is built from the environment, so losing
  // LAKEHOUSE_AZURITE_ENDPOINT (a merge in the CI env block, a local run
  // without it) removes the only leg that loads DuckDB's azure extension and
  // exercises connection-string auth — and jest reports green with two fewer
  // test names and zero skips. Name the expected matrix so a missing backend
  // fails loudly instead of shrinking the matrix.
  it('covers every storage backend the parity matrix names', () => {
    const realized = new Set(legs.map((leg) => leg.name));
    const missing = [
      'minio-s3',
      'gcs-interop',
      'azurite-azure',
      'local-fs',
    ].filter((name) => !realized.has(name));

    expect({
      missing,
      hint:
        missing.length > 0
          ? 'Start the emulators (docker compose up -d minio azurite) and set ' +
            'LAKEHOUSE_AZURITE_ENDPOINT=http://127.0.0.1:10000/devstoreaccount1'
          : 'none',
    }).toEqual({ missing: [], hint: 'none' });
  });

  it.each(cases)(
    '%s: reads the latest %s snapshot',
    async (legName, format) => {
      const expected = manifest.rowsByCommit[manifest.rowsByCommit.length - 1];
      const result = await service.read(`${legName}-${format}`, {});

      expect(result.rowCount).toBe(expected.length);
      expect(result.truncated).toBe(false);
      expect(fixtureRows(result)).toEqual(expectedRows(expected));
    },
  );

  it.each(cases)(
    '%s: returns the ordered %s fixture history',
    async (legName, format) => {
      const history = await service.history(`${legName}-${format}`);
      const expectedRefs =
        format === 'iceberg'
          ? manifest.iceberg.snapshotIds.map((snapshotId) => ({
              kind: 'snapshot' as const,
              snapshotId,
            }))
          : manifest.delta.versions.map((version) => ({
              kind: 'version' as const,
              version,
            }));

      expect(history.map(({ ref }) => ref)).toEqual(expectedRefs);
      const timestamps = history.map(({ timestamp }) =>
        Date.parse(timestamp ?? ''),
      );
      expect(timestamps.every(Number.isFinite)).toBe(true);
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    },
  );

  it.each(cases)(
    '%s: reads every historical %s commit',
    async (legName, format) => {
      const id = `${legName}-${format}`;
      const history: LakehouseHistoryEntry[] = await service.history(id);

      for (const [index, entry] of history.entries()) {
        const result = await service.read(id, { asOf: entry.ref });
        expect(fixtureRows(result)).toEqual(
          expectedRows(manifest.rowsByCommit[index]),
        );
      }
    },
  );

  it('resolves a timestamp asOf to the commit at or before it', async () => {
    const history = await service.history('minio-s3-delta');
    // Query exactly at the middle commit's instant → that commit's rows.
    const middle = history[1];
    const result = await service.read('minio-s3-delta', {
      asOf: { kind: 'timestamp', iso: middle.timestamp as string },
    });
    expect(fixtureRows(result)).toEqual(expectedRows(manifest.rowsByCommit[1]));
  });

  it('removes temporary secrets after success and query failure', async () => {
    await service.read('minio-s3-delta', {});
    await expect(service.read('missing-delta', {})).rejects.toBeDefined();

    const secrets = await duckDb.withConnection((connection) =>
      duckDb.queryRows(connection, {
        sql: "SELECT name FROM duckdb_secrets() WHERE name LIKE 'lakehouse_%'",
        values: [],
      }),
    );
    expect(secrets).toEqual([]);
  });
});
