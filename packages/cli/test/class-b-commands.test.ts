import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/commands/root.js';
import { registerTabsCommand } from '../src/commands/tabs.js';
import { registerSheetsImagesCommand } from '../src/commands/sheets-images.js';
import { registerSlidesEditCommand } from '../src/commands/slides-edit.js';
import { registerCommentsCommand } from '../src/commands/comments.js';
import { registerBoardCommand } from '../src/commands/board.js';

/**
 * The commands that close class B of the capability audit — comment threads,
 * per-slide editing, tab rearrange, worksheet images and board content.
 *
 * Driven through the REAL commander tree, because what is worth guarding is
 * the action handler's wiring: which client method each verb reaches for, what
 * it sends, and — for anything that parses a number or an anchor — that the
 * refusal happens *before* the dry-run branch, so a preview never shows a
 * request the server would reject.
 */

const calls = {
  deleteTab: vi.fn(),
  moveTab: vi.fn(),
  duplicateTab: vi.fn(),
  getWorksheetImages: vi.fn(),
  setWorksheetImages: vi.fn(),
  listSlideLayouts: vi.fn(),
  addSlide: vi.fn(),
  duplicateSlide: vi.fn(),
  moveSlide: vi.fn(),
  deleteSlide: vi.fn(),
  listComments: vi.fn(),
  createCommentThread: vi.fn(),
  replyToComment: vi.fn(),
  setCommentResolved: vi.fn(),
  deleteCommentThread: vi.fn(),
  deleteComment: vi.fn(),
  getBoardContent: vi.fn(),
  putBoardContent: vi.fn(),
};

vi.mock('../src/client/http-client.js', () => ({
  HttpClient: class {
    deleteTab = (...a: unknown[]) => calls.deleteTab(...a);
    moveTab = (...a: unknown[]) => calls.moveTab(...a);
    duplicateTab = (...a: unknown[]) => calls.duplicateTab(...a);
    getWorksheetImages = (...a: unknown[]) => calls.getWorksheetImages(...a);
    setWorksheetImages = (...a: unknown[]) => calls.setWorksheetImages(...a);
    listSlideLayouts = (...a: unknown[]) => calls.listSlideLayouts(...a);
    addSlide = (...a: unknown[]) => calls.addSlide(...a);
    duplicateSlide = (...a: unknown[]) => calls.duplicateSlide(...a);
    moveSlide = (...a: unknown[]) => calls.moveSlide(...a);
    deleteSlide = (...a: unknown[]) => calls.deleteSlide(...a);
    listComments = (...a: unknown[]) => calls.listComments(...a);
    createCommentThread = (...a: unknown[]) => calls.createCommentThread(...a);
    replyToComment = (...a: unknown[]) => calls.replyToComment(...a);
    setCommentResolved = (...a: unknown[]) => calls.setCommentResolved(...a);
    deleteCommentThread = (...a: unknown[]) => calls.deleteCommentThread(...a);
    deleteComment = (...a: unknown[]) => calls.deleteComment(...a);
    getBoardContent = (...a: unknown[]) => calls.getBoardContent(...a);
    putBoardContent = (...a: unknown[]) => calls.putBoardContent(...a);
  },
}));

const SERVER = 'https://api.example.test';
const WORKSPACE = 'ws-1';
const BASE = `${SERVER}/api/v1/workspaces/${WORKSPACE}`;

function run(argv: string[]) {
  const program = createProgram();
  const sheets = program.command('sheets');
  registerTabsCommand(sheets);
  registerSheetsImagesCommand(sheets);
  registerSlidesEditCommand(program.command('slides'));
  registerCommentsCommand(program);
  registerBoardCommand(program);
  return program.parseAsync(
    [
      '--server',
      SERVER,
      '--workspace',
      WORKSPACE,
      '--api-key',
      'wfb_test',
      ...argv,
    ],
    { from: 'user' },
  );
}

const ok = (data: unknown) => ({ ok: true, status: 200, data });

