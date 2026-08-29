// @vitest-environment jsdom
/**
 * Markdown / plain-text export from the docs Export menu.
 *
 * Both serializers ship in `@wafflebase/docs` and are already what the CLI
 * prints; these tests pin the wiring the frontend adds — the filename, the
 * MIME type, and the serializer options the download (as opposed to a
 * terminal) wants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Document as DocsDocument } from '@wafflebase/docs';

const downloadBlob = vi.fn();

vi.mock('@/app/docs/export-utils', async () => {
  const actual = await vi.importActual<typeof import('@/app/docs/export-utils')>(
    '@/app/docs/export-utils',
  );
  return { ...actual, downloadBlob };
});

const { exportMarkdownAndDownload, exportTextAndDownload } = await import(
  '@/app/docs/text-actions'
);

const DOC: DocsDocument = {
  blocks: [
    {
      id: 'h',
      type: 'heading',
      headingLevel: 1,
      inlines: [{ text: 'Title', style: {} }],
      style: {},
    },
    {
      id: 'p',
      type: 'paragraph',
      inlines: [{ text: 'body text', style: { bold: true } }],
      style: {},
    },
  ],
} as unknown as DocsDocument;

async function lastBlob(): Promise<{ text: string; type: string; name: string }> {
  const [blob, name] = downloadBlob.mock.calls.at(-1) as [Blob, string];
  const text = new TextDecoder().decode(await blob.arrayBuffer());
  return { text, type: blob.type, name };
}

describe('docs text exports', () => {
  beforeEach(() => downloadBlob.mockClear());

  it('downloads Markdown as .md with a markdown MIME type', async () => {
    await exportMarkdownAndDownload(DOC, 'My Report');

    const { text, type, name } = await lastBlob();
    expect(name).toBe('My Report.md');
    expect(type).toBe('text/markdown;charset=utf-8');
    expect(text).toContain('# Title');
    expect(text).toContain('**body text**');
  });

  it('downloads plain text as .txt with no formatting', async () => {
    await exportTextAndDownload(DOC, 'My Report');

    const { text, type, name } = await lastBlob();
    expect(name).toBe('My Report.txt');
    expect(type).toBe('text/plain;charset=utf-8');
    expect(text).toBe('Title\nbody text');
  });

  it('never produces a bare dotfile from an empty title', async () => {
    await exportMarkdownAndDownload(DOC, '');
    expect((await lastBlob()).name).toBe('document.md');
  });

  it('does not double the extension when the title already carries it', async () => {
    await exportTextAndDownload(DOC, 'notes.txt');
    expect((await lastBlob()).name).toBe('notes.txt');
  });

  it('keeps a data: image source in the Markdown, unlike the terminal path', async () => {
    const withImage = {
      blocks: [
        {
          id: 'p',
          type: 'paragraph',
          inlines: [
            {
              text: '',
              style: { image: { src: 'data:image/png;base64,AAAA', width: 1, height: 1 } },
            },
          ],
          style: {},
        },
      ],
    } as unknown as DocsDocument;

    await exportMarkdownAndDownload(withImage, 'img');

    // The CLI defaults to the `[image]` placeholder because it prints to a
    // terminal; a downloaded .md is meant to render.
    expect((await lastBlob()).text).toContain('data:image/png;base64,AAAA');
  });
});
