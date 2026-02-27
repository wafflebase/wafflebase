import {
  BadRequestException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/database/prisma.service';
import { DataSourceService } from 'src/datasource/datasource.service';
import { ShareLinkService } from 'src/share-link/share-link.service';
import {
  describeDb,
  parseDatabaseUrl,
  clearDatabase,
  createUserFactory,
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
      const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

      const ds = await datasourceService.create(owner.id, {
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

      const connectionResult = await datasourceService.testConnection(
        owner.id,
        ds.id,
      );
      expect(connectionResult).toEqual({ success: true });

      const queryResult = await datasourceService.executeQuery(owner.id, ds.id, {
        query: 'SELECT 1::int4 AS n',
      });
      expect(queryResult.columns.map((column) => column.name)).toEqual(['n']);
      expect(queryResult.rows).toEqual([{ n: 1 }]);
      expect(queryResult.rowCount).toBe(1);
      expect(queryResult.truncated).toBe(false);
    });

    it('enforces ownership for executeQuery and testConnection', async () => {
      const owner = await createUser();
      const other = await createUser();
      const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

      const ds = await datasourceService.create(owner.id, {
        name: 'restricted',
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        username: pgConfig.username,
        password: pgConfig.password,
        sslEnabled: false,
      });

      await expect(
        datasourceService.executeQuery(other.id, ds.id, {
          query: 'SELECT 1::int4 AS n',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      await expect(
        datasourceService.testConnection(other.id, ds.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('maps runtime SQL failures to bad request', async () => {
      const owner = await createUser();
      const pgConfig = parseDatabaseUrl(process.env.DATABASE_URL!);

      const ds = await datasourceService.create(owner.id, {
        name: 'broken-query',
        host: pgConfig.host,
        port: pgConfig.port,
        database: pgConfig.database,
        username: pgConfig.username,
        password: pgConfig.password,
        sslEnabled: false,
      });

      await expect(
        datasourceService.executeQuery(owner.id, ds.id, {
          query: 'SELECT * FROM table_that_does_not_exist_for_test',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('ShareLinkService', () => {
    it('creates and resolves share links for the document owner', async () => {
      const owner = await createUser();
      const doc = await prisma.document.create({
        data: {
          title: 'Quarterly plan',
          authorID: owner.id,
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
      const doc = await prisma.document.create({
        data: {
          title: 'Budget',
          authorID: owner.id,
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
      const doc = await prisma.document.create({
        data: {
          title: 'Shared board',
          authorID: owner.id,
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
  });
});
