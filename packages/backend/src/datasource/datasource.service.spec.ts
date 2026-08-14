import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { encrypt } from './crypto.util';
import { DataSourceService } from './datasource.service';

const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function createMockPrisma() {
  return {
    dataSource: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function createMockPgClient() {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined),
  };
}

describe('DataSourceService', () => {
  let service: DataSourceService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    process.env.DATASOURCE_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    prisma = createMockPrisma();
    service = new DataSourceService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('encrypts password when creating a datasource', async () => {
    prisma.dataSource.create.mockResolvedValue({ id: 'ds-1' });

    await service.create(7, 'ws-1', {
      name: 'analytics',
      host: 'localhost',
      database: 'postgres',
      username: 'waffle',
      password: 'plain-secret',
      sslEnabled: false,
    });

    const createArg = prisma.dataSource.create.mock.calls[0][0];
    const encrypted = createArg.data.password as string;

    expect(createArg.data.authorID).toBe(7);
    expect(createArg.data.workspaceId).toBe('ws-1');
    expect(encrypted).not.toBe('plain-secret');
    expect(encrypted.split(':')).toHaveLength(3);
  });

  it('masks passwords in findAllByWorkspace', async () => {
    prisma.dataSource.findMany.mockResolvedValue([
      { id: 'ds-1', password: 'encrypted', authorID: 7, workspaceId: 'ws-1' },
    ]);

    const results = await service.findAllByWorkspace('ws-1');

    expect(results).toEqual([
      { id: 'ds-1', password: '********', authorID: 7, workspaceId: 'ws-1' },
    ]);
    expect(prisma.dataSource.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('throws not found when datasource does not exist', async () => {
    prisma.dataSource.findUnique.mockResolvedValue(null);

    await expect(service.findOne('ds-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects invalid SQL before touching persistence', async () => {
    await expect(
      service.executeQuery('ds-1', { query: 'DELETE FROM users' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.dataSource.findUnique).not.toHaveBeenCalled();
  });

  it('wraps query with limit and truncates rows', async () => {
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'ds-1',
      authorID: 7,
      host: 'localhost',
      port: 5432,
      database: 'postgres',
      username: 'waffle',
      password: encrypt('plain-secret'),
      sslEnabled: false,
    });

    const rows = Array.from({ length: 10_001 }, (_, i) => ({ id: i + 1 }));
    const client = createMockPgClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET statement_timeout')) {
        return { rows: [], fields: [] };
      }

      return {
        fields: [{ name: 'id', dataTypeID: 23 }],
        rows,
      };
    });

    const createClient = jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    const result = await service.executeQuery('ds-1', {
      query: 'SELECT id FROM users',
    });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ plaintextPassword: 'plain-secret' }),
    );
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SET statement_timeout = '30000'",
    );
    expect(client.query).toHaveBeenNthCalledWith(2, "SET TimeZone = 'UTC'");
    expect(client.query).toHaveBeenNthCalledWith(3, "SET DateStyle = 'ISO'");
    expect(client.query).toHaveBeenNthCalledWith(4, "SET lc_monetary = 'C'");
    expect(client.query).toHaveBeenNthCalledWith(
      5,
      'SELECT * FROM (SELECT id FROM users\n) AS _q LIMIT 10001',
    );
    expect(client.end).toHaveBeenCalledTimes(1);

    expect(result.columns).toEqual([{ name: 'id', dataTypeID: 23 }]);
    expect(result.rowCount).toBe(10_000);
    expect(result.truncated).toBe(true);
  });

  it('does not let a trailing line comment in the query swallow the LIMIT wrapper', async () => {
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'ds-1',
      authorID: 7,
      host: 'localhost',
      port: 5432,
      database: 'postgres',
      username: 'waffle',
      password: encrypt('plain-secret'),
      sslEnabled: false,
    });

    const client = createMockPgClient();
    client.query.mockResolvedValue({ rows: [], fields: [] });

    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    await service.executeQuery('ds-1', {
      query: 'SELECT id FROM t -- filter TODO',
    });

    // The wrapper clause must survive on its own line, not get commented out.
    expect(client.query).toHaveBeenNthCalledWith(
      5,
      'SELECT * FROM (SELECT id FROM t -- filter TODO\n) AS _q LIMIT 10001',
    );
  });

  it('hands pg the decrypted password for a saved datasource', async () => {
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'ds-1',
      authorID: 7,
      host: 'localhost',
      port: 5432,
      database: 'postgres',
      username: 'waffle',
      password: encrypt('plain-secret'),
      sslEnabled: false,
    });

    const client = createMockPgClient();
    client.query.mockResolvedValue({ rows: [], fields: [] });

    const createClient = jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    await service.testConnection('ds-1');

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ plaintextPassword: 'plain-secret' }),
    );
  });

  it('tests unsaved settings without touching persistence', async () => {
    const client = createMockPgClient();
    client.query.mockResolvedValue({ rows: [], fields: [] });

    const createClient = jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    const result = await service.testConfig({
      host: 'localhost',
      database: 'postgres',
      username: 'waffle',
      password: 'plain-secret',
    });

    expect(result).toEqual({ success: true });
    expect(client.query).toHaveBeenCalledWith('SELECT 1');
    expect(client.end).toHaveBeenCalledTimes(1);

    // `port` and `sslEnabled` were omitted above, so this pins the defaults
    // `testConfig` fills in. An unsaved test connection has no row to read
    // them from, which is exactly why it must supply them itself — silently
    // dropping either would probe a different server than the dialog says.
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ port: 5432, sslEnabled: false }),
    );

    expect(prisma.dataSource.create).not.toHaveBeenCalled();
    expect(prisma.dataSource.findUnique).not.toHaveBeenCalled();
    expect(prisma.dataSource.findMany).not.toHaveBeenCalled();
    expect(prisma.dataSource.update).not.toHaveBeenCalled();
    expect(prisma.dataSource.delete).not.toHaveBeenCalled();
  });

  it('reports the cause of a failed connection and still closes client', async () => {
    const client = createMockPgClient();
    client.connect.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    );

    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    const result = await service.testConfig({
      host: 'localhost',
      database: 'postgres',
      username: 'waffle',
      password: 'plain-secret',
    });

    expect(result).toEqual({
      success: false,
      error: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('unwraps AggregateError causes instead of returning an empty error', async () => {
    const client = createMockPgClient();
    client.connect.mockRejectedValue(
      new AggregateError([
        new Error('connect ECONNREFUSED ::1:5432'),
        new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      ]),
    );

    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    const result = await service.testConfig({
      host: 'localhost',
      database: 'postgres',
      username: 'waffle',
      password: 'plain-secret',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432',
    );
  });

  it('converts query runtime failures to bad request and still closes client', async () => {
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'ds-1',
      authorID: 7,
      host: 'localhost',
      port: 5432,
      database: 'postgres',
      username: 'waffle',
      password: encrypt('plain-secret'),
      sslEnabled: false,
    });

    const client = createMockPgClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SET statement_timeout')) {
        return { rows: [], fields: [] };
      }

      throw new Error('syntax error at or near "FROM"');
    });

    jest
      .spyOn(
        service as unknown as { createClient: () => unknown },
        'createClient',
      )
      .mockReturnValue(client);

    await expect(
      service.executeQuery('ds-1', { query: 'SELECT * FROM FROM' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