describe('class B commands', () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    for (const fn of Object.values(calls)) fn.mockReset();
    vi.spyOn(console, 'log').mockImplementation((v) => {
      stdout.push(String(v));
    });
    vi.spyOn(console, 'error').mockImplementation((v) => {
      stderr.push(String(v));
    });
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function errorMessage(): string {
    return (
      JSON.parse(stderr.join('\n')) as { error: { message: string } }
    ).error.message;
  }

  describe('sheets tabs', () => {
    it('deletes a tab', async () => {
      calls.deleteTab.mockResolvedValue(ok({ id: 'tab-2', deleted: true }));
      await run(['sheets', 'tabs', 'delete', 'doc-1', 'tab-2']);
      expect(calls.deleteTab).toHaveBeenCalledWith('doc-1', 'tab-2');
    });

    it('moves a tab to a 1-based position', async () => {
      calls.moveTab.mockResolvedValue(ok({ id: 'tab-2', index: 1 }));
      await run(['sheets', 'tabs', 'move', 'doc-1', 'tab-2', '1']);
      expect(calls.moveTab).toHaveBeenCalledWith('doc-1', 'tab-2', 1);
    });

    it('refuses a non-positive index before the dry-run branch', async () => {
      await run(['sheets', 'tabs', 'move', 'doc-1', 'tab-2', '0', '--dry-run']);
      expect(calls.moveTab).not.toHaveBeenCalled();
      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(errorMessage()).toMatch(/positive integer/);
    });

    it('duplicates a tab, leaving the name to the server when omitted', async () => {
      calls.duplicateTab.mockResolvedValue(ok({ id: 'tab-9' }));
      await run(['sheets', 'tabs', 'duplicate', 'doc-1', 'tab-1']);
      expect(calls.duplicateTab).toHaveBeenCalledWith(
        'doc-1',
        'tab-1',
        undefined,
      );
    });

    it('previews the duplicate request under --dry-run', async () => {
      await run([
        'sheets',
        'tabs',
        'duplicate',
        'doc-1',
        'tab-1',
        'Q3',
        '--dry-run',
      ]);
      expect(calls.duplicateTab).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${BASE}/documents/doc-1/tabs/tab-1/duplicate`,
        body: { name: 'Q3' },
      });
    });
  });

  describe('sheets images', () => {
    it('reads the collection for the default tab', async () => {
      calls.getWorksheetImages.mockResolvedValue(ok({ images: [] }));
      await run(['sheets', 'images', 'get', 'doc-1']);
      expect(calls.getWorksheetImages).toHaveBeenCalledWith('doc-1', 'tab-1');
    });

    it('accepts the envelope its own get prints, so a pipe round-trips', async () => {
      calls.setWorksheetImages.mockResolvedValue(ok({ images: [] }));
      await run([
        'sheets',
        'images',
        'set',
        'doc-1',
        '--data',
        '{"images":[{"id":"i1","src":"/x.png","anchor":"A1","offsetX":0,"offsetY":0,"width":10,"height":10}]}',
      ]);
      expect(calls.setWorksheetImages).toHaveBeenCalledWith(
        'doc-1',
        'tab-1',
        [expect.objectContaining({ id: 'i1' })],
      );
    });

    it('rejects a payload that is neither an array nor that envelope', async () => {
      await run(['sheets', 'images', 'set', 'doc-1', '--data', '{"id":"i1"}']);
      expect(calls.setWorksheetImages).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(errorMessage()).toMatch(/expected a JSON array of images/);
    });
  });

  describe('slides', () => {
    it('lists the deck layouts', async () => {
      calls.listSlideLayouts.mockResolvedValue(ok({ layouts: [] }));
      await run(['slides', 'layouts', 'doc-1']);
      expect(calls.listSlideLayouts).toHaveBeenCalledWith('doc-1');
    });

    it('adds a slide, defaulting the layout to blank and appending', async () => {
      calls.addSlide.mockResolvedValue(ok({ id: 's1', index: 1 }));
      await run(['slides', 'slide', 'add', 'doc-1']);
      // No `index` key at all: an explicit `undefined` would serialize away,
      // but "append" and "insert at some position" are different requests.
      expect(calls.addSlide).toHaveBeenCalledWith('doc-1', {
        layoutId: 'blank',
      });
    });

    it('passes --layout and --index through', async () => {
      calls.addSlide.mockResolvedValue(ok({ id: 's1' }));
      await run([
        'slides',
        'slide',
        'add',
        'doc-1',
        '--layout',
        'title-body',
        '--index',
        '2',
      ]);
      expect(calls.addSlide).toHaveBeenCalledWith('doc-1', {
        layoutId: 'title-body',
        index: 2,
      });
    });

    it('refuses a zero --index before previewing it', async () => {
      await run(['slides', 'slide', 'add', 'doc-1', '--index', '0', '--dry-run']);
      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(errorMessage()).toMatch(/positive integer/);
    });

    it('duplicates, moves and deletes a slide', async () => {
      calls.duplicateSlide.mockResolvedValue(ok({ id: 's2' }));
      calls.moveSlide.mockResolvedValue(ok({ id: 's2', index: 1 }));
      calls.deleteSlide.mockResolvedValue(ok({ slideCount: 1 }));

      await run(['slides', 'slide', 'duplicate', 'doc-1', 's1']);
      await run(['slides', 'slide', 'move', 'doc-1', 's1', '1']);
      await run(['slides', 'slide', 'delete', 'doc-1', 's1']);

      expect(calls.duplicateSlide).toHaveBeenCalledWith('doc-1', 's1');
      expect(calls.moveSlide).toHaveBeenCalledWith('doc-1', 's1', 1);
      expect(calls.deleteSlide).toHaveBeenCalledWith('doc-1', 's1');
    });
  });

  describe('comments', () => {
    it('lists threads', async () => {
      calls.listComments.mockResolvedValue(ok({ threads: [] }));
      await run(['comments', 'list', 'doc-1']);
      expect(calls.listComments).toHaveBeenCalledWith('doc-1');
    });

    it('anchors a sheet thread on a cell reference', async () => {
      calls.createCommentThread.mockResolvedValue(ok({ id: 't1' }));
      await run(['comments', 'add', 'doc-1', 'check this', '--ref', 'B2']);
      expect(calls.createCommentThread).toHaveBeenCalledWith('doc-1', {
        body: 'check this',
        tabId: 'tab-1',
        ref: 'B2',
      });
    });

    it('anchors a PDF thread on a page rectangle', async () => {
      calls.createCommentThread.mockResolvedValue(ok({ id: 't1' }));
      await run([
        'comments',
        'add',
        'doc-1',
        'illegible',
        '--page',
        '2',
        '--rect',
        '0.1,0.2,0.3,0.4',
      ]);
      expect(calls.createCommentThread).toHaveBeenCalledWith('doc-1', {
        body: 'illegible',
        pageIndex: 2,
        rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      });
    });

    it('refuses a thread with no anchor at all', async () => {
      await run(['comments', 'add', 'doc-1', 'hi']);
      expect(calls.createCommentThread).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(errorMessage()).toMatch(/An anchor is required/);
    });

    it('refuses a rectangle outside the page, before previewing it', async () => {
      await run([
        'comments',
        'add',
        'doc-1',
        'hi',
        '--page',
        '0',
        '--rect',
        '0,0,2,1',
        '--dry-run',
      ]);
      expect(stdout).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(errorMessage()).toMatch(/four numbers between 0 and 1/);
    });

    it('replies, resolves, unresolves and deletes', async () => {
      calls.replyToComment.mockResolvedValue(ok({ threadId: 't1' }));
      calls.setCommentResolved.mockResolvedValue(ok({ id: 't1' }));
      calls.deleteCommentThread.mockResolvedValue(ok({ id: 't1' }));
      calls.deleteComment.mockResolvedValue(ok({ id: 'c2' }));

      await run(['comments', 'reply', 'doc-1', 't1', 'fixed']);
      await run(['comments', 'resolve', 'doc-1', 't1']);
      await run(['comments', 'unresolve', 'doc-1', 't1']);
      await run(['comments', 'delete', 'doc-1', 't1']);
      await run(['comments', 'delete-comment', 'doc-1', 't1', 'c2']);

      expect(calls.replyToComment).toHaveBeenCalledWith('doc-1', 't1', 'fixed');
      expect(calls.setCommentResolved).toHaveBeenNthCalledWith(
        1,
        'doc-1',
        't1',
        true,
      );
      expect(calls.setCommentResolved).toHaveBeenNthCalledWith(
        2,
        'doc-1',
        't1',
        false,
      );
      expect(calls.deleteCommentThread).toHaveBeenCalledWith('doc-1', 't1');
      expect(calls.deleteComment).toHaveBeenCalledWith('doc-1', 't1', 'c2');
    });
  });

  describe('board', () => {
    it('reads board content', async () => {
      calls.getBoardContent.mockResolvedValue(
        ok({ meta: { title: 'Retro' }, elements: [] }),
      );
      await run(['board', 'content', 'doc-1']);
      expect(calls.getBoardContent).toHaveBeenCalledWith('doc-1');
      expect(JSON.parse(stdout.join('\n'))).toMatchObject({
        meta: { title: 'Retro' },
      });
    });

    it('writes board content from --data', async () => {
      calls.putBoardContent.mockResolvedValue(
        ok({ meta: { title: 'Retro' }, elements: [] }),
      );
      await run([
        'board',
        'set-content',
        'doc-1',
        '--data',
        '{"meta":{"title":"Retro"},"elements":[]}',
      ]);
      expect(calls.putBoardContent).toHaveBeenCalledWith('doc-1', {
        meta: { title: 'Retro' },
        elements: [],
      });
    });

    it('previews the write without sending it', async () => {
      await run([
        'board',
        'set-content',
        'doc-1',
        '--data',
        '{"meta":{"title":"Retro"},"elements":[]}',
        '--dry-run',
      ]);
      expect(calls.putBoardContent).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'PUT',
        url: `${BASE}/documents/doc-1/content`,
        body: { meta: { title: 'Retro' }, elements: [] },
      });
    });
  });
});
