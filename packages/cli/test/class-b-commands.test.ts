import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  listBoardElements: vi.fn(),
  addBoardStickies: vi.fn(),
  addBoardSection: vi.fn(),
  moveBoardElements: vi.fn(),
  addBoardText: vi.fn(),
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
    listBoardElements = (...a: unknown[]) => calls.listBoardElements(...a);
    addBoardStickies = (...a: unknown[]) => calls.addBoardStickies(...a);
    addBoardSection = (...a: unknown[]) => calls.addBoardSection(...a);
    moveBoardElements = (...a: unknown[]) => calls.moveBoardElements(...a);
    addBoardText = (...a: unknown[]) => calls.addBoardText(...a);
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
  describe('board editing', () => {
    const summary = {
      elements: [
        {
          id: 's1',
          kind: 'section',
          title: 'Speed',
          frame: { x: 0, y: 0, w: 400, h: 300, rotation: 0 },
        },
        {
          id: 'a',
          kind: 'sticky',
          text: 'Ship\nfaster',
          color: '#FFF8B8',
          section: 's1',
          frame: { x: 10.4, y: 20, w: 180, h: 180, rotation: 0 },
        },
      ],
    };

    it('lists elements as JSON, filtered by --kind', async () => {
      calls.listBoardElements.mockResolvedValue(ok(summary));
      await run(['board', 'elements', 'doc-1', '--kind', 'sticky']);
      expect(calls.listBoardElements).toHaveBeenCalledWith('doc-1');
      const out = JSON.parse(stdout.join('\n'));
      expect(out.elements.map((e: { id: string }) => e.id)).toEqual(['a']);
    });

    it('flattens elements to one row each for a table', async () => {
      calls.listBoardElements.mockResolvedValue(ok(summary));
      await run(['board', 'elements', 'doc-1', '--format', 'csv']);
      const csv = stdout.join('\n');
      expect(csv).toContain('id,kind,section,text');
      expect(csv).toContain('a,sticky,s1,Ship / faster,#FFF8B8,10,20,180,180');
    });

    it('adds stickies from --text and from a --file, one per line', async () => {
      calls.addBoardStickies.mockResolvedValue(ok({ ids: ['n1', 'n2', 'n3'] }));
      const dir = mkdtempSync(join(tmpdir(), 'wfb-board-'));
      const file = join(dir, 'ideas.txt');
      writeFileSync(file, 'two\n\n  three  \n');
      await run([
        'board', 'add-stickies', 'doc-1',
        '--text', 'one', '--file', file, '--color', 'blue', '--near', 's1', '--columns', '2',
      ]);
      expect(calls.addBoardStickies).toHaveBeenCalledWith('doc-1', {
        texts: ['one', 'two', 'three'],
        color: 'blue',
        near: 's1',
        columns: 2,
      });
    });

    it('refuses an empty add-stickies before sending', async () => {
      await run(['board', 'add-stickies', 'doc-1']);
      expect(calls.addBoardStickies).not.toHaveBeenCalled();
      expect(errorMessage()).toMatch(/--text/);
    });

    it('adds a grid section around ids, previewed by --dry-run', async () => {
      await run([
        'board', 'add-section', 'doc-1',
        '--title', 'Speed', '--ids', 'a, b', '--grid', '--at', '100,-50', '--color', 'green',
        '--dry-run',
      ]);
      expect(calls.addBoardSection).not.toHaveBeenCalled();
      expect(JSON.parse(stdout.join('\n'))).toEqual({
        dry_run: true,
        method: 'POST',
        url: `${BASE}/documents/doc-1/board/sections`,
        body: {
          title: 'Speed',
          elementIds: ['a', 'b'],
          layout: 'grid',
          at: { x: 100, y: -50 },
          color: 'green',
        },
      });
    });

    it('refuses --grid without --ids and a malformed --frame', async () => {
      await run(['board', 'add-section', 'doc-1', '--title', 'T', '--grid']);
      expect(errorMessage()).toMatch(/--ids/);
      stderr.length = 0;
      await run(['board', 'add-section', 'doc-1', '--title', 'T', '--frame', '1,2,3']);
      expect(errorMessage()).toMatch(/x,y,w,h/);
      expect(calls.addBoardSection).not.toHaveBeenCalled();
    });

    it('moves elements from --data and refuses a non-array', async () => {
      calls.moveBoardElements.mockResolvedValue(ok({ moved: ['a'], carried: [] }));
      await run(['board', 'move', 'doc-1', '--data', '[{"id":"a","x":1,"y":2}]']);
      expect(calls.moveBoardElements).toHaveBeenCalledWith('doc-1', [
        { id: 'a', x: 1, y: 2 },
      ]);
      calls.moveBoardElements.mockReset();
      await run(['board', 'move', 'doc-1', '--data', '{"id":"a"}']);
      expect(calls.moveBoardElements).not.toHaveBeenCalled();
      expect(errorMessage()).toMatch(/array/);
    });

    it('adds a text box beside a section', async () => {
      calls.addBoardText.mockResolvedValue(ok({ id: 't1' }));
      await run([
        'board', 'add-text', 'doc-1',
        '--text', 'Summary', '--near', 's1', '--side', 'below', '--bold',
      ]);
      expect(calls.addBoardText).toHaveBeenCalledWith('doc-1', {
        text: 'Summary',
        near: 's1',
        side: 'below',
        bold: true,
      });
    });

    it('refuses add-text with half a position', async () => {
      await run(['board', 'add-text', 'doc-1', '--text', 'x', '--x', '5']);
      expect(calls.addBoardText).not.toHaveBeenCalled();
      expect(errorMessage()).toMatch(/--x and --y/);
    });
  });
});
