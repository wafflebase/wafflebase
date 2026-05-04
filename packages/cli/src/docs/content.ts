import { writeFileSync, existsSync } from 'node:fs';
import {
  serializeJson,
  serializeMarkdown,
  serializeText,
  type Document,
  type PaginatedLayout,
} from '@wafflebase/docs';
import { FontkitMeasurer } from './fontkit-measurer.js';
import { parsePageRange } from './page-range.js';
import { sliceBlocksByPages, type SliceFormat } from './page-slice.js';
import { paginateForCli } from './paginate.js';

export const VALID_CONTENT_FORMATS = ['json', 'md', 'text'] as const;
export type ContentFormat = (typeof VALID_CONTENT_FORMATS)[number];

export const LOSSY_NOTICE =
  'Lossy conversion: see docs-cli design for the exact mapping';

export const PAGES_FONT_WARNING =
  'Note: --pages uses approximate pagination (no document fonts loaded). ' +
  'Page boundaries may drift on CJK or font-heavy documents — ' +
  'use `docs export pdf --pages` for exact subsets.';

export function parseContentFormat(value: string): ContentFormat {
  if (!VALID_CONTENT_FORMATS.includes(value as ContentFormat)) {
    throw new Error(
      `Invalid --format "${value}". Use one of: ${VALID_CONTENT_FORMATS.join(', ')}.`,
    );
  }
  return value as ContentFormat;
}

/**
 * Surface for `runDocsContent` to talk back to the CLI without taking a
 * direct dependency on `process.stdout` / `process.stderr` / `fs`. The
 * command wires the real implementations; tests inject in-memory
 * collectors.
 */
export interface ContentIO {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  /** Write `text` to `path`. Throws if the file exists and `force` is false. */
  writeFile: (path: string, text: string, force: boolean) => void;
}

export const defaultIO: ContentIO = {
  stdout: (text) => {
    process.stdout.write(text);
    if (!text.endsWith('\n')) process.stdout.write('\n');
  },
  stderr: (line) => {
    console.error(line);
  },
  writeFile: (path, text, force) => {
    if (existsSync(path) && !force) {
      throw new Error(
        `Refusing to overwrite "${path}". Pass --force to allow overwrite.`,
      );
    }
    writeFileSync(path, text.endsWith('\n') ? text : text + '\n', 'utf-8');
  },
};

export interface RunContentArgs {
  doc: Document;
  format: ContentFormat;
  pages?: string;
  includeHeaderFooter?: boolean;
  inlineImages?: boolean;
  out?: string;
  force?: boolean;
  quiet?: boolean;
}

/**
 * Pure orchestration for `docs content`: takes an already-fetched
 * Document plus user flags, produces the rendered output, and routes it
 * through the supplied IO surface. Everything between the HTTP fetch
 * and the side-effecting IO lives here so it can be tested without
 * spawning the CLI binary.
 */
export function runDocsContent(args: RunContentArgs, io: ContentIO = defaultIO): void {
  const {
    format,
    pages,
    includeHeaderFooter = false,
    inlineImages = false,
    out,
    force = false,
    quiet = false,
  } = args;

  let working: Document = args.doc;
  let layout: PaginatedLayout | undefined;

  if (pages) {
    const measurer = new FontkitMeasurer();
    // `docs content --pages` paginates with a font-less measurer, so
    // every glyph falls back to the 0.5em estimate. That's accurate
    // enough for ASCII-heavy docs but underestimates CJK by ~50% and
    // mis-sizes narrow glyphs (`i`, `:`, `.`) — page boundaries can
    // drift by ±1 page on real documents. `docs export pdf` doesn't
    // suffer from this because PdfPainter does its own measurement at
    // paint time. Pre-loading document fonts here is tracked as a
    // follow-up; until then we surface the limitation on stderr.
    if (!quiet) {
      io.stderr(PAGES_FONT_WARNING);
    }
    const fullLayout = paginateForCli(working, measurer);
    const range = parsePageRange(pages, fullLayout.pages.length);
    if (!quiet) {
      for (const w of range.warnings) io.stderr(w);
    }
    const slice = sliceBlocksByPages(working, fullLayout, range, format as SliceFormat);
    working = { ...working, blocks: slice.blocks };
    layout = fullLayout;
  }

  if (format === 'md' && !quiet) {
    io.stderr(LOSSY_NOTICE);
  }

  let text: string;
  switch (format) {
    case 'json':
      text = JSON.stringify(serializeJson(working, layout), null, 2);
      break;
    case 'md':
      text = serializeMarkdown(working, { includeHeaderFooter, inlineImages });
      break;
    case 'text':
      text = serializeText(working, { includeHeaderFooter });
      break;
  }

  if (!out || out === '-') {
    io.stdout(text);
    return;
  }
  io.writeFile(out, text, force);
  if (!quiet) io.stderr(`Wrote to ${out}`);
}
