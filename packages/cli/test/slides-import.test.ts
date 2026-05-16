import { describe, it, expect } from 'vitest';
import {
  ImportReport,
  type SlidesDocument,
} from '@wafflebase/slides/node';
import {
  runSlidesImport,
  type SlidesImportClient,
  type SlidesImportIO,
  type SlidesImportParser,
} from '../src/slides/import.js';
import { InvalidPptxError } from '../src/slides/pptx-import.js';

/**
 * Build a minimal `SlidesDocument` the orchestrator can hand to the
 * stub client. The parser is mocked in every test below so the
 * document just needs to satisfy the shape — no theme/master fidelity.
 */
function makeDeck(title = 'Stub Deck'): SlidesDocument {
  return {
    meta: { title, themeId: 'default-light', masterId: 'default' },
    themes: [],
    masters: [],
    layouts: [],
    slides: [
      {
        id: 'slide-1',
        layoutId: 'title-body',
        background: { fill: { kind: 'role', role: 'background' } },
        elements: [],
        notes: [],
      },
    ],
  } as unknown as SlidesDocument;
}

function makeReport(skippedImages = 0): ImportReport {
  const r = new ImportReport();
  r.skippedImages = skippedImages;
  return r;
}

/**
 * Default test parser — returns a one-slide deck and an empty report.
 * Individual tests can override (e.g. to throw `InvalidPptxError`).
 */
const stubParser: SlidesImportParser = async () => ({
  document: makeDeck(),
  report: makeReport(),
});

interface Capture {
  io: SlidesImportIO;
  stdoutLines: string[];
  stderrLines: string[];
  reads: string[];
  confirmAnswers: boolean[];
}

function captureIO(opts: {
  bytes: Uint8Array;
  isTTY: boolean;
  confirmReply?: boolean;
}): Capture {
  const cap: Capture = {
    stdoutLines: [],
    stderrLines: [],
    reads: [],
    confirmAnswers: [],
    io: undefined as unknown as SlidesImportIO,
  };
  cap.io = {
    stdout: (line) => {
      cap.stdoutLines.push(line);
    },
    stderr: (line) => {
      cap.stderrLines.push(line);
    },
    readBytes: async (path) => {
      cap.reads.push(path);
      return opts.bytes;
    },
    confirm: async () => {
      const answer = opts.confirmReply ?? false;
      cap.confirmAnswers.push(answer);
      return answer;
    },
    isTTY: opts.isTTY,
  };
  return cap;
}

interface ClientCapture extends SlidesImportClient {
  createCalls: Array<{ title: string; type?: 'doc' | 'sheet' | 'slides' }>;
  putCalls: Array<{ id: string; slideCount: number }>;
}

function makeClient(opts: {
  createOk?: boolean;
  putOk?: boolean;
  newId?: string;
}): ClientCapture {
  const createCalls: ClientCapture['createCalls'] = [];
  const putCalls: ClientCapture['putCalls'] = [];
  const createOk = opts.createOk ?? true;
  const putOk = opts.putOk ?? true;
  const newId = opts.newId ?? 'slides-new-id';
  return {
    createCalls,
    putCalls,
    createDocument: async (title, type) => {
      createCalls.push({ title, type });
      return {
        ok: createOk,
        status: createOk ? 200 : 500,
        data: createOk
          ? { id: newId, title }
          : { error: { code: 'CREATE_FAILED', message: 'boom' } },
      };
    },
    putSlidesContent: async (id, deck) => {
      putCalls.push({ id, slideCount: deck.slides.length });
      return {
        ok: putOk,
        status: putOk ? 200 : 500,
        data: putOk ? deck : { error: { code: 'PUT_FAILED', message: 'boom' } },
      };
    },
  };
}

const BYTES = new Uint8Array([1, 2, 3]); // Opaque — parser is stubbed.

