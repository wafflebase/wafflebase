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

  describe('withDocument', () => {
    it('creates a client, attaches, runs callback, syncs, detaches, and deactivates', async () => {
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
      expect(mockDeactivate).toHaveBeenCalled();
    });

    it('deactivates even if callback throws', async () => {
      const error = new Error('callback failed');
      const callback = jest.fn().mockRejectedValue(error);

      await expect(service.withDocument('doc-1', callback)).rejects.toThrow(
        'callback failed',
      );
      expect(mockDetach).toHaveBeenCalled();
      expect(mockDeactivate).toHaveBeenCalled();
    });

    it('deactivates even if sync throws', async () => {
      mockSync.mockRejectedValueOnce(new Error('sync failed'));
      const callback = jest.fn().mockReturnValue('ok');

      await expect(service.withDocument('doc-1', callback)).rejects.toThrow(
        'sync failed',
      );
      expect(mockDetach).toHaveBeenCalled();
      expect(mockDeactivate).toHaveBeenCalled();
    });

    it('deactivates even if attach throws', async () => {
      mockAttach.mockRejectedValueOnce(new Error('attach failed'));
      const callback = jest.fn();

      await expect(service.withDocument('doc-1', callback)).rejects.toThrow(
        'attach failed',
      );
      expect(callback).not.toHaveBeenCalled();
      expect(mockDeactivate).toHaveBeenCalled();
    });

    it('succeeds even if detach throws (error is swallowed)', async () => {
      mockDetach.mockRejectedValueOnce(new Error('detach failed'));
      const callback = jest.fn().mockReturnValue('ok');

      const result = await service.withDocument('doc-1', callback);

      expect(result).toBe('ok');
      expect(mockDetach).toHaveBeenCalled();
      expect(mockDeactivate).toHaveBeenCalled();
    });

    // === Zombie client prevention tests ===

    it('skips sync for read-only operations', async () => {
      const callback = jest.fn().mockReturnValue('data');

      const result = await service.withDocument('doc-1', callback, {
        syncMode: 'readonly',
      });

      expect(result).toBe('data');
      expect(mockAttach).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
      expect(mockSync).not.toHaveBeenCalled();
      expect(mockDetach).toHaveBeenCalled();
      expect(mockDeactivate).toHaveBeenCalled();
    });

    it('swallows detach error to prevent zombie accumulation', async () => {
      mockSync.mockRejectedValueOnce(new Error('sync failed'));
      mockDetach.mockRejectedValueOnce(new Error('detach also failed'));
      const callback = jest.fn().mockReturnValue('ok');

      // Should throw the original sync error, not the detach error
      await expect(service.withDocument('doc-1', callback)).rejects.toThrow(
        'sync failed',
      );
      // Detach was attempted despite sync failure
      expect(mockDetach).toHaveBeenCalled();
      // Deactivate still runs even when detach fails
      expect(mockDeactivate).toHaveBeenCalled();
    });

    it('swallows detach error on callback failure to preserve original error', async () => {
      mockDetach.mockRejectedValueOnce(new Error('detach failed'));
      const callback = jest
        .fn()
        .mockRejectedValue(new Error('callback error'));

      await expect(service.withDocument('doc-1', callback)).rejects.toThrow(
        'callback error',
      );
      expect(mockDetach).toHaveBeenCalled();
      expect(mockDeactivate).toHaveBeenCalled();
    });

    it('concurrent calls to the same document should not conflict', async () => {
      // Use a deferred barrier for deterministic overlap control
      let releaseBarrier: () => void;
      const barrier = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });

      const slow = async () => {
        await barrier;
        return 'a';
      };
      const fast = () => Promise.resolve('b');

      const promise = Promise.all([
        service.withDocument('doc-1', slow),
        service.withDocument('doc-1', fast),
      ]);

      // Release the barrier after both calls have started
      releaseBarrier!();
      const results = await promise;

      expect(results).toEqual(['a', 'b']);
      // Each call should use its own client (activate called twice)
      expect(mockActivate).toHaveBeenCalledTimes(2);
      expect(mockDeactivate).toHaveBeenCalledTimes(2);
    });
  });
});
