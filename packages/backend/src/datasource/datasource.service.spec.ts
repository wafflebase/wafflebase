import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
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

    await service.create(7, {
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
    expect(encrypted).not.toBe('plain-secret');
    expect(encrypted.split(':')).toHaveLength(3);
  });

  it('masks passwords in findAll', async () => {
    prisma.dataSource.findMany.mockResolvedValue([
      { id: 'ds-1', password: 'encrypted', authorID: 7 },
    ]);

    const results = await service.findAll(7);

    expect(results).toEqual([{ id: 'ds-1', password: '********', authorID: 7 }]);
  });

  it('throws forbidden when requesting another users datasource', async () => {
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'ds-1',
      authorID: 99,
    });

    await expect(service.findOne(7, 'ds-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects invalid SQL before touching persistence', async () => {
    await expect(
      service.executeQuery(7, 'ds-1', { query: 'DELETE FROM users' }),
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
      password: 'encrypted',
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

    jest
      .spyOn(service as unknown as { createClient: () => unknown }, 'createClient')
      .mockReturnValue(client);

    const result = await service.executeQuery(7, 'ds-1', {
      query: 'SELECT id FROM users',
    });

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SET statement_timeout = '30000'",
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM (SELECT id FROM users) AS _q LIMIT 10001',
    );
    expect(client.end).toHaveBeenCalledTimes(1);

    expect(result.columns).toEqual([{ name: 'id', dataTypeID: 23 }]);
    expect(result.rowCount).toBe(10_000);
    expect(result.truncated).toBe(true);
  });

  it('converts query runtime failures to bad request and still closes client', async () => {
    prisma.dataSource.findUnique.mockResolvedValue({
      id: 'ds-1',
      authorID: 7,
      host: 'localhost',
      port: 5432,
      database: 'postgres',
      username: 'waffle',
      password: 'encrypted',
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
      .spyOn(service as unknown as { createClient: () => unknown }, 'createClient')
      .mockReturnValue(client);

    await expect(
      service.executeQuery(7, 'ds-1', { query: 'SELECT * FROM FROM' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