describe('runSlidesImport (new deck)', () => {
  it('POSTs then PUTs for a new deck', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: true });
    const client = makeClient({});

    const result = await runSlidesImport(
      { file: 'sample.pptx', parser: stubParser },
      client,
      cap.io,
    );

    expect(result.exitCode).toBe(0);
    expect(client.createCalls).toEqual([
      { title: 'sample', type: 'slides' },
    ]);
    expect(client.putCalls).toHaveLength(1);
    expect(client.putCalls[0].id).toBe('slides-new-id');
    expect(client.putCalls[0].slideCount).toBe(1);
    const out = JSON.parse(cap.stdoutLines.join(''));
    expect(out.id).toBe('slides-new-id');
    expect(out.title).toBe('sample');
    expect(out.report).toMatchObject({ skippedImages: 0 });
  });

  it('honors --title over the file basename', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: true });
    const client = makeClient({});
    await runSlidesImport(
      { file: 'sample.pptx', title: 'My Deck', parser: stubParser },
      client,
      cap.io,
    );
    expect(client.createCalls[0].title).toBe('My Deck');
  });

  it('reads from stdin when file is "-"', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: false });
    const client = makeClient({});
    await runSlidesImport(
      { file: '-', parser: stubParser },
      client,
      cap.io,
    );
    expect(cap.reads).toEqual(['-']);
    expect(client.createCalls[0].title).toBe('Untitled');
  });

  it('exits 1 + INVALID_PPTX body when parser throws', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: false });
    const client = makeClient({});
    const badParser: SlidesImportParser = async () => {
      throw new InvalidPptxError('zip layout missing presentation.xml');
    };
    const result = await runSlidesImport(
      { file: 'broken.pptx', parser: badParser },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(1);
    expect(client.createCalls).toEqual([]);
    expect(client.putCalls).toEqual([]);
    const body = JSON.parse(cap.stderrLines[0]) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('INVALID_PPTX');
  });

  it('exits 1 when create fails and skips PUT', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: true });
    const client = makeClient({ createOk: false });
    const result = await runSlidesImport(
      { file: 'sample.pptx', parser: stubParser },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(1);
    expect(client.putCalls).toEqual([]);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('CREATE_FAILED');
  });

  it('exits 1 when create returns no id', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: true });
    const client: ClientCapture = {
      createCalls: [],
      putCalls: [],
      createDocument: async () => ({
        ok: true,
        status: 200,
        data: {},
      }),
      putSlidesContent: async () => ({
        ok: true,
        status: 200,
        data: makeDeck(),
      }),
    };
    const result = await runSlidesImport(
      { file: 'sample.pptx', parser: stubParser },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(1);
    expect(client.putCalls).toEqual([]);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('INVALID_RESPONSE');
  });

  it('exits 1 when PUT fails', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: true });
    const client = makeClient({ putOk: false });
    const result = await runSlidesImport(
      { file: 'sample.pptx', parser: stubParser },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(1);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('PUT_FAILED');
  });

  it('--dry-run prints the plan and makes no requests', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: true });
    const client = makeClient({});
    const result = await runSlidesImport(
      { file: 'sample.pptx', dryRun: true, parser: stubParser },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(client.createCalls).toEqual([]);
    expect(client.putCalls).toEqual([]);
    const plan = JSON.parse(cap.stdoutLines.join(''));
    expect(plan.method).toBe('POST');
    expect(plan.body.type).toBe('slides');
    expect(plan.report).toBeDefined();
  });

  it('surfaces skippedImages count in the report', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: true });
    const client = makeClient({});
    const parserWithSkips: SlidesImportParser = async () => ({
      document: makeDeck(),
      report: makeReport(5),
    });
    await runSlidesImport(
      { file: 'sample.pptx', parser: parserWithSkips },
      client,
      cap.io,
    );
    const out = JSON.parse(cap.stdoutLines.join(''));
    expect(out.report.skippedImages).toBe(5);
  });
});

describe('runSlidesImport (--replace)', () => {
  it('confirms then PUTs when interactive and user accepts', async () => {
    const cap = captureIO({
      bytes: BYTES,
      isTTY: true,
      confirmReply: true,
    });
    const client = makeClient({});
    const result = await runSlidesImport(
      { file: 'sample.pptx', replace: 'doc-existing', parser: stubParser },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(client.createCalls).toEqual([]);
    expect(client.putCalls).toEqual([
      { id: 'doc-existing', slideCount: 1 },
    ]);
    const body = JSON.parse(cap.stdoutLines.join(''));
    expect(body.id).toBe('doc-existing');
    expect(body.replaced).toBe(true);
  });

  it('aborts when interactive user declines', async () => {
    const cap = captureIO({
      bytes: BYTES,
      isTTY: true,
      confirmReply: false,
    });
    const client = makeClient({});
    const result = await runSlidesImport(
      { file: 'sample.pptx', replace: 'doc-existing', parser: stubParser },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(client.putCalls).toEqual([]);
  });

  it('--yes skips the confirm prompt', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: true });
    const client = makeClient({});
    const result = await runSlidesImport(
      {
        file: 'sample.pptx',
        replace: 'doc-existing',
        yes: true,
        parser: stubParser,
      },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(cap.confirmAnswers).toEqual([]);
    expect(client.putCalls).toEqual([
      { id: 'doc-existing', slideCount: 1 },
    ]);
  });

  it('exits 1 + CONFIRMATION_REQ when non-TTY without --yes', async () => {
    const cap = captureIO({ bytes: BYTES, isTTY: false });
    const client = makeClient({});
    const result = await runSlidesImport(
      { file: 'sample.pptx', replace: 'doc-existing', parser: stubParser },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(1);
    expect(client.putCalls).toEqual([]);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('CONFIRMATION_REQ');
  });
});
