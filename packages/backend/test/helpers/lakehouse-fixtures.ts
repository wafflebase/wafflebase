import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { relative, resolve, sep } from 'node:path';

export const LAKEHOUSE_FIXTURE_BUCKET = 'lakehouse-fixtures';
export const LAKEHOUSE_FIXTURE_ACCESS_KEY = 'minioadmin';
export const LAKEHOUSE_FIXTURE_SECRET_KEY = 'minioadmin';
export const LAKEHOUSE_FIXTURE_REGION = 'us-east-1';

const FIXTURE_PREFIXES = ['iceberg', 'delta-events'] as const;
const FIXTURE_ROOT = resolve(__dirname, '../fixtures/lakehouse');

export type LakehouseMinioConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export type LakehouseFixtureManifest = {
  schemaVersion: 1;
  iceberg: {
    currentMetadataKey: string;
    snapshotIds: string[];
  };
  delta: {
    versions: number[];
  };
  rowsByCommit: Array<Array<{ id: number; value: string }>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function invalidManifest(message: string): never {
  throw new Error(`Invalid Lakehouse fixture manifest: ${message}`);
}

export async function readLakehouseFixtureManifest(): Promise<LakehouseFixtureManifest> {
  const value: unknown = JSON.parse(
    await readFile(resolve(FIXTURE_ROOT, 'fixture-manifest.json'), 'utf8'),
  );
  if (!isRecord(value) || value.schemaVersion !== 1) {
    invalidManifest('schemaVersion must be 1');
  }

  const iceberg = value.iceberg;
  if (
    !isRecord(iceberg) ||
    typeof iceberg.currentMetadataKey !== 'string' ||
    !iceberg.currentMetadataKey.startsWith('iceberg/') ||
    !iceberg.currentMetadataKey.endsWith('.metadata.json') ||
    !Array.isArray(iceberg.snapshotIds) ||
    iceberg.snapshotIds.length < 3 ||
    !iceberg.snapshotIds.every(
      (snapshotId) =>
        typeof snapshotId === 'string' && /^(0|[1-9][0-9]*)$/.test(snapshotId),
    ) ||
    new Set(iceberg.snapshotIds).size !== iceberg.snapshotIds.length
  ) {
    invalidManifest('Iceberg metadata key or snapshot IDs are malformed');
  }

  const delta = value.delta;
  if (
    !isRecord(delta) ||
    !Array.isArray(delta.versions) ||
    delta.versions.length < 3 ||
    !delta.versions.every(
      (version, index, versions) =>
        typeof version === 'number' &&
        Number.isSafeInteger(version) &&
        version >= 0 &&
        (index === 0 || (versions[index - 1] as number) < version),
    )
  ) {
    invalidManifest('Delta versions must be increasing non-negative integers');
  }

  const rowsByCommit = value.rowsByCommit;
  if (
    !Array.isArray(rowsByCommit) ||
    rowsByCommit.length !== iceberg.snapshotIds.length ||
    rowsByCommit.length !== delta.versions.length ||
    !rowsByCommit.every(
      (rows) =>
        Array.isArray(rows) &&
        rows.every(
          (row) =>
            isRecord(row) &&
            typeof row.id === 'number' &&
            Number.isSafeInteger(row.id) &&
            typeof row.value === 'string',
        ),
    )
  ) {
    invalidManifest('rowsByCommit must match both history lengths');
  }

  return value as LakehouseFixtureManifest;
}

export function lakehouseMinioConfig(): LakehouseMinioConfig {
  return {
    endpoint: process.env.LAKEHOUSE_MINIO_ENDPOINT ?? 'http://127.0.0.1:9000',
    // Iceberg manifests embed this bucket URI, so it is part of the fixture
    // contract rather than a runtime override.
    bucket: LAKEHOUSE_FIXTURE_BUCKET,
    accessKeyId:
      process.env.LAKEHOUSE_MINIO_ACCESS_KEY ?? LAKEHOUSE_FIXTURE_ACCESS_KEY,
    secretAccessKey:
      process.env.LAKEHOUSE_MINIO_SECRET_KEY ?? LAKEHOUSE_FIXTURE_SECRET_KEY,
    region: process.env.LAKEHOUSE_MINIO_REGION ?? LAKEHOUSE_FIXTURE_REGION,
  };
}

export function assertSafeFixtureEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('Lakehouse fixture endpoint must be an HTTP(S) origin');
  }

  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    !parsed.hostname ||
    !['', '/'].includes(parsed.pathname) ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('Lakehouse fixture endpoint must be an HTTP(S) origin');
  }

  const hostname = parsed.hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();
  const loopback =
    hostname === 'localhost' ||
    hostname === '::1' ||
    (isIP(hostname) === 4 && hostname.startsWith('127.'));
  if (!loopback && process.env.ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED !== 'true') {
    throw new Error(
      'Refusing to seed a non-loopback object store. Set ' +
        'ALLOW_REMOTE_LAKEHOUSE_FIXTURE_SEED=true only for an explicitly ' +
        'approved disposable fixture target.',
    );
  }
}

