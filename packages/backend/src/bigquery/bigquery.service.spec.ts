import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BigQueryDate, BigQueryTimestamp } from '@google-cloud/bigquery';
import { PrismaService } from 'src/database/prisma.service';
import { encrypt } from '../datasource/crypto.util';
import { BigQueryService } from './bigquery.service';

const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const CREDENTIALS_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'my-project',
  client_email: 'sa@my-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
});

function createMockPrisma() {
  return {
    bigQuerySource: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function createMockBigQueryClient() {
  return {
    createQueryJob: jest.fn().mockResolvedValue([{}, {}]),
  };
}

function createMockJob(
  rows: unknown[],
  apiResponse: { schema?: { fields?: Array<{ name: string; type: string }> } },
) {
  return {
    getQueryResults: jest
      .fn()
      .mockResolvedValue([rows, undefined, apiResponse]),
  };
}

describe('BigQueryService', () => {
  let service: BigQueryService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    process.env.DATASOURCE_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    prisma = createMockPrisma();
    service = new BigQueryService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('encrypts credentials and converts maximumBytesBilled to BigInt when creating', async () => {
    prisma.bigQuerySource.create.mockResolvedValue({ id: 'bq-1' });

    await service.create(7, 'ws-1', {
      name: 'analytics',
      projectId: 'my-project',
      dataset: 'analytics',
      location: 'US',
      credentials: CREDENTIALS_JSON,
      maximumBytesBilled: 5_000_000_000,
    });

    const createArg = prisma.bigQuerySource.create.mock.calls[0][0];

    expect(createArg.data.authorID).toBe(7);
    expect(createArg.data.workspaceId).toBe('ws-1');
    expect(createArg.data.credentials).not.toBe(CREDENTIALS_JSON);
    expect((createArg.data.credentials as string).split(':')).toHaveLength(3);
    expect(createArg.data.maximumBytesBilled).toBe(5_000_000_000n);
  });

  it('creates without an optional maximumBytesBilled ceiling', async () => {
    prisma.bigQuerySource.create.mockResolvedValue({ id: 'bq-1' });

    await service.create(7, 'ws-1', {
      name: 'analytics',
      projectId: 'my-project',
      credentials: CREDENTIALS_JSON,
    });

    const createArg = prisma.bigQuerySource.create.mock.calls[0][0];
    expect(createArg.data.maximumBytesBilled).toBeUndefined();
  });

  it('stores an explicit null maximumBytesBilled as null on create, without crashing', async () => {
    prisma.bigQuerySource.create.mockResolvedValue({ id: 'bq-1' });

    await service.create(7, 'ws-1', {
      name: 'analytics',
      projectId: 'my-project',
      credentials: CREDENTIALS_JSON,
      maximumBytesBilled: null,
    });

    const createArg = prisma.bigQuerySource.create.mock.calls[0][0];
    expect(createArg.data.maximumBytesBilled).toBeNull();
  });

  it('clears an existing maximumBytesBilled ceiling when update sets it to null', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue({
      id: 'bq-1',
      maximumBytesBilled: 5_000_000_000n,
    });
    prisma.bigQuerySource.update.mockResolvedValue({ id: 'bq-1' });

    await service.update('bq-1', { maximumBytesBilled: null });

    const updateArg = prisma.bigQuerySource.update.mock.calls[0][0];
    expect(updateArg.data.maximumBytesBilled).toBeNull();
  });

  it('leaves the maximumBytesBilled ceiling untouched when update omits it', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue({
      id: 'bq-1',
      maximumBytesBilled: 5_000_000_000n,
    });
    prisma.bigQuerySource.update.mockResolvedValue({ id: 'bq-1' });

    await service.update('bq-1', { name: 'renamed' });

    const updateArg = prisma.bigQuerySource.update.mock.calls[0][0];
    expect(updateArg.data.maximumBytesBilled).toBeUndefined();
  });

  it('masks credentials and converts maximumBytesBilled back to a Number in findAllByWorkspace', async () => {
    prisma.bigQuerySource.findMany.mockResolvedValue([
      {
        id: 'bq-1',
        credentials: 'encrypted',
        authorID: 7,
        workspaceId: 'ws-1',
        maximumBytesBilled: 5_000_000_000n,
      },
    ]);

    const results = await service.findAllByWorkspace('ws-1');

    expect(results).toEqual([
      {
        id: 'bq-1',
        credentials: '********',
        authorID: 7,
        workspaceId: 'ws-1',
        maximumBytesBilled: 5_000_000_000,
      },
    ]);
    expect(prisma.bigQuerySource.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('reports a null maximumBytesBilled as null, not NaN', async () => {
    prisma.bigQuerySource.findMany.mockResolvedValue([
      {
        id: 'bq-1',
        credentials: 'encrypted',
        authorID: 7,
        workspaceId: 'ws-1',
        maximumBytesBilled: null,
      },
    ]);

    const [result] = await service.findAllByWorkspace('ws-1');
    expect(result.maximumBytesBilled).toBeNull();
  });

  it('throws not found when the source does not exist', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue(null);

    await expect(service.findOne('bq-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('tests unsaved settings without touching persistence', async () => {
    const client = createMockBigQueryClient();
    const createClient = jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    const result = await service.testConfig({
      projectId: 'my-project',
      dataset: 'analytics',
      location: 'US',
      credentials: CREDENTIALS_JSON,
    });

    expect(result).toEqual({ success: true });
    expect(client.createQueryJob).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'SELECT 1', dryRun: true }),
    );
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'my-project',
        dataset: 'analytics',
        location: 'US',
        plaintextCredentials: CREDENTIALS_JSON,
      }),
    );

    expect(prisma.bigQuerySource.create).not.toHaveBeenCalled();
    expect(prisma.bigQuerySource.findUnique).not.toHaveBeenCalled();
    expect(prisma.bigQuerySource.findMany).not.toHaveBeenCalled();
    expect(prisma.bigQuerySource.update).not.toHaveBeenCalled();
    expect(prisma.bigQuerySource.delete).not.toHaveBeenCalled();
  });

  it('hands the client the decrypted credentials for a saved source', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue({
      id: 'bq-1',
      authorID: 7,
      projectId: 'my-project',
      dataset: 'analytics',
      location: 'US',
      credentials: encrypt(CREDENTIALS_JSON),
      maximumBytesBilled: null,
    });

    const client = createMockBigQueryClient();
    const createClient = jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    await service.testConnection('bq-1');

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ plaintextCredentials: CREDENTIALS_JSON }),
    );
  });

  it('reports the cause of a failed connection', async () => {
    const client = createMockBigQueryClient();
    client.createQueryJob.mockRejectedValue(
      new Error('Could not load the default credentials'),
    );

    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    const result = await service.testConfig({
      projectId: 'my-project',
      credentials: CREDENTIALS_JSON,
    });

    expect(result).toEqual({
      success: false,
      error: 'Could not load the default credentials',
    });
  });

  it('unwraps a grouped Google API error into a readable reason', async () => {
    const client = createMockBigQueryClient();
    const apiError = new Error('') as Error & {
      errors: Array<{ message: string }>;
    };
    apiError.errors = [
      { message: 'Access Denied: Project my-project' },
      { message: 'Access Denied: Project my-project' },
    ];
    client.createQueryJob.mockRejectedValue(apiError);

    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    const result = await service.testConfig({
      projectId: 'my-project',
      credentials: CREDENTIALS_JSON,
    });

    expect(result).toEqual({
      success: false,
      error: 'Access Denied: Project my-project',
    });
  });

  it('rejects invalid SQL before touching persistence', async () => {
    await expect(
      service.executeQuery('bq-1', { query: 'DELETE FROM users' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.bigQuerySource.findUnique).not.toHaveBeenCalled();
  });

  it('throws not found when the source does not exist', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue(null);

    await expect(
      service.executeQuery('bq-1', { query: 'SELECT 1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('wraps the query with a limit, passes cost/location settings, and maps the schema', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue({
      id: 'bq-1',
      projectId: 'my-project',
      dataset: 'analytics',
      location: 'US',
      credentials: encrypt(CREDENTIALS_JSON),
      maximumBytesBilled: 5_000_000_000n,
    });

    const rows = Array.from({ length: 10_001 }, (_, i) => ({ id: i + 1 }));
    const job = createMockJob(rows, {
      schema: { fields: [{ name: 'id', type: 'INTEGER' }] },
    });
    const client = { createQueryJob: jest.fn().mockResolvedValue([job]) };
    const createClient = jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    const result = await service.executeQuery('bq-1', {
      query: 'SELECT id FROM t',
    });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ plaintextCredentials: CREDENTIALS_JSON }),
    );
    expect(client.createQueryJob).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'SELECT * FROM (SELECT id FROM t\n) AS _q LIMIT 10001',
        defaultDataset: { datasetId: 'analytics' },
        maximumBytesBilled: '5000000000',
        location: 'US',
      }),
    );

    expect(result.columns).toEqual([{ name: 'id', dataTypeID: 'INTEGER' }]);
    expect(result.rowCount).toBe(10_000);
    expect(result.truncated).toBe(true);
  });

  it('does not let a trailing line comment in the query swallow the LIMIT wrapper', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue({
      id: 'bq-1',
      projectId: 'my-project',
      dataset: null,
      location: null,
      credentials: encrypt(CREDENTIALS_JSON),
      maximumBytesBilled: null,
    });

    const job = createMockJob([], { schema: { fields: [] } });
    const client = { createQueryJob: jest.fn().mockResolvedValue([job]) };
    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    await service.executeQuery('bq-1', {
      query: 'SELECT id FROM t -- filter TODO',
    });

    const callArg = client.createQueryJob.mock.calls[0][0] as {
      query: string;
    };
    // The wrapper clause must survive on its own line, not get commented out.
    expect(callArg.query).toBe(
      'SELECT * FROM (SELECT id FROM t -- filter TODO\n) AS _q LIMIT 10001',
    );
  });

  it('omits defaultDataset and maximumBytesBilled when unset on the source', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue({
      id: 'bq-1',
      projectId: 'my-project',
      dataset: null,
      location: null,
      credentials: encrypt(CREDENTIALS_JSON),
      maximumBytesBilled: null,
    });

    const job = createMockJob([], { schema: { fields: [] } });
    const client = { createQueryJob: jest.fn().mockResolvedValue([job]) };
    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    await service.executeQuery('bq-1', { query: 'SELECT 1' });

    const callArg = client.createQueryJob.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArg.defaultDataset).toBeUndefined();
    expect(callArg.maximumBytesBilled).toBeUndefined();
  });

  it('unwraps BigQuery date/timestamp/struct values into plain JSON-friendly values', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue({
      id: 'bq-1',
      projectId: 'my-project',
      dataset: null,
      location: null,
      credentials: encrypt(CREDENTIALS_JSON),
      maximumBytesBilled: null,
    });

    const row = {
      signed_up: new BigQueryDate('2024-01-01'),
      profile: { verified_at: new BigQueryTimestamp('2024-01-02T03:04:05Z') },
      tags: ['a', 'b'],
    };
    const job = createMockJob([row], { schema: { fields: [] } });
    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue({ createQueryJob: jest.fn().mockResolvedValue([job]) });

    const result = await service.executeQuery('bq-1', {
      query: 'SELECT * FROM t',
    });

    expect(result.rows).toEqual([
      {
        signed_up: '2024-01-01',
        profile: { verified_at: '2024-01-02T03:04:05.000Z' },
        tags: ['a', 'b'],
      },
    ]);
  });

  it('converts a failed query into a BadRequestException with a reason', async () => {
    prisma.bigQuerySource.findUnique.mockResolvedValue({
      id: 'bq-1',
      projectId: 'my-project',
      dataset: null,
      location: null,
      credentials: encrypt(CREDENTIALS_JSON),
      maximumBytesBilled: null,
    });

    const client = {
      createQueryJob: jest
        .fn()
        .mockRejectedValue(new Error('Syntax error: Unexpected keyword FROM')),
    };
    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    await expect(
      service.executeQuery('bq-1', { query: 'SELECT * FROM FROM' }),
    ).rejects.toMatchObject({
      message: 'Syntax error: Unexpected keyword FROM',
    });
  });
});
