import { writeFileSync, existsSync } from 'node:fs';
import {
  serializeMarkdown,
  serializeText,
  type Block,
  type Document,
} from '@wafflebase/docs';
import {
  flattenElements,
  type Element,
  type Slide,
  type SlidesDocument,
  type TextBody,
} from '@wafflebase/slides/node';

export const VALID_SLIDES_CONTENT_FORMATS = ['json', 'md', 'text'] as const;
export type SlidesContentFormat = (typeof VALID_SLIDES_CONTENT_FORMATS)[number];

export const SLIDES_LOSSY_NOTICE =
  'Lossy conversion: only text is extracted (shapes, images, connectors, ' +
  'layout, theming, and positioning are dropped). See cli.md for details.';

export function parseSlidesContentFormat(value: string): SlidesContentFormat {
  if (!VALID_SLIDES_CONTENT_FORMATS.includes(value as SlidesContentFormat)) {
    throw new Error(
      `Invalid --format "${value}". Use one of: ${VALID_SLIDES_CONTENT_FORMATS.join(', ')}.`,
    );
  }
  return value as SlidesContentFormat;
}

/**
 * Surface for `runSlidesContent` to talk back to the CLI without taking
 * a direct dependency on `process.stdout` / `process.stderr` / `fs`.
 * Mirrors `ContentIO` in `../docs/content.ts`; the command wires the
 * real implementations, tests inject in-memory collectors.
 */
export interface SlidesContentIO {
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  /** Write `text` to `path`. Throws if the file exists and `force` is false. */
  writeFile: (path: string, text: string, force: boolean) => void;
}

export const defaultSlidesContentIO: SlidesContentIO = {
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

export interface RunSlidesContentArgs {
  deck: SlidesDocument;
  format: SlidesContentFormat;
  /** Include speaker notes (`Slide.notes`) after each slide's body. */
  notes?: boolean;
  out?: string;
  force?: boolean;
  quiet?: boolean;
}

/**
 * Pure orchestration for `slides content`: takes an already-fetched
 * `SlidesDocument` plus user flags, produces the rendered output, and
 * routes it through the supplied IO surface.
 *
 * - `json`: the raw deck JSON (lossless — themes, layouts, geometry,
 *   styling all preserved).
 * - `md` / `text`: per-slide text extraction only. Slides have no single
 *   linear text stream, so we walk each slide's elements in document
 *   order, pull every `TextBody`'s blocks (text boxes, shape labels,
 *   table cells), and serialize them with the docs serializers. Shapes,
 *   images, connectors, positioning and theming are dropped.
 */
export function runSlidesContent(
  args: RunSlidesContentArgs,
  io: SlidesContentIO = defaultSlidesContentIO,
): void {
  const { deck, format, notes = false, out, force = false, quiet = false } = args;

  let text: string;
  if (format === 'json') {
    text = JSON.stringify(deck, null, 2);
  } else {
    if (!quiet) io.stderr(SLIDES_LOSSY_NOTICE);
    text = serializeDeck(deck, format, notes);
  }

  if (!out || out === '-') {
    io.stdout(text);
    return;
  }
  io.writeFile(out, text, force);
  if (!quiet) io.stderr(`Wrote to ${out}`);
}

/**
 * Render every slide as a `## Slide N` (md) / `Slide N` (text) section
 * followed by the slide's extracted text. Sections are joined with a
 * blank line so the stream reads as one document.
 */
function serializeDeck(
  deck: SlidesDocument,
  format: 'md' | 'text',
  notes: boolean,
): string {
  const sections = deck.slides.map((slide, i) =>
    serializeSlide(slide, i + 1, format, notes),
  );
  return sections.join('\n\n');
}

function serializeSlide(
  slide: Slide,
  number: number,
  format: 'md' | 'text',
  notes: boolean,
): string {
  const blocks = collectSlideBlocks(slide);
  const body = serializeBlocks(blocks, format);

  const parts: string[] = [];
  parts.push(format === 'md' ? `## Slide ${number}` : `Slide ${number}`);
  if (body.length > 0) parts.push(body);

  if (notes && slide.notes.length > 0) {
    const notesBody = serializeBlocks(slide.notes, format);
    if (notesBody.length > 0) {
      parts.push(format === 'md' ? '### Notes' : 'Notes:');
      parts.push(notesBody);
    }
  }

  return parts.join('\n\n');
}

/**
 * Collect every text block from a slide's elements, in document order.
 * Groups are flattened so nested text is included.
 */
function collectSlideBlocks(slide: Slide): Block[] {
  const blocks: Block[] = [];
  for (const el of flattenElements(slide.elements)) {
    for (const body of textBodiesOf(el)) {
      blocks.push(...body.blocks);
    }
  }
  return blocks;
}

/** Extract every `TextBody` carried by a single element. */
function textBodiesOf(el: Element): TextBody[] {
  switch (el.type) {
    case 'text':
      // `TextElement.data` is a `TextBody` (intersection with fill/stroke).
      return [el.data];
    case 'shape':
      return el.data.text ? [el.data.text] : [];
    case 'table':
      return el.data.rows.flatMap((row) => row.cells.map((cell) => cell.body));
    default:
      // image / connector carry no text; group is handled by flatten.
      return [];
  }
}

/**
 * Serialize a flat `Block[]` via the docs serializers by wrapping them
 * in a synthetic `Document`. The serializers read only `doc.blocks`
 * (header/footer are opt-in and never set here), so the cast is safe.
 */
function serializeBlocks(blocks: Block[], format: 'md' | 'text'): string {
  const doc: Document = { blocks };
  return format === 'md' ? serializeMarkdown(doc) : serializeText(doc);
}
