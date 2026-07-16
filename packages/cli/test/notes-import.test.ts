import { describe, it, expect } from 'vitest';
import {
  runNotesImport,
  type NotesImportClient,
  type NotesImportIO,
} from '../src/notes/import.js';

interface Capture {
  io: NotesImportIO;
  stdoutLines: string[];
  stderrLines: string[];
  reads: string[];
  confirmAnswers: boolean[];
}

function captureIO(opts: {
  text: string;
  isTTY: boolean;
  confirmReply?: boolean;
}): Capture {
  const cap: Capture = {
    stdoutLines: [],
    stderrLines: [],
    reads: [],
    confirmAnswers: [],
    io: undefined as unknown as NotesImportIO,
  };
  cap.io = {
    stdout: (line) => {
      cap.stdoutLines.push(line);
    },
    stderr: (line) => {
      cap.stderrLines.push(line);
    },
    readText: async (path) => {
      cap.reads.push(path);
      return opts.text;
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

interface ClientCapture extends NotesImportClient {
  createCalls: Array<{ title: string; type?: 'doc' | 'sheet' | 'slides' | 'note' }>;
  putCalls: Array<{ id: string; content: string }>;
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
  const newId = opts.newId ?? 'note-new-id';
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
    putNoteContent: async (id, note) => {
      putCalls.push({ id, content: note.content });
      return {
        ok: putOk,
        status: putOk ? 200 : 500,
        data: putOk ? note : { error: { code: 'PUT_FAILED', message: 'boom' } },
      };
    },
  };
}

const MD = '# Notes\n\nSome markdown body.';

describe('runNotesImport (new note)', () => {
  it('POSTs then PUTs for a new note', async () => {
    const cap = captureIO({ text: MD, isTTY: true });
    const client = makeClient({});

    const result = await runNotesImport(
      { file: 'sample.md' },
      client,
      cap.io,
    );

    expect(result.exitCode).toBe(0);
    expect(client.createCalls).toEqual([{ title: 'sample', type: 'note' }]);
    expect(client.putCalls).toEqual([{ id: 'note-new-id', content: MD }]);
    const out = JSON.parse(cap.stdoutLines.join(''));
    expect(out.id).toBe('note-new-id');
    expect(out.title).toBe('sample');
  });

  it('honors --title over the file basename', async () => {
    const cap = captureIO({ text: MD, isTTY: true });
    const client = makeClient({});
    await runNotesImport(
      { file: 'sample.md', title: 'My Note' },
      client,
      cap.io,
    );
    expect(client.createCalls[0].title).toBe('My Note');
  });

  it('reads from stdin when file is "-"', async () => {
    const cap = captureIO({ text: MD, isTTY: false });
    const client = makeClient({});
    await runNotesImport({ file: '-' }, client, cap.io);
    expect(cap.reads).toEqual(['-']);
    expect(client.createCalls[0].title).toBe('Untitled');
  });

  it('exits 1 when create fails and skips PUT', async () => {
    const cap = captureIO({ text: MD, isTTY: true });
    const client = makeClient({ createOk: false });
    const result = await runNotesImport({ file: 'sample.md' }, client, cap.io);
    expect(result.exitCode).toBe(1);
    expect(client.putCalls).toEqual([]);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('CREATE_FAILED');
  });

  it('exits 1 when create returns no id', async () => {
    const cap = captureIO({ text: MD, isTTY: true });
    const client: ClientCapture = {
      createCalls: [],
      putCalls: [],
      createDocument: async () => ({ ok: true, status: 200, data: {} }),
      putNoteContent: async () => ({ ok: true, status: 200, data: { content: MD } }),
    };
    const result = await runNotesImport({ file: 'sample.md' }, client, cap.io);
    expect(result.exitCode).toBe(1);
    expect(client.putCalls).toEqual([]);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('INVALID_RESPONSE');
  });

  it('exits 1 when PUT fails', async () => {
    const cap = captureIO({ text: MD, isTTY: true });
    const client = makeClient({ putOk: false });
    const result = await runNotesImport({ file: 'sample.md' }, client, cap.io);
    expect(result.exitCode).toBe(1);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('PUT_FAILED');
  });

  it('--dry-run prints the plan and makes no requests', async () => {
    const cap = captureIO({ text: MD, isTTY: true });
    const client = makeClient({});
    const result = await runNotesImport(
      { file: 'sample.md', dryRun: true },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(client.createCalls).toEqual([]);
    expect(client.putCalls).toEqual([]);
    const plan = JSON.parse(cap.stdoutLines.join(''));
    expect(plan.method).toBe('POST');
    expect(plan.body.type).toBe('note');
  });
});

describe('runNotesImport (--replace)', () => {
  it('confirms then PUTs when interactive and user accepts', async () => {
    const cap = captureIO({ text: MD, isTTY: true, confirmReply: true });
    const client = makeClient({});
    const result = await runNotesImport(
      { file: 'sample.md', replace: 'note-existing' },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(client.createCalls).toEqual([]);
    expect(client.putCalls).toEqual([{ id: 'note-existing', content: MD }]);
    const body = JSON.parse(cap.stdoutLines.join(''));
    expect(body.id).toBe('note-existing');
    expect(body.replaced).toBe(true);
  });

  it('aborts when interactive user declines', async () => {
    const cap = captureIO({ text: MD, isTTY: true, confirmReply: false });
    const client = makeClient({});
    const result = await runNotesImport(
      { file: 'sample.md', replace: 'note-existing' },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(client.putCalls).toEqual([]);
  });

  it('--yes skips the confirm prompt', async () => {
    const cap = captureIO({ text: MD, isTTY: true });
    const client = makeClient({});
    const result = await runNotesImport(
      { file: 'sample.md', replace: 'note-existing', yes: true },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(0);
    expect(cap.confirmAnswers).toEqual([]);
    expect(client.putCalls).toEqual([{ id: 'note-existing', content: MD }]);
  });

  it('exits 1 + CONFIRMATION_REQ when non-TTY without --yes', async () => {
    const cap = captureIO({ text: MD, isTTY: false });
    const client = makeClient({});
    const result = await runNotesImport(
      { file: 'sample.md', replace: 'note-existing' },
      client,
      cap.io,
    );
    expect(result.exitCode).toBe(1);
    expect(client.putCalls).toEqual([]);
    const errBody = JSON.parse(cap.stderrLines[0]);
    expect(errBody.error.code).toBe('CONFIRMATION_REQ');
  });
});
