import { Test, TestingModule } from '@nestjs/testing';
import { DataSourceController } from 'src/datasource/datasource.controller';
import { DataSourceService } from 'src/datasource/datasource.service';
import { ShareLinkController } from 'src/share-link/share-link.controller';
import { ShareLinkService } from 'src/share-link/share-link.service';

describe('Controller contracts (e2e)', () => {
  let moduleRef: TestingModule;
  let datasourceController: DataSourceController;
  let shareLinkController: ShareLinkController;

  const datasourceService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    testConnection: jest.fn(),
    executeQuery: jest.fn(),
  };

  const shareLinkService = {
    create: jest.fn(),
    findByDocument: jest.fn(),
    delete: jest.fn(),
    findByToken: jest.fn(),
  };

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [DataSourceController, ShareLinkController],
      providers: [
        { provide: DataSourceService, useValue: datasourceService },
        { provide: ShareLinkService, useValue: shareLinkService },
      ],
    }).compile();

    datasourceController = moduleRef.get(DataSourceController);
    shareLinkController = moduleRef.get(ShareLinkController);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();
    await moduleRef.close();
  });

  it('forwards authenticated user id on datasource list endpoint', async () => {
    datasourceService.findAll.mockResolvedValue([{ id: 'ds-1', name: 'main' }]);

    const result = await datasourceController.findAll({
      user: { id: '7' },
    } as never);

    expect(result).toEqual([{ id: 'ds-1', name: 'main' }]);
    expect(datasourceService.findAll).toHaveBeenCalledWith(7);
  });

  it('forwards query payload and user id on datasource query endpoint', async () => {
    datasourceService.executeQuery.mockResolvedValue({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      executionTime: 2,
    });

    const result = await datasourceController.executeQuery(
      { user: { id: '7' } } as never,
      'ds-1',
      { query: 'SELECT 1' },
    );

    expect(result).toEqual({
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      executionTime: 2,
    });
    expect(datasourceService.executeQuery).toHaveBeenCalledWith(7, 'ds-1', {
      query: 'SELECT 1',
    });
  });

  it('maps role/expiration on share-link creation endpoint', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00Z'));

    shareLinkService.create.mockResolvedValue({ id: 'link-1', role: 'editor' });

    const result = await shareLinkController.create(
      'doc-1',
      { user: { id: '7' } } as never,
      { role: 'editor', expiration: '1h' },
    );

    expect(result).toEqual({ id: 'link-1', role: 'editor' });
    expect(shareLinkService.create).toHaveBeenCalledWith(
      'doc-1',
      'editor',
      7,
      expect.any(Date),
    );

    const expiresAt = shareLinkService.create.mock.calls[0][3] as Date;
    expect(expiresAt).toEqual(new Date('2025-06-15T13:00:00Z'));
  });

  it('forwards authenticated user id on share-link list and delete endpoints', async () => {
    shareLinkService.findByDocument.mockResolvedValue([{ id: 'link-1' }]);
    shareLinkService.delete.mockResolvedValue({ id: 'link-1' });

    const list = await shareLinkController.findByDocument('doc-1', {
      user: { id: '7' },
    } as never);
    const removed = await shareLinkController.delete('link-1', {
      user: { id: '7' },
    } as never);

    expect(list).toEqual([{ id: 'link-1' }]);
    expect(removed).toEqual({ id: 'link-1' });
    expect(shareLinkService.findByDocument).toHaveBeenCalledWith('doc-1', 7);
    expect(shareLinkService.delete).toHaveBeenCalledWith('link-1', 7);
  });

  it('maps resolved share token payload', async () => {
    shareLinkService.findByToken.mockResolvedValue({
      documentId: 'doc-1',
      role: 'viewer',
      document: { title: 'Revenue' },
    });

    const result = await shareLinkController.resolve('token-1');

    expect(result).toEqual({
      documentId: 'doc-1',
      role: 'viewer',
      title: 'Revenue',
    });
    expect(shareLinkService.findByToken).toHaveBeenCalledWith('token-1');
  });
});
