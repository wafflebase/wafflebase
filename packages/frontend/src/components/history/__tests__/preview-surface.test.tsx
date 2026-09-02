import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PreviewSurface } from '../preview-surface';

describe('PreviewSurface', () => {
  // `RevisionPreview` is `absolute inset-0`, so what it covers is decided by
  // which ancestor is `position: relative`. The whole point of this
  // component is that the preview's positioned ancestor is the one holding
  // the editor's chrome as well as its canvas.
  it('makes the preview cover every child, chrome included', () => {
    render(
      <PreviewSurface preview={<div data-testid="preview" />}>
        <button type="button">Delete slide</button>
        <div data-testid="canvas" />
        <button type="button">Delete sheet</button>
      </PreviewSurface>,
    );

    const surface = screen.getByTestId('preview').parentElement;
    expect(surface).not.toBeNull();
    expect(surface!.className).toContain('relative');
    expect(surface).toContainElement(
      screen.getByRole('button', { name: 'Delete slide' }),
    );
    expect(surface).toContainElement(screen.getByTestId('canvas'));
    expect(surface).toContainElement(
      screen.getByRole('button', { name: 'Delete sheet' }),
    );
  });

  it('renders the preview after the children so it paints on top', () => {
    render(
      <PreviewSurface preview={<div data-testid="preview" />}>
        <div data-testid="canvas" />
      </PreviewSurface>,
    );
    const surface = screen.getByTestId('preview').parentElement!;
    expect(surface.lastElementChild).toBe(screen.getByTestId('preview'));
  });

  it('renders nothing extra when no preview is open', () => {
    render(
      <PreviewSurface>
        <div data-testid="canvas" />
      </PreviewSurface>,
    );
    expect(screen.getByTestId('canvas').parentElement!.childElementCount).toBe(1);
  });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../../app');

/**
 * Each wired editor's file, and the chrome that must sit *inside* its
 * preview surface. Before this was enforced, every one of these components
 * stayed live and clickable underneath an open preview: the overlay was
 * mounted beside the canvas alone, so the toolbar above it (slides, notes)
 * and the tab bar below it (sheets) still mutated the real document.
 *
 * `board-detail` is here for completeness — `BoardToolbar` is rendered by
 * `BoardView` itself, so board was already covered — and it pins that,
 * rather than leaving the one editor that happens to be correct unguarded.
 */
const WIRED_EDITORS: Array<{ file: string; chrome: string[] }> = [
  { file: 'slides/slides-detail.tsx', chrome: ['<SlidesToolbar', '<SlidesView'] },
  { file: 'notes/notes-detail.tsx', chrome: ['<NotesToolbar', '<NotesView'] },
  { file: 'documents/document-detail.tsx', chrome: ['<TabBar', '<SheetView'] },
  { file: 'board/board-detail.tsx', chrome: ['<BoardView'] },
];

describe('the preview surface of every wired editor', () => {
  it.each(WIRED_EDITORS)(
    '$file keeps its chrome inside the surface the preview covers',
    ({ file, chrome }) => {
      const source = readFileSync(path.join(appDir, file), 'utf8');

      const open = source.indexOf('<PreviewSurface');
      const close = source.indexOf('</PreviewSurface>');
      expect(open, `${file} does not use PreviewSurface`).toBeGreaterThan(-1);
      expect(close).toBeGreaterThan(open);

      // The overlay is the surface's `preview`, so it is declared inside the
      // opening tag — before the children it must cover.
      const overlay = source.indexOf('<RevisionPreviewOverlay');
      expect(overlay).toBeGreaterThan(open);
      expect(overlay).toBeLessThan(close);

      for (const tag of chrome) {
        const at = source.indexOf(tag);
        expect(at, `${file} renders no ${tag}`).toBeGreaterThan(-1);
        expect(
          at > open && at < close,
          `${file} renders ${tag} outside <PreviewSurface>, so an open ` +
            `preview leaves it live and clickable`,
        ).toBe(true);
      }
    },
  );
});
