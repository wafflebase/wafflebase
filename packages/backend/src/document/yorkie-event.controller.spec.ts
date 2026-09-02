import { YorkieEventController } from './yorkie-event.controller';
import { DocumentService } from './document.service';
import { TemplateReviewSyncService } from '../template/template-review-sync.service';

describe('YorkieEventController', () => {
  let touchUpdatedAt: jest.Mock;
  let onDocumentChanged: jest.Mock;
  let controller: YorkieEventController;

  beforeEach(() => {
    touchUpdatedAt = jest.fn().mockResolvedValue(1);
    onDocumentChanged = jest.fn().mockResolvedValue(undefined);
    controller = new YorkieEventController(
      { touchUpdatedAt } as unknown as DocumentService,
      { onDocumentChanged } as unknown as TemplateReviewSyncService,
    );
  });

  it('tells the template sync about the edit, with the same instant', async () => {
    await controller.handleEvent({
      type: 'DocumentRootChanged',
      attributes: { key: 'sheet-abc', issuedAt: '2020-01-01T00:00:00.000Z' },
    });
    expect(onDocumentChanged).toHaveBeenCalledWith(
      'abc',
      new Date('2020-01-01T00:00:00.000Z'),
    );
  });

  it('still answers ok when the template sync throws', async () => {
    // Yorkie retries a non-200, and a retry storm over template bookkeeping
    // would cost far more than a delayed re-review.
    onDocumentChanged.mockRejectedValue(new Error('db down'));
    await expect(
      controller.handleEvent({
        type: 'DocumentRootChanged',
        attributes: { key: 'sheet-abc' },
      }),
    ).resolves.toEqual({ ok: true });
  });

  it('does not touch templates for an event it ignores', async () => {
    await controller.handleEvent({ type: 'SomethingElse' });
    expect(onDocumentChanged).not.toHaveBeenCalled();
  });

  it('advances updatedAt to the event issue time on DocumentRootChanged', async () => {
    // Use a clearly historical date so the min(issuedAt, now) clamp is a no-op
    // and the assertion can't flake near the event's own wall-clock time.
    await controller.handleEvent({
      type: 'DocumentRootChanged',
      attributes: { key: 'slides-abc', issuedAt: '2020-01-01T00:00:00.000Z' },
    });
    expect(touchUpdatedAt).toHaveBeenCalledWith(
      'abc',
      new Date('2020-01-01T00:00:00.000Z'),
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

  it('clamps a future-skewed issuedAt to now() so it cannot pin updatedAt ahead', async () => {
    const before = Date.now();
    await controller.handleEvent({
      type: 'DocumentRootChanged',
      attributes: { key: 'sheet-xyz', issuedAt: '2999-01-01T00:00:00.000Z' },
    });
    const [, at] = touchUpdatedAt.mock.calls[0] as [string, Date];
    // Stored time is now(), not the year-2999 value.
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(at.getTime()).toBeLessThan(Date.parse('2999-01-01T00:00:00.000Z'));
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
    expect(
      await controller.handleEvent({ type: 'DocumentRootChanged' }),
    ).toEqual({ ok: true });
  });
});
