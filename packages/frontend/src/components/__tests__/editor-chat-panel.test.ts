import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../app');

/**
 * Every document detail page offers the chat panel (chat.md § Chat panel —
 * in every editor): a provider wired to the page's right-slot state, the
 * header toggle, and the panel itself. The file viewers get all three from
 * `FileShell`.
 */
const EDITORS = [
  'documents/document-detail.tsx',
  'docs/docs-detail.tsx',
  'slides/slides-detail.tsx',
  'board/board-detail.tsx',
  'notes/notes-detail.tsx',
  'files/file-shell.tsx',
];

const read = (file: string) => readFileSync(path.join(appDir, file), 'utf8');

describe('editor chat panel', () => {
  it.each(EDITORS)('%s mounts the chat panel', (file) => {
    const source = read(file);
    expect(source.includes('<ChatPanelProvider'), `${file}: no ChatPanelProvider`).toBe(true);
    expect(source.includes('<LazyChatPanel'), `${file}: no chat panel`).toBe(true);
  });

  it.each(EDITORS.filter((f) => !f.startsWith('files/')))(
    '%s puts the Chat toggle in the header chat slot',
    (file) => {
      expect(/chat:\s*(\(|previewing \? null : )?\s*(<EditingChrome[^>]*>\s*)?<ChatPanelToggle/.test(read(file)), file).toBe(true);
    },
  );

  it.each([
    'documents/document-detail.tsx',
    'docs/docs-detail.tsx',
    'board/board-detail.tsx',
    'notes/notes-detail.tsx',
    'files/file-shell.tsx',
  ])('%s holds its panel flags in useRightPanels', (file) => {
    expect(read(file).includes('useRightPanels('), file).toBe(true);
  });
});
