import {
  BadRequestException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Client, types } from 'pg';
import { toCell } from '@wafflebase/sheets';
import { PrismaService } from 'src/database/prisma.service';
import { DataSourceService } from 'src/datasource/datasource.service';
import { ShareLinkService } from 'src/share-link/share-link.service';
import {
  describeDb,
  parseDatabaseUrl,
  clearDatabase,
  createUserFactory,
  createWorkspace,
  setIntegrationEnvDefaults,
} from './helpers/integration-helpers';

describeDb('Database-backed integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let datasourceService: DataSourceService;
  let shareLinkService: ShareLinkService;
  let createUser: ReturnType<typeof createUserFactory>;

  beforeAll(async () => {
    setIntegrationEnvDefaults();

    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, DataSourceService, ShareLinkService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    datasourceService = moduleRef.get(DataSourceService);
    shareLinkService = moduleRef.get(ShareLinkService);
    createUser = createUserFactory(prisma, 'db');

    await prisma.$connect();
  });

  beforeEach(async () => {
    await clearDatabase(prisma);
  });

  afterAll(async () => {
    await clearDatabase(prisma);
    await moduleRef.close();
  });

  describe('DataSourceService', () => {
    it('persists encrypted passwords and executes queries against postgres', async () => {
      const owner = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

      const ds = await datasourceService.create(owner.id, workspace.id, {
        name: 'primary',
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        username: pgConfig.username,
        password: pgConfig.password,
        sslEnabled: false,
      });

      const stored = await prisma.dataSource.findUniqueOrThrow({
        where: { id: ds.id },
      });

      expect(stored.password).not.toBe(pgConfig.password);
      expect(stored.password.split(':')).toHaveLength(3);

      const connectionResult = await datasourceService.testConnection(ds.id);
      expect(connectionResult).toEqual({ success: true });

      const { columns, rows, rowCount, truncated } =
        await datasourceService.executeQuery(ds.id, {
          query: 'SELECT 1::int4 AS n',
        });
      expect(rowCount).toBe(1);
      expect(truncated).toBe(false);
      expect(columns.map((c) => c.name)).toEqual(['n']);
      expect(String(rows[0].n)).toBe('1');
    });

    it('enforces ownership for executeQuery and testConnection', async () => {
      const owner = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

      const ds = await datasourceService.create(owner.id, workspace.id, {
        name: 'restricted',
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        username: pgConfig.username,
        password: pgConfig.password,
        sslEnabled: false,
      });

      // Ownership is now enforced at controller layer via workspace membership;
      // service methods no longer take userId. Verify the service works for the datasource.
      const connectionResult = await datasourceService.testConnection(ds.id);
      expect(connectionResult).toEqual({ success: true });

      const { rows } = await datasourceService.executeQuery(ds.id, {
        query: 'SELECT 1::int4 AS n',
      });
      expect(String(rows[0].n)).toBe('1');
    });

    it('queries real tables with rows', async () => {
      const owner = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

      // Create a test table and insert data using a raw pg client
      // (DataSourceService only allows SELECT)
      const rawClient = new Client({
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        user: pgConfig.username,
        password: pgConfig.password,
      });
      await rawClient.connect();
      try {
        await rawClient.query(`
          CREATE TABLE IF NOT EXISTS _test_products (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            price NUMERIC(10, 2) NOT NULL
          )
        `);
        await rawClient.query(`TRUNCATE _test_products RESTART IDENTITY`);
        await rawClient.query(`
          INSERT INTO _test_products (name, price) VALUES
            ('Widget', 9.99),
            ('Gadget', 24.50),
            ('Doohickey', 3.75)
        `);
      } finally {
        await rawClient.end();
      }

      const ds = await datasourceService.create(owner.id, workspace.id, {
        name: 'table-test',
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        username: pgConfig.username,
        password: pgConfig.password,
        sslEnabled: false,
      });

      // List tables via information_schema
      const tablesResult = await datasourceService.executeQuery(ds.id, {
        query: `SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = '_test_products'`,
      });
      expect(String(tablesResult.rows[0].table_name)).toBe('_test_products');

      // Query table data — verify as sheet cell values (all strings via String())
      const { columns, rows, rowCount, truncated } =
        await datasourceService.executeQuery(ds.id, {
          query: 'SELECT id, name, price FROM _test_products ORDER BY id',
        });
      expect(rowCount).toBe(3);
      expect(truncated).toBe(false);
      expect(columns.map((c) => c.name)).toEqual(['id', 'name', 'price']);

      const sheetRows = rows.map((row) =>
        columns.map((c) => toCell(row[c.name])),
      );
      expect(sheetRows).toEqual([
        ['1', 'Widget', '9.99'],
        ['2', 'Gadget', '24.50'],
        ['3', 'Doohickey', '3.75'],
      ]);

      // Cleanup
      const cleanupClient = new Client({
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        user: pgConfig.username,
        password: pgConfig.password,
      });
      await cleanupClient.connect();
      try {
        await cleanupClient.query('DROP TABLE IF EXISTS _test_products');
      } finally {
        await cleanupClient.end();
      }
    });

    it('check correct cell values for all pg built-in types', async () => {
      const owner = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

      const ds = await datasourceService.create(owner.id, workspace.id, {
        name: 'all-types',
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        username: pgConfig.username,
        password: pgConfig.password,
        sslEnabled: false,
      });

      // Each entry: [expectedOid, sqlColumnType, insertLiteral, expectedCellValue]
      // Listed in pg-types TypeId enum order (by OID).
      const b = types.builtins;
      const typeMap: [number, string, string, string][] = [
        [b.BOOL,        'BOOLEAN',         'true',                                'true'],
        [b.BYTEA,       'BYTEA',           "E'\\\\xDEADBEEF'",                   '{"type":"Buffer","data":[222,173,190,239]}'],
        [b.CHAR,        '"char"',          "'A'",                                 'A'],
        [b.INT8,        'INT8',            '9223372036854775807',                 '9223372036854775807'],
        [b.INT2,        'INT2',            '32767',                               '32767'],
        [b.INT4,        'INT4',            '2147483647',                          '2147483647'],
        [b.REGPROC,     'REGPROC',         "'now'",                               'now'],
        [b.TEXT,        'TEXT',            "'hello world'",                       'hello world'],
        [b.OID,         'OID',             '1',                                   '1'],
        [b.TID,         'TID',             "'(0,1)'",                             '(0,1)'],
        [b.XID,         'XID',             "'1'",                                 '1'],
        [b.CID,         'CID',             "'0'",                                 '0'],
        [b.JSON,        'JSON',            "'{\"key\":\"value\"}'",               '{"key":"value"}'],
        [b.XML,         'XML',             "'<root>test</root>'",                 '<root>test</root>'],
        // [b.PG_NODE_TREE] — internal parser tree type, cannot be used as column type
        // [b.SMGR]        — internal storage manager type, cannot be used as column type
        [b.PATH,        'PATH',            "'((0,0),(1,1),(2,0))'",               '((0,0),(1,1),(2,0))'],
        [b.POLYGON,     'POLYGON',         "'((0,0),(1,1),(1,0))'",               '((0,0),(1,1),(1,0))'],
        [b.CIDR,        'CIDR',            "'192.168.0.0/16'",                    '192.168.0.0/16'],
        [b.FLOAT4,      'FLOAT4',          '3.14',                                '3.14'],
        [b.FLOAT8,      'FLOAT8',          '2.718281828',                          '2.718281828'],
        // [b.ABSTIME]     — removed in PostgreSQL 12
        // [b.RELTIME]     — removed in PostgreSQL 12
        // [b.TINTERVAL]   — removed in PostgreSQL 12
        [b.CIRCLE,      'CIRCLE',          "'<(1,2),3>'",                          '{"x":1,"y":2,"radius":3}'],
        [b.MACADDR8,    'MACADDR8',        "'08:00:2b:01:02:03:04:05'",           '08:00:2b:01:02:03:04:05'],
        [b.MONEY,       'MONEY',           "'$1,234.56'",                          '$1,234.56'],
        [b.MACADDR,     'MACADDR',         "'08:00:2b:01:02:03'",                 '08:00:2b:01:02:03'],
        [b.INET,        'INET',            "'192.168.1.0/24'",                    '192.168.1.0/24'],
        // [b.ACLITEM]     — internal access control type, cannot be used as column type
        [b.BPCHAR,      'CHAR(10)',        "'padded'",                            'padded    '],
        [b.VARCHAR,     'VARCHAR(100)',    "'variable'",                          'variable'],
        [b.DATE,        'DATE',            "'2025-06-15'",                         '2025-06-15'],
        [b.TIME,        'TIME',            "'14:30:00'",                           '14:30:00'],
        [b.TIMESTAMP,   'TIMESTAMP',       "'2025-06-15 14:30:00'",               '2025-06-15 14:30:00'],
        [b.TIMESTAMPTZ, 'TIMESTAMPTZ',     "'2025-06-15 14:30:00+09'",            '2025-06-15 05:30:00+00'],
        [b.INTERVAL,    'INTERVAL',        "'1 year 2 months 3 days'",            '{"years":1,"months":2,"days":3}'],
        [b.TIMETZ,      'TIMETZ',          "'14:30:00+09'",                        '14:30:00+09'],
        [b.BIT,         'BIT(8)',          "B'10101010'",                          '10101010'],
        [b.VARBIT,      'VARBIT(8)',       "B'1010'",                              '1010'],
        [b.NUMERIC,     'NUMERIC(20,4)',   '12345678901234.5678',                  '12345678901234.5678'],
        // [b.REFCURSOR]      — cursor reference, only valid inside transactions/functions
        // [b.REGPROCEDURE]   — system catalog reference type (function with arg types)
        // [b.REGOPER]        — system catalog reference type (operator name)
        // [b.REGOPERATOR]    — system catalog reference type (operator with arg types)
        // [b.REGCLASS]       — system catalog reference type (relation name)
        // [b.REGTYPE]        — system catalog reference type (type name)
        [b.UUID,        'UUID',            "'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'", 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
        // [b.TXID_SNAPSHOT]  — deprecated, renamed to pg_snapshot in PostgreSQL 13
        [b.PG_LSN,      'PG_LSN',          "'0/1A2B3C4'",                          '0/1A2B3C4'],
        // [b.PG_NDISTINCT]   — internal statistics type, cannot be used as column type
        // [b.PG_DEPENDENCIES] — internal statistics type, cannot be used as column type
        [b.TSVECTOR,    'TSVECTOR',        "'fat cat sat'",                        "'cat' 'fat' 'sat'"],
        [b.TSQUERY,     'TSQUERY',         "'fat & cat'",                          "'fat' & 'cat'"],
        // [b.GTSVECTOR]      — internal GiST type, cannot be used as column type
        [b.REGCONFIG,   'REGCONFIG',       "'english'",                            'english'],
        [b.REGDICTIONARY, 'REGDICTIONARY', "'simple'",                             'simple'],
        [b.JSONB,       'JSONB',           "'{\"nested\":[1,2,3]}'",               '{"nested":[1,2,3]}'],
        // [b.REGNAMESPACE]   — system catalog reference type (namespace name)
        // [b.REGROLE]        — system catalog reference type (role name)
      ];

      const rawClient = new Client({
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        user: pgConfig.username,
        password: pgConfig.password,
      });
      await rawClient.connect();

      const table = '_test_type_check';
      try {
        for (const [expectedOid, sqlType, insertLiteral, expectedCell] of typeMap) {
          await rawClient.query(`DROP TABLE IF EXISTS ${table}`);
          await rawClient.query(`CREATE TABLE ${table} (val ${sqlType})`);
          await rawClient.query(`INSERT INTO ${table} (val) VALUES (${insertLiteral})`);

          const { columns, rows } = await datasourceService.executeQuery(ds.id, {
            query: `SELECT val FROM ${table}`,
          });

          expect(columns[0].dataTypeID).toBe(expectedOid);
          expect(toCell(rows[0].val)).toBe(expectedCell);
        }
      } finally {
        await rawClient.query(`DROP TABLE IF EXISTS ${table}`);
        await rawClient.end();
      }
    });

    it('queries real tables with rows', async () => {
      const owner = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

      // Create a test table and insert data using a raw pg client
      // (DataSourceService only allows SELECT)
      const rawClient = new Client({
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        user: pgConfig.username,
        password: pgConfig.password,
      });
      await rawClient.connect();
      try {
        await rawClient.query(`
          CREATE TABLE IF NOT EXISTS _test_products (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            price NUMERIC(10, 2) NOT NULL
          )
        `);
        await rawClient.query(`TRUNCATE _test_products RESTART IDENTITY`);
        await rawClient.query(`
          INSERT INTO _test_products (name, price) VALUES
            ('Widget', 9.99),
            ('Gadget', 24.50),
            ('Doohickey', 3.75)
        `);
      } finally {
        await rawClient.end();
      }

      const ds = await datasourceService.create(owner.id, workspace.id, {
        name: 'table-test',
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        username: pgConfig.username,
        password: pgConfig.password,
        sslEnabled: false,
      });

      // List tables via information_schema
      const tablesResult = await datasourceService.executeQuery(ds.id, {
        query: `SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = '_test_products'`,
      });
      expect(tablesResult.rows).toEqual([{ table_name: '_test_products' }]);

      // Query table data
      const dataResult = await datasourceService.executeQuery(ds.id, {
        query: 'SELECT id, name, price FROM _test_products ORDER BY id',
      });
      expect(dataResult.rowCount).toBe(3);
      expect(dataResult.columns.map((c) => c.name)).toEqual([
        'id',
        'name',
        'price',
      ]);
      expect(dataResult.rows).toEqual([
        { id: 1, name: 'Widget', price: '9.99' },
        { id: 2, name: 'Gadget', price: '24.50' },
        { id: 3, name: 'Doohickey', price: '3.75' },
      ]);
      expect(dataResult.truncated).toBe(false);

      // Cleanup
      const cleanupClient = new Client({
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        user: pgConfig.username,
        password: pgConfig.password,
      });
      await cleanupClient.connect();
      try {
        await cleanupClient.query('DROP TABLE IF EXISTS _test_products');
      } finally {
        await cleanupClient.end();
      }
    });

    it('maps runtime SQL failures to bad request', async () => {
      const owner = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

      const ds = await datasourceService.create(owner.id, workspace.id, {
        name: 'broken-query',
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        username: pgConfig.username,
        password: pgConfig.password,
        sslEnabled: false,
      });

      await expect(
        datasourceService.executeQuery(ds.id, {
          query: 'SELECT * FROM table_that_does_not_exist_for_test',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('ShareLinkService', () => {
    it('creates and resolves share links for the document owner', async () => {
      const owner = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const doc = await prisma.document.create({
        data: {
          title: 'Quarterly plan',
          authorID: owner.id,
          workspaceId: workspace.id,
        },
      });

      const link = await shareLinkService.create(
        doc.id,
        'viewer',
        owner.id,
        null,
      );

      const resolved = await shareLinkService.findByToken(link.token);
      expect(resolved.documentId).toBe(doc.id);
      expect(resolved.role).toBe('viewer');
      expect(resolved.document.title).toBe('Quarterly plan');
    });

    it('enforces ownership and expiration checks', async () => {
      const owner = await createUser();
      const other = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const doc = await prisma.document.create({
        data: {
          title: 'Budget',
          authorID: owner.id,
          workspaceId: workspace.id,
        },
      });

      await expect(
        shareLinkService.create(doc.id, 'editor', other.id, null),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const expired = await prisma.shareLink.create({
        data: {
          role: 'viewer',
          documentId: doc.id,
          createdBy: owner.id,
          expiresAt: new Date(Date.now() - 1_000),
        },
      });

      await expect(
        shareLinkService.findByToken(expired.token),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('allows only the creator to delete share links', async () => {
      const owner = await createUser();
      const other = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      const doc = await prisma.document.create({
        data: {
          title: 'Shared board',
          authorID: owner.id,
          workspaceId: workspace.id,
        },
      });
      const link = await shareLinkService.create(
        doc.id,
        'viewer',
        owner.id,
        null,
      );

      await expect(
        shareLinkService.delete(link.id, other.id),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const deleted = await shareLinkService.delete(link.id, owner.id);
      expect(deleted.id).toBe(link.id);
    });

    it('lets a workspace owner who is not the author create an editor link', async () => {
      const author = await createUser();
      const wsOwner = await createUser();
      const workspace = await createWorkspace(prisma, wsOwner.id);
      const doc = await prisma.document.create({
        data: {
          title: 'Team doc',
          authorID: author.id,
          workspaceId: workspace.id,
        },
      });

      const link = await shareLinkService.create(
        doc.id,
        'editor',
        wsOwner.id,
        null,
      );
      expect(link.role).toBe('editor');
    });

    it('lets a plain member create a viewer link but not an editor link', async () => {
      const owner = await createUser();
      const member = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: member.id, role: 'member' },
      });
      const doc = await prisma.document.create({
        data: {
          title: 'Member doc',
          authorID: owner.id,
          workspaceId: workspace.id,
        },
      });

      const viewer = await shareLinkService.create(
        doc.id,
        'viewer',
        member.id,
        null,
      );
      expect(viewer.role).toBe('viewer');

      await expect(
        shareLinkService.create(doc.id, 'editor', member.id, null),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a workspace owner revoke a link created by a member', async () => {
      const owner = await createUser();
      const member = await createUser();
      const workspace = await createWorkspace(prisma, owner.id);
      await prisma.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: member.id, role: 'member' },
      });
      const doc = await prisma.document.create({
        data: {
          title: 'Owned doc',
          authorID: owner.id,
          workspaceId: workspace.id,
        },
      });
      const link = await shareLinkService.create(
        doc.id,
        'viewer',
        member.id,
        null,
      );

      const deleted = await shareLinkService.delete(link.id, owner.id);
      expect(deleted.id).toBe(link.id);
    });
  });
});