function createClient(config: LakehouseMinioConfig): S3Client {
  assertSafeFixtureEndpoint(config.endpoint);
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error: unknown) {
    const status =
      isRecord(error) && isRecord(error.$metadata)
        ? error.$metadata.httpStatusCode
        : undefined;
    const name = isRecord(error) ? error.name : undefined;
    if (status !== 404 && name !== 'NotFound' && name !== 'NoSuchBucket') {
      throw error;
    }
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function fixtureFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = resolve(directory, name);
    if ((await stat(path)).isDirectory()) {
      files.push(...(await fixtureFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

/**
 * Overwrites the complete, immutable fixture object set without listing or
 * deleting unrelated objects in a developer's MinIO bucket.
 */
export async function seedLakehouseFixtures(
  config = lakehouseMinioConfig(),
): Promise<number> {
  const client = createClient(config);
  try {
    await ensureBucket(client, config.bucket);

    let uploaded = 0;
    for (const prefix of FIXTURE_PREFIXES) {
      const directory = resolve(FIXTURE_ROOT, prefix);
      for (const path of await fixtureFiles(directory)) {
        const key = relative(FIXTURE_ROOT, path).split(sep).join('/');
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: await readFile(path),
          }),
        );
        uploaded += 1;
      }
    }
    return uploaded;
  } finally {
    client.destroy();
  }
}

// ---------------------------------------------------------------------------
// Cross-scheme fixture relocation (connector-parity suite)
//
// The committed Iceberg fixture embeds absolute `s3://lakehouse-fixtures/…`
// URIs in its metadata JSON and inside the deflate-compressed avro manifest
// blocks. Rather than committing near-identical fixture trees per storage
// scheme, seeding rewrites those URIs to a SAME-LENGTH scheme + bucket
// (`az://lakehouse-fixturaz`, `gs://lakehouse-fixturgs`): avro strings are
// length-prefixed, so an equal-length swap keeps every offset valid, and the
// deflate blocks are re-compressed with their size varint rewritten. Delta
// fixtures embed only relative paths and need no rewriting.
// ---------------------------------------------------------------------------

import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const LAKEHOUSE_SOURCE_URI_PREFIX = `s3://${LAKEHOUSE_FIXTURE_BUCKET}`;

export type LakehouseFixtureScheme = {
  scheme: 's3' | 'az' | 'gs';
  bucket: string;
};

export const LAKEHOUSE_AZURE_FIXTURE_BUCKET = 'lakehouse-fixturaz';
export const LAKEHOUSE_GCS_FIXTURE_BUCKET = 'lakehouse-fixturgs';

function targetUriPrefix(target: LakehouseFixtureScheme): string {
  const prefix = `${target.scheme}://${target.bucket}`;
  if (prefix.length !== LAKEHOUSE_SOURCE_URI_PREFIX.length) {
    throw new Error(
      'Fixture URI rewrites must preserve byte length for avro offsets',
    );
  }
  return prefix;
}

function replaceAllBytes(
  content: Buffer,
  search: Buffer,
  replacement: Buffer,
): Buffer {
  if (search.length !== replacement.length) {
    throw new Error('Byte replacement must preserve length');
  }
  const result = Buffer.from(content);
  let offset = 0;
  for (;;) {
    const index = result.indexOf(search, offset);
    if (index === -1) return result;
    replacement.copy(result, index);
    offset = index + search.length;
  }
}

/** Reads one avro zigzag-encoded long; returns the value and bytes consumed. */
function readZigZagLong(buffer: Buffer, offset: number): [number, number] {
  let result = 0n;
  let shift = 0n;
  let consumed = 0;
  for (;;) {
    const byte = buffer[offset + consumed];
    if (byte === undefined) throw new Error('Truncated avro varint');
    consumed += 1;
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  const value = (result >> 1n) ^ -(result & 1n);
  return [Number(value), consumed];
}

function writeZigZagLong(value: number): Buffer {
  let encoded = (BigInt(value) << 1n) ^ (BigInt(value) >> 63n);
  const bytes: number[] = [];
  for (;;) {
    const byte = Number(encoded & 0x7fn);
    encoded >>= 7n;
    if (encoded === 0n) {
      bytes.push(byte);
      return Buffer.from(bytes);
    }
    bytes.push(byte | 0x80);
  }
}

/**
 * Rewrites the embedded fixture URIs of one avro object-container file whose
 * blocks use the `deflate` codec (what PyIceberg wrote for this fixture).
 */
export function rewriteAvroFixture(
  content: Buffer,
  target: LakehouseFixtureScheme,
): Buffer {
  const search = Buffer.from(LAKEHOUSE_SOURCE_URI_PREFIX);
  const replacement = Buffer.from(targetUriPrefix(target));
  if (content.subarray(0, 4).toString('latin1') !== 'Obj\x01') {
    throw new Error('Not an avro object container file');
  }

  // Header: file metadata map (count-prefixed key/value blocks, 0-terminated),
  // then the 16-byte sync marker. Keys/values are length-prefixed, so the
  // header can be skipped without decoding the schema.
  let offset = 4;
  for (;;) {
    const [count, consumed] = readZigZagLong(content, offset);
    offset += consumed;
    if (count === 0) break;
    const entries = Math.abs(count);
    if (count < 0) {
      // Negative count is followed by a byte size we do not need.
      const [, sizeConsumed] = readZigZagLong(content, offset);
      offset += sizeConsumed;
    }
    for (let i = 0; i < entries * 2; i += 1) {
      const [length, lengthConsumed] = readZigZagLong(content, offset);
      offset += lengthConsumed + length;
    }
  }
  const headerEnd = offset + 16;
  const parts: Buffer[] = [content.subarray(0, headerEnd)];
  const sync = content.subarray(offset, headerEnd);

  offset = headerEnd;
  while (offset < content.length) {
    const [objectCount, countConsumed] = readZigZagLong(content, offset);
    offset += countConsumed;
    const [blockSize, sizeConsumed] = readZigZagLong(content, offset);
    offset += sizeConsumed;
    const compressed = content.subarray(offset, offset + blockSize);
    offset += blockSize;
    const rewritten = deflateRawSync(
      replaceAllBytes(inflateRawSync(compressed), search, replacement),
    );
    parts.push(
      writeZigZagLong(objectCount),
      writeZigZagLong(rewritten.length),
      rewritten,
      Buffer.from(sync),
    );
    if (!content.subarray(offset, offset + 16).equals(sync)) {
      throw new Error('Avro block sync marker mismatch');
    }
    offset += 16;
  }
  return Buffer.concat(parts);
}

/** Rewrites one fixture file for the target scheme; non-Iceberg bytes pass through. */
export function rewriteFixtureFile(
  key: string,
  content: Buffer,
  target: LakehouseFixtureScheme,
): Buffer {
  if (target.scheme === 's3' && target.bucket === LAKEHOUSE_FIXTURE_BUCKET) {
    return content;
  }
  if (key.endsWith('.metadata.json')) {
    return Buffer.from(
      content
        .toString('utf8')
        .replaceAll(LAKEHOUSE_SOURCE_URI_PREFIX, targetUriPrefix(target)),
      'utf8',
    );
  }
  if (key.endsWith('.avro')) {
    return rewriteAvroFixture(content, target);
  }
  return content;
}

// ---------------------------------------------------------------------------
// Azurite seeding (azure parity leg)
// ---------------------------------------------------------------------------

export const AZURITE_ACCOUNT = 'devstoreaccount1';
/** Azurite's fixed, publicly documented development-storage key. */
export const AZURITE_ACCOUNT_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

export type LakehouseAzuriteConfig = {
  /** Blob endpoint including the account path, e.g. http://127.0.0.1:10000/devstoreaccount1 */
  endpoint: string;
  container: string;
  connectionString: string;
};

export function lakehouseAzuriteConfig(): LakehouseAzuriteConfig | undefined {
  const endpoint = process.env.LAKEHOUSE_AZURITE_ENDPOINT;
  if (!endpoint) return undefined;
  return {
    endpoint,
    container: LAKEHOUSE_AZURE_FIXTURE_BUCKET,
    connectionString: [
      'DefaultEndpointsProtocol=http',
      `AccountName=${AZURITE_ACCOUNT}`,
      `AccountKey=${AZURITE_ACCOUNT_KEY}`,
      `BlobEndpoint=${endpoint}`,
    ].join(';'),
  };
}

/** Uploads the fixture set into Azurite with URIs rewritten to az://. */
export async function seedAzuriteFixtures(
  config: LakehouseAzuriteConfig,
): Promise<number> {
  assertSafeFixtureEndpoint(new URL(config.endpoint).origin);
  // Loaded lazily so the S3-only paths never require the Azure SDK.
  const { BlobServiceClient } = await import('@azure/storage-blob');
  const service = BlobServiceClient.fromConnectionString(
    config.connectionString,
  );
  const container = service.getContainerClient(config.container);
  await container.createIfNotExists();

  const target: LakehouseFixtureScheme = {
    scheme: 'az',
    bucket: config.container,
  };
  let uploaded = 0;
  for (const prefix of FIXTURE_PREFIXES) {
    const directory = resolve(FIXTURE_ROOT, prefix);
    for (const path of await fixtureFiles(directory)) {
      const key = relative(FIXTURE_ROOT, path).split(sep).join('/');
      const content = rewriteFixtureFile(key, await readFile(path), target);
      await container
        .getBlockBlobClient(key)
        .uploadData(content, { blobHTTPHeaders: {} });
      uploaded += 1;
    }
  }
  return uploaded;
}

/** Uploads the fixture set into a second MinIO bucket with gs:// URIs (GCS-interop leg). */
export async function seedGcsInteropFixtures(
  config = lakehouseMinioConfig(),
): Promise<number> {
  const client = createClient(config);
  const bucket = LAKEHOUSE_GCS_FIXTURE_BUCKET;
  const target: LakehouseFixtureScheme = { scheme: 'gs', bucket };
  try {
    await ensureBucket(client, bucket);
    let uploaded = 0;
    for (const prefix of FIXTURE_PREFIXES) {
      const directory = resolve(FIXTURE_ROOT, prefix);
      for (const path of await fixtureFiles(directory)) {
        const key = relative(FIXTURE_ROOT, path).split(sep).join('/');
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: rewriteFixtureFile(key, await readFile(path), target),
          }),
        );
        uploaded += 1;
      }
    }
    return uploaded;
  } finally {
    client.destroy();
  }
}
