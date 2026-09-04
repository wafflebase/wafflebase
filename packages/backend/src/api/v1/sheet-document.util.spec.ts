import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiV1CellsController } from './cells.controller';
import { ApiV1TabsController } from './tabs.controller';
import { ApiV1WorksheetController } from './worksheet.controller';
import { ApiV1WorksheetChartsController } from './worksheet-charts.controller';
import { ApiV1WorksheetDimensionsController } from './worksheet-dimensions.controller';
import { ApiV1WorksheetFilterPivotController } from './worksheet-filter-pivot.controller';
import { ApiV1WorksheetRulesController } from './worksheet-rules.controller';
import { ApiV1WorksheetStructureController } from './worksheet-structure.controller';
import { ApiV1WorksheetStylesController } from './worksheet-styles.controller';

const WS = 'ws-1';
const DOC = 'doc-1';

/**
 * The sheet-only families all refuse a wrong document type the same way: a
 * `400` raised before any Yorkie attach, with a message that names what was
 * asked for and what the document actually is.
 *
 * The wording is API surface — a client reads it, and the CLI forwards it
 * verbatim — but until this file existed no test asserted a single one of
 * those strings, so the nine copies of the check could drift (or be
 * consolidated) without anything failing. They are pinned here, at every call
 * site, so the shared helper cannot reword one family by accident.
 */
type GuardCase = {
  /** Name in the test report. */
  name: string;
  /** The exact message the family answers with. */
  message: string;
  /** Invoke one guarded handler with stub services. */
  call: (yorkieService: unknown, documentService: unknown) => Promise<unknown>;
};

const CASES: GuardCase[] = [
  {
    name: 'cells (write)',
    message:
      'Cell writes are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1CellsController(y as never, d as never).setCell(
        WS,
        DOC,
        'tab-1',
        'A1',
        { value: '1' },
      ),
  },
  {
    name: 'cells (read: getCells)',
    message:
      'Cell reads are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1CellsController(y as never, d as never).getCells(
        WS,
        DOC,
        'tab-1',
        undefined,
      ),
  },
  {
    name: 'cells (read: getCell)',
    message:
      'Cell reads are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1CellsController(y as never, d as never).getCell(
        WS,
        DOC,
        'tab-1',
        'A1',
      ),
  },
  {
    name: 'tabs',
    message:
      'Tabs are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1TabsController(y as never, d as never).list(WS, DOC),
  },
  {
    name: 'worksheet settings',
    message:
      'Worksheet settings are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1WorksheetController(y as never, d as never).getFreeze(
        WS,
        DOC,
        'tab-1',
      ),
  },
  {
    name: 'worksheet structure',
    message:
      'Worksheet structure operations are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1WorksheetStructureController(y as never, d as never).clearRange(
        WS,
        DOC,
        'tab-1',
        { range: 'A1:B2' },
      ),
  },
  {
    name: 'worksheet styles',
    message:
      'Worksheet styles are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1WorksheetStylesController(y as never, d as never).getRangeStyles(
        WS,
        DOC,
        'tab-1',
      ),
  },
  {
    name: 'worksheet dimensions',
    message:
      'Worksheet dimensions are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1WorksheetDimensionsController(
        y as never,
        d as never,
      ).getColumnStyles(WS, DOC, 'tab-1'),
  },
  {
    name: 'worksheet rules',
    message:
      'Worksheet rules are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1WorksheetRulesController(
        y as never,
        d as never,
      ).getConditionalFormats(WS, DOC, 'tab-1'),
  },
  {
    name: 'worksheet charts',
    message:
      'Worksheet charts are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1WorksheetChartsController(y as never, d as never).getCharts(
        WS,
        DOC,
        'tab-1',
      ),
  },
  {
    name: 'filter and pivot',
    message:
      'Filter and pivot are only available on sheet documents; "doc-1" is a "doc" document.',
    call: (y, d) =>
      new ApiV1WorksheetFilterPivotController(y as never, d as never).getFilter(
        WS,
        DOC,
        'tab-1',
      ),
  },
];

describe('sheet-only families: wrong document type', () => {
  it.each(CASES.map((c) => [c.name, c] as const))(
    '%s answers 400 with its own wording, before any Yorkie attach',
    async (_name, testCase) => {
      const withDocument = jest.fn();
      const getDocumentOrThrow = jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'doc' });

      const error = await testCase
        .call({ withDocument }, { getDocumentOrThrow })
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as Error).message).toBe(testCase.message);
      // The refusal is what keeps a `sheet-<id>` phantom from being created
      // beside the real document, so it has to happen before the attach.
      expect(withDocument).not.toHaveBeenCalled();
    },
  );

  it.each(['slides', 'note', 'board', 'pdf', 'image', 'file'] as const)(
    'names the actual type in the message for a %s document',
    async (type) => {
      const getDocumentOrThrow = jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type });

      const error = await new ApiV1TabsController(
        { withDocument: jest.fn() } as never,
        { getDocumentOrThrow } as never,
      )
        .list(WS, DOC)
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect((error as Error).message).toBe(
        `Tabs are only available on sheet documents; "${DOC}" is a "${type}" document.`,
      );
    },
  );

  it('lets a workspace-scope 404 through, ahead of any type check', async () => {
    // `assertSheetDocument`'s own doc comment promises this ordering — an id
    // outside the workspace is `404 Document not found` from
    // `getDocumentOrThrow`, before the type is looked at — and it is what
    // stops the guard from telling a caller that an id they may not see
    // exists and what type it is. Nothing pinned it: every case above
    // resolves `getDocumentOrThrow`, so the rejecting path was never taken.
    const withDocument = jest.fn();
    const getDocumentOrThrow = jest
      .fn()
      .mockRejectedValue(new NotFoundException('Document not found'));

    const error = await new ApiV1TabsController(
      { withDocument } as never,
      { getDocumentOrThrow } as never,
    )
      .list(WS, DOC)
      .then(
        () => null,
        (e: unknown) => e,
      );

    // Unconverted: still the 404 the document service raised, not a 400
    // describing a type the caller was never allowed to learn.
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error).not.toBeInstanceOf(BadRequestException);
    expect((error as NotFoundException).getStatus()).toBe(404);
    expect((error as Error).message).toBe('Document not found');
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('passes a sheet document through to the handler', async () => {
    const withDocument = jest.fn().mockResolvedValue([]);
    const getDocumentOrThrow = jest
      .fn()
      .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' });

    await new ApiV1TabsController(
      { withDocument } as never,
      { getDocumentOrThrow } as never,
    ).list(WS, DOC);

    expect(withDocument).toHaveBeenCalledTimes(1);
    expect(getDocumentOrThrow).toHaveBeenCalledWith({
      id: DOC,
      workspaceId: WS,
    });
  });
});
