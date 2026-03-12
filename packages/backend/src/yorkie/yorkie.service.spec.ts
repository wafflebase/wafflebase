import { ConfigService } from '@nestjs/config';
import { YorkieService } from './yorkie.service';

// Mock the @yorkie-js/sdk module
const mockActivate = jest.fn().mockResolvedValue(undefined);
const mockDeactivate = jest.fn().mockResolvedValue(undefined);
const mockAttach = jest.fn().mockResolvedValue(undefined);
const mockDetach = jest.fn().mockResolvedValue(undefined);
const mockSync = jest.fn().mockResolvedValue(undefined);

jest.mock('@yorkie-js/sdk', () => {
  const mockClient = jest.fn().mockImplementation(() => ({
    activate: mockActivate,
    deactivate: mockDeactivate,
    attach: mockAttach,
    detach: mockDetach,
    sync: mockSync,
  }));

  const mockDocument = jest.fn().mockImplementation((key: string) => ({
    key,
    getRoot: jest.fn().mockReturnValue({}),
  }));

  return {
    __esModule: true,
    default: { Client: mockClient, Document: mockDocument },
    Client: mockClient,
    Document: mockDocument,
    SyncMode: { Manual: 'manual' },
  };
});

function createMockConfigService(): ConfigService {
  return {
    get: jest.fn().mockReturnValue('http://localhost:8080'),
  } as unknown as ConfigService;
}

describe('YorkieService', () => {
  let service: YorkieService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new YorkieService(createMockConfigService());
  });

  describe('onModuleInit', () => {
    it('activates the Yorkie client', async () => {
      await service.onModuleInit();
      expect(mockActivate).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('deactivates the Yorkie client', async () => {
      await service.onModuleDestroy();
      expect(mockDeactivate).toHaveBeenCalled();
    });
  });

  describe('withDocument', () => {
    it('attaches, runs callback, syncs, and detaches', async () => {
      const callback = jest.fn().mockReturnValue('result');

      const result = await service.withDocument('doc-1', callback);

      expect(result).toBe('result');
      expect(mockAttach).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'sheet-doc-1' }),
        { syncMode: 'manual' },
      );
      expect(callback).toHaveBeenCalled();
      expect(mockSync).toHaveBeenCalled();
      expect(mockDetach).toHaveBeenCalled();
    });

    it('detaches even if callback throws', async () => {
      const error = new Error('callback failed');
      const callback = jest.fn().mockRejectedValue(error);

      await expect(service.withDocument('doc-1', callback)).rejects.toThrow(
        'callback failed',
      );
      expect(mockDetach).toHaveBeenCalled();
    });

    it('detaches even if sync throws', async () => {
      mockSync.mockRejectedValueOnce(new Error('sync failed'));
      const callback = jest.fn().mockReturnValue('ok');

      await expect(service.withDocument('doc-1', callback)).rejects.toThrow(
        'sync failed',
      );
      expect(mockDetach).toHaveBeenCalled();
    });
  });
});
