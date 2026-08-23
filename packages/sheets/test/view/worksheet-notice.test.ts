import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { Spreadsheet } from '../../src/view/spreadsheet';
import { Sheet } from '../../src/model/worksheet/sheet';
import { MemStore } from '../../src/store/memory';

type NoticeContext = {
  onNoticeCallback?: (message: string) => void;
};

const setOnNotice = Worksheet.prototype.setOnNotice;
const bindRefusalNotices = (
  Worksheet.prototype as unknown as {
    bindRefusalNotices(sheet: Sheet): void;
  }
).bindRefusalNotices;

/**
 * Wires a real `Sheet` to a host notice callback exactly the way
 * `Worksheet.initialize` does, and collects the messages the host receives.
 */
function wire(sheet: Sheet): Array<string> {
  const messages: Array<string> = [];
  const ctx: NoticeContext = {};
  setOnNotice.call(ctx, (message: string) => messages.push(message));
  bindRefusalNotices.call(ctx, sheet);
  return messages;
}

async function mergeA1B1(sheet: Sheet): Promise<void> {
  sheet.selectStart({ r: 1, c: 1 });
  sheet.selectEnd({ r: 1, c: 2 });
  await sheet.mergeSelection();
}

describe('Worksheet refusal notices', () => {
  it('explains a drag-move that would split a merged block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await mergeA1B1(sheet);
    const messages = wire(sheet);

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 1 },
      ],
      { r: 3, c: 1 },
    );

    expect(messages).toEqual([
      "Can't move part of a merged cell. Select the whole merge first.",
    ]);
  });

  it('explains a drop onto part of a merged block', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '5');
    await sheet.setData({ r: 3, c: 1 }, '20');
    sheet.selectStart({ r: 3, c: 1 });
    sheet.selectEnd({ r: 3, c: 2 });
    await sheet.mergeSelection();
    const messages = wire(sheet);

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 1 },
      ],
      { r: 3, c: 1 },
    );

    expect(messages).toEqual([
      "Can't drop onto part of a merged cell. Unmerge the destination first.",
    ]);
  });

  it('explains an autofill across merged cells', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, 'merged');
    await mergeA1B1(sheet);
    const messages = wire(sheet);

    sheet.selectStart({ r: 1, c: 1 });
    await sheet.autofill({ r: 2, c: 1 });

    expect(messages).toEqual([
      "Can't autofill across merged cells. Unmerge them first.",
    ]);
  });

  it('says nothing when the gesture goes through', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await mergeA1B1(sheet);
    const messages = wire(sheet);

    await sheet.moveRangeTo(
      [
        { r: 1, c: 1 },
        { r: 1, c: 2 },
      ],
      { r: 3, c: 1 },
    );

    expect(messages).toEqual([]);
    expect(await sheet.toDisplayString({ r: 3, c: 1 })).toBe('10');
  });

  it('stays silent until a host registers a notice callback', async () => {
    const sheet = new Sheet(new MemStore());
    await sheet.setData({ r: 1, c: 1 }, '10');
    await mergeA1B1(sheet);

    // Bound with no `setOnNotice` — a refusal must not throw.
    const ctx: NoticeContext = {};
    bindRefusalNotices.call(ctx, sheet);

    await expect(
      sheet.moveRangeTo(
        [
          { r: 1, c: 1 },
          { r: 1, c: 1 },
        ],
        { r: 3, c: 1 },
      ),
    ).resolves.toBeUndefined();
  });

  it('hands Spreadsheet.onNotice through to the worksheet', () => {
    const worksheet = { setOnNotice: vi.fn() };
    const callback = vi.fn();

    Spreadsheet.prototype.onNotice.call(
      { worksheet } as unknown as Spreadsheet,
      callback,
    );

    expect(worksheet.setOnNotice).toHaveBeenCalledWith(callback);
  });
});
