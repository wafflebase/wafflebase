import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_BLOCK_STYLE,
  DocxExporter,
  type Block,
  type Document,
} from '@wafflebase/docs';
import {
  importDocx,
  InvalidDocxError,
  inlineBase64Uploader,
} from '../src/docs/docx-import.js';
import {
  runDocsImport,
  type ImportClient,
  type ImportIO,
} from '../src/docs/import.js';

/**
 * Round-trip a small Document through `DocxExporter` to get a real
 * .docx byte buffer. Avoids hand-crafting OOXML and means importer
 * tests automatically pick up any future exporter changes.
 */
async function makeMinimalDocxBytes(text: string): Promise<Uint8Array> {
  const block: Block = {
    id: 'p1',
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  const doc: Document = { blocks: [block] };
  const blob = await DocxExporter.export(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

const PARAGRAPH_TEXT = 'Hello CLI import';

describe('importDocx', () => {
  it('parses a minimal paragraph .docx into a Document', async () => {
    const buf = await makeMinimalDocxBytes(PARAGRAPH_TEXT);
    const doc = await importDocx(buf);
    expect(doc.blocks.length).toBeGreaterThan(0);
    const text = doc.blocks
      .flatMap((b) => b.inlines.map((i) => i.text))
      .join('');
    expect(text).toContain(PARAGRAPH_TEXT);
  });

  it('wraps parser errors in InvalidDocxError', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(importDocx(garbage)).rejects.toBeInstanceOf(InvalidDocxError);
  });
});

describe('inlineBase64Uploader', () => {
  it('returns a data URL with the blob mime type', async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: 'image/png',
    });
    const url = await inlineBase64Uploader(blob, 'pic.png');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('falls back to filename-derived mime when blob has none', async () => {
    const blob = new Blob([new Uint8Array([0xff])], { type: '' });
    const url = await inlineBase64Uploader(blob, 'photo.jpg');
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('uses application/octet-stream for unknown extensions', async () => {
    const blob = new Blob([new Uint8Array([0x00])], { type: '' });
    const url = await inlineBase64Uploader(blob, 'mystery');
    expect(url.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });
});

interface Capture {
  io: ImportIO;
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
    io: undefined as unknown as ImportIO,
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

interface ClientCapture extends ImportClient {
  createCalls: Array<{ title: string; type?: 'doc' | 'sheet' }>;
  putCalls: Array<{ id: string; bodyHasBlocks: boolean }>;
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
  const newId = opts.newId ?? 'doc-new-id';
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
    putDocContent: async (id, doc) => {
      putCalls.push({
        id,
        bodyHasBlocks: Array.isArray((doc as { blocks?: unknown[] }).blocks),
      });
      return {
        ok: putOk,
        status: putOk ? 200 : 500,
        data: putOk
          ? doc
          : { error: { code: 'PUT_FAILED', message: 'boom' } },
      };
    },
  };
}

describe('runDocsImport (new doc)', () => {
  let bytes: Uint8Array;
  beforeEach(async () => {
    bytes = await makeMinimalDocxBytes(PARAGRAPH_TEXT);
  });

  it('POSTs then PUTs for a new document', async () => {
    const cap = captureIO({ bytes, isTTY: true });
    const client = makeClient({});

    const result = await runDocsImport(
      { file: 'sample.docx' },
      client,
      cap.io,
    );

    expect(result.exitCode).toBe(0);
    expect(client.createCalls).toEqual([
      { title: 'sample', type: 'doc' },
    ]);
    expect(client.putCalls).toHaveLength(1);
    expect(client.putCalls[0].id).toBe('doc-new-id');
    expect(client.putCalls[0].bodyHasBlocks).toBe(true);
    const out = JSON.parse(cap.stdoutLines.join(''));
    expect(out).toEqual({ id: 'doc-new-id', title: 'sample' });
  });

  it('honors --title over the file basename', async () => {
    const cap = captureIO({ bytes, isTTY: true });
    const client = makeClient({});
    await runDocsImport(
      { file: 'sample.docx', title: 'My Doc' },
      client,
      cap.io,
    );
    expect(client.createCalls[0].title).toBe('My Doc');
  });

  it('reads from stdin when file is "-"', async () => {
    const cap = captureIO({ bytes, isTTY: false });
    const client = makeClient({});
    await runDocsImport({ file: '-' }, client, cap.io);
    expect(cap.reads).toEqual(['-']);
    // Default title fallback when reading from stdin
    expect(client.createCalls[0].title).toBe('Untitled');
  });

  it('returns exit 1 + INVALID_DOCX body when the file is not a valid docx', async () => {
    const cap = captureIO({ bytes: new Uint8Array([1, 2, 3]), isTTY: false });
    const client = makeClient({});
    const result = await runDocsImport({ file: 'broken.docx' }, client, cap.io);
    expect(result.exitCode).toBe(1);
    // No requests should have fired
    expect(client.createCalls).toEqual([]);
    expect(client.putCalls).toEqual([]);
    // The error envelope must carry the structured `INVALID_DOCX`
    // code so agents can branch on the cause.
    const body = JSON.parse(cap.stderrLines[0]) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe('INVALID_DOCX');
  });

  it('returns exit 1 + INVALID_DOCX body for --replace path too', async () => {
    const cap = captureIO({ bytes: new Uint8Array([1, 2, 3]), isTTY: false });
    const client = makeClient({});
    const result = await runDocsImport(
      { file: 'broken.docx', replace: 'doc-existing', yes: true },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(1);
    expect(client.putCalls).toEqual([]);
    const body = JSON.parse(cap.stderrLines[0]) as {
      error: { code: string };
    };
    expect(body.error.code).toBe('INVALID_DOCX');
  });

  it('exits 1 when create fails and skips PUT', async () => {
    const cap = captureIO({ bytes, isTTY: true });
    const client = makeClient({ createOk: false });
    const result = await runDocsImport(
      { file: 'sample.docx' },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(1);
    expect(client.putCalls).toEqual([]);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('CREATE_FAILED');
  });

  it('--dry-run prints the plan and makes no requests', async () => {
    const cap = captureIO({ bytes, isTTY: true });
    const client = makeClient({});
    const result = await runDocsImport(
      { file: 'sample.docx', dryRun: true },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(client.createCalls).toEqual([]);
    expect(client.putCalls).toEqual([]);
    const plan = JSON.parse(cap.stdoutLines.join(''));
    expect(plan.method).toBe('POST');
    expect(plan.body.type).toBe('doc');
  });
});

describe('runDocsImport --replace', () => {
  let bytes: Uint8Array;
  beforeEach(async () => {
    bytes = await makeMinimalDocxBytes(PARAGRAPH_TEXT);
  });

  it('--replace --yes PUTs without POSTing', async () => {
    const cap = captureIO({ bytes, isTTY: false });
    const client = makeClient({});
    const result = await runDocsImport(
      { file: 'sample.docx', replace: 'doc-existing', yes: true },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(client.createCalls).toEqual([]);
    expect(client.putCalls).toEqual([
      { id: 'doc-existing', bodyHasBlocks: true },
    ]);
    const out = JSON.parse(cap.stdoutLines.join(''));
    expect(out).toEqual({ id: 'doc-existing', replaced: true });
  });

  it('non-TTY without --yes returns CONFIRMATION_REQ exit 1', async () => {
    const cap = captureIO({ bytes, isTTY: false });
    const client = makeClient({});
    const result = await runDocsImport(
      { file: 'sample.docx', replace: 'doc-existing' },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(1);
    expect(client.createCalls).toEqual([]);
    expect(client.putCalls).toEqual([]);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('CONFIRMATION_REQ');
  });

  it('TTY without --yes prompts and aborts on decline', async () => {
    const cap = captureIO({ bytes, isTTY: true, confirmReply: false });
    const client = makeClient({});
    const result = await runDocsImport(
      { file: 'sample.docx', replace: 'doc-existing' },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(cap.confirmAnswers).toEqual([false]);
    expect(client.putCalls).toEqual([]);
    expect(cap.stderrLines.some((l) => /Aborted/.test(l))).toBe(true);
  });

  it('TTY without --yes prompts and proceeds on accept', async () => {
    const cap = captureIO({ bytes, isTTY: true, confirmReply: true });
    const client = makeClient({});
    const result = await runDocsImport(
      { file: 'sample.docx', replace: 'doc-existing' },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(cap.confirmAnswers).toEqual([true]);
    expect(client.putCalls).toEqual([
      { id: 'doc-existing', bodyHasBlocks: true },
    ]);
  });

  it('--dry-run with --replace prints PUT plan, no requests', async () => {
    const cap = captureIO({ bytes, isTTY: false });
    const client = makeClient({});
    const result = await runDocsImport(
      {
        file: 'sample.docx',
        replace: 'doc-existing',
        yes: true,
        dryRun: true,
      },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(client.putCalls).toEqual([]);
    const plan = JSON.parse(cap.stdoutLines.join(''));
    expect(plan.method).toBe('PUT');
    expect(plan.path).toBe('/documents/doc-existing/content');
    expect(plan.body.blocks).toBeDefined();
  });
});
