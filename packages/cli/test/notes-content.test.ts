import { describe, it, expect } from 'vitest';
import {
  parseNotesContentFormat,
  runNotesContent,
  type NotesContentIO,
} from '../src/notes/content.js';

interface Capture {
  stdout: string;
  stderr: string[];
  files: Record<string, string>;
  io: NotesContentIO;
}

function makeCapture(): Capture {
  const cap: Capture = {
    stdout: '',
    stderr: [],
    files: {},
    io: {
      stdout: (text) => {
        cap.stdout += text;
      },
      stderr: (line) => {
        cap.stderr.push(line);
      },
      writeFile: (path, text) => {
        cap.files[path] = text;
      },
    },
  };
  return cap;
}

describe('parseNotesContentFormat', () => {
  it('accepts json/md/text', () => {
    expect(parseNotesContentFormat('json')).toBe('json');
    expect(parseNotesContentFormat('md')).toBe('md');
    expect(parseNotesContentFormat('text')).toBe('text');
  });

  it('rejects anything else', () => {
    expect(() => parseNotesContentFormat('pdf')).toThrow(/Invalid --format/);
    expect(() => parseNotesContentFormat('')).toThrow(/Invalid --format/);
  });
});

describe('runNotesContent (json)', () => {
  it('emits the raw note JSON shape', () => {
    const cap = makeCapture();
    runNotesContent({ note: { content: '# Hello\n\nWorld' }, format: 'json' }, cap.io);
    const parsed = JSON.parse(cap.stdout);
    expect(parsed.content).toBe('# Hello\n\nWorld');
  });
});

describe('runNotesContent (md/text)', () => {
  it('emits the markdown string verbatim', () => {
    const cap = makeCapture();
    runNotesContent({ note: { content: '# Title\n\n- a\n- b' }, format: 'md' }, cap.io);
    expect(cap.stdout).toContain('# Title');
    expect(cap.stdout).toContain('- a');
    // No JSON wrapping.
    expect(cap.stdout.trim().startsWith('{')).toBe(false);
  });

  it('treats text identically to md (raw markdown)', () => {
    const cap = makeCapture();
    runNotesContent({ note: { content: 'plain body' }, format: 'text' }, cap.io);
    expect(cap.stdout.trim()).toBe('plain body');
  });

  it('handles empty content', () => {
    const cap = makeCapture();
    runNotesContent({ note: { content: '' }, format: 'md' }, cap.io);
    expect(cap.stdout.trim()).toBe('');
  });

  it('tolerates a null note body (empty 2xx response)', () => {
    const capMd = makeCapture();
    runNotesContent({ note: null, format: 'md' }, capMd.io);
    expect(capMd.stdout.trim()).toBe('');

    const capJson = makeCapture();
    runNotesContent({ note: undefined, format: 'json' }, capJson.io);
    expect(JSON.parse(capJson.stdout)).toEqual({ content: '' });
  });
});

describe('runNotesContent --out', () => {
  it('writes to the given file via the IO surface', () => {
    const cap = makeCapture();
    runNotesContent(
      { note: { content: '# Doc' }, format: 'md', out: 'note.md' },
      cap.io,
    );
    expect(cap.stdout).toBe('');
    expect(cap.files['note.md']).toContain('# Doc');
    expect(cap.stderr).toContain('Wrote to note.md');
  });

  it('passes the force flag through to writeFile', () => {
    const calls: Array<{ path: string; force: boolean }> = [];
    const io: NotesContentIO = {
      stdout: () => {},
      stderr: () => {},
      writeFile: (path, _text, force) => {
        calls.push({ path, force });
      },
    };
    runNotesContent({ note: { content: 'x' }, format: 'md', out: 'a.md' }, io);
    runNotesContent(
      { note: { content: 'x' }, format: 'md', out: 'a.md', force: true },
      io,
    );
    expect(calls).toEqual([
      { path: 'a.md', force: false },
      { path: 'a.md', force: true },
    ]);
  });

  it('treats "-" as stdout', () => {
    const cap = makeCapture();
    runNotesContent(
      { note: { content: 'hello' }, format: 'text', out: '-' },
      cap.io,
    );
    expect(cap.stdout).toContain('hello');
  });
});
