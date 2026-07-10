import { YorkieEventController } from './yorkie-event.controller';
import { DocumentService } from './document.service';

describe('YorkieEventController', () => {
  let touchUpdatedAt: jest.Mock;
  let controller: YorkieEventController;

  beforeEach(() => {
    touchUpdatedAt = jest.fn().mockResolvedValue(1);
    controller = new YorkieEventController({
      touchUpdatedAt,
    } as unknown as DocumentService);
  });

  it('advances updatedAt to the event issue time on DocumentRootChanged', async () => {
    await controller.handleEvent({
      type: 'DocumentRootChanged',
      attributes: { key: 'slides-abc', issuedAt: '2026-07-10T06:03:13.331Z' },
    });
    expect(touchUpdatedAt).toHaveBeenCalledWith(
      'abc',
      new Date('2026-07-10T06:03:13.331Z'),
    );
  });

  it('ignores event types other than DocumentRootChanged', async () => {
    await controller.handleEvent({
      type: 'DocumentWatched',
      attributes: { key: 'slides-abc', issuedAt: '2026-07-10T06:03:13.331Z' },
    });
    expect(touchUpdatedAt).not.toHaveBeenCalled();
  });

  it('ignores keys with an unrecognized prefix', async () => {
    await controller.handleEvent({
      type: 'DocumentRootChanged',
      attributes: { key: 'bogus-abc', issuedAt: '2026-07-10T06:03:13.331Z' },
    });
    expect(touchUpdatedAt).not.toHaveBeenCalled();
  });

  it('falls back to now() when issuedAt is missing or unparseable', async () => {
    const before = Date.now();
    await controller.handleEvent({
      type: 'DocumentRootChanged',
      attributes: { key: 'sheet-xyz' },
    });
    expect(touchUpdatedAt).toHaveBeenCalledTimes(1);
    const [id, at] = touchUpdatedAt.mock.calls[0] as [string, Date];
    expect(id).toBe('xyz');
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('always answers ok so Yorkie does not retry', async () => {
    expect(await controller.handleEvent({ type: 'DocumentRootChanged' })).toEqual(
      { ok: true },
    );
  });
});
