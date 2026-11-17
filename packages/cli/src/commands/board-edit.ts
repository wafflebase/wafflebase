import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { getGlobalOpts, getClient, getConfig } from './root.js';
import {
  output,
  outputError,
  parseOutputFormat,
  forwardUpstreamError,
} from '../output/formatter.js';
import { printDryRun } from '../client/dry-run.js';
import { seg } from '../client/url.js';
import type {
  ApiResponse,
  BoardElementSummary,
  HttpClient,
} from '../client/http-client.js';

/**
 * Granular board editing — the verbs an agent runs the AI half of a
 * brainstorm with: read the stickies, cluster them into sections, arrange,
 * write a summary. `board set-content` can already replace a whole board, but
 * that is a read-modify-write of every element that loses any concurrent
 * edit; each of these lands as one granular change on the server
 * (`api/v1/board.controller.ts`), with elements built by the canvas's own
 * factories.
 *
 * Every body is parsed BEFORE the dry-run branch, so a preview never shows a
 * request the server would reject for a reason visible here.
 */

const collect = (value: string, previous: string[]) => [...previous, value];

/** `--file <path>` contents, `-` meaning stdin. */
function readInput(path: string): string {
  return readFileSync(path === '-' ? 0 : path, 'utf-8');
}

function parseNumber(raw: string, flag: string): number {
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(n)) {
    throw new Error(`Invalid ${flag} "${raw}". Use a number.`);
  }
  return n;
}

function parsePositiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid ${flag} "${raw}". Use a positive integer.`);
  }
  return n;
}

/** `x,y` → `{ x, y }`. */
function parsePoint(raw: string, flag: string): { x: number; y: number } {
  const parts = raw.split(',');
  if (parts.length !== 2) throw new Error(`Invalid ${flag} "${raw}". Use x,y.`);
  return { x: parseNumber(parts[0], flag), y: parseNumber(parts[1], flag) };
}

/** `x,y,w,h` → a frame. */
function parseFrame(raw: string): { x: number; y: number; w: number; h: number } {
  const parts = raw.split(',');
  if (parts.length !== 4) throw new Error(`Invalid --frame "${raw}". Use x,y,w,h.`);
  const [x, y, w, h] = parts.map((p) => parseNumber(p, '--frame'));
  return { x, y, w, h };
}

/**
 * Run one board request: dry-run preview or the call, then print. Shared by
 * every verb below, which differ only in their method, path and body.
 */
async function send(
  cmd: Command,
  method: string,
  docId: string,
  path: string,
  body: unknown,
  call: (client: HttpClient) => Promise<ApiResponse<unknown>>,
) {
  const opts = getGlobalOpts(cmd);
  if (opts.dryRun) {
    printDryRun(getConfig(opts), method, `/documents/${seg(docId)}/board/${path}`, body);
    return;
  }
  const fmt = parseOutputFormat(opts.format);
  const res = await call(getClient(opts));
  if (!res.ok) return forwardUpstreamError(res, cmd);
  output(res.data, fmt);
}

/** One table / CSV row per element: the frame flattened, text on one line. */
function elementRow(el: BoardElementSummary): Record<string, unknown> {
  return {
    id: el.id,
    kind: el.kind,
    section: el.section ?? '',
    text: (el.title ?? el.text ?? '').replace(/\n/g, ' / '),
    color: el.color ?? '',
    x: Math.round(el.frame.x),
    y: Math.round(el.frame.y),
    w: Math.round(el.frame.w),
    h: Math.round(el.frame.h),
    votes: el.votes ?? '',
    author: el.author ?? '',
  };
}

export function registerBoardEditCommand(board: Command) {
  board
    .command('elements <doc-id>')
    .description(
      "List a board's elements: kind, plain text, colour, frame, section membership, stamps, votes",
    )
    .option('--kind <kind>', 'Only this kind (sticky, section, shape, freeform, text, connector, image, group)')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      const { kind } = this.opts<{ kind?: string }>();
      try {
        if (opts.dryRun) {
          printDryRun(getConfig(opts), 'GET', `/documents/${seg(docId)}/board/elements`);
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).listBoardElements(docId);
        if (!res.ok) return forwardUpstreamError(res, this);
        const elements = kind
          ? res.data.elements.filter((el) => el.kind === kind)
          : res.data.elements;
        // JSON / YAML keep the full summary an agent reasons over; a table
        // or CSV is for a person, so it gets one flat row per element.
        if (fmt === 'table' || fmt === 'csv') output(elements.map(elementRow), fmt);
        else output({ elements }, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  board
    .command('add-stickies <doc-id>')
    .description('Add stickies, laid out as a grid in free space (one per --text, or per line of --file)')
    .option('--text <text>', 'Sticky text (repeatable)', collect, [])
    .option('--file <path>', 'Read sticky texts from a file, one per line (- for stdin)')
    .option('--color <color>', 'yellow, green, blue, pink, orange, purple, or #RRGGBB')
    .option('--near <element-id>', 'Place the grid beside this element (default: beside the content)')
    .option('--columns <n>', 'Grid columns (default: near-square)')
    .action(async function (this: Command, docId: string) {
      const o = this.opts<{
        text: string[];
        file?: string;
        color?: string;
        near?: string;
        columns?: string;
      }>();
      try {
        const texts = [...o.text];
        if (o.file !== undefined) {
          texts.push(
            ...readInput(o.file)
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l.length > 0),
          );
        }
        if (texts.length === 0) {
          throw new Error('Give at least one --text, or a --file with one sticky per line.');
        }
        const body: Record<string, unknown> = { texts };
        if (o.color !== undefined) body.color = o.color;
        if (o.near !== undefined) body.near = o.near;
        if (o.columns !== undefined) body.columns = parsePositiveInt(o.columns, '--columns');
        await send(this, 'POST', docId, 'stickies', body, (c) =>
          c.addBoardStickies(docId, body),
        );
      } catch (e) {
        outputError(e, this);
      }
    });

  board
    .command('add-section <doc-id>')
    .description('Add a titled section around --ids (optionally laid out as a --grid), or at --frame')
    .requiredOption('--title <title>', 'Section title')
    .option('--ids <ids>', 'Comma-separated element ids to wrap')
    .option('--grid', 'Lay the --ids out as a grid in free space first, then wrap them')
    .option('--at <x,y>', 'Top-left of the section (with --grid, or for an empty section)')
    .option('--columns <n>', 'Grid columns (with --grid)')
    .option('--frame <x,y,w,h>', 'Fill this frame instead of wrapping elements')
    .option('--color <color>', 'gray, yellow, green, blue, pink, purple')
    .action(async function (this: Command, docId: string) {
      const o = this.opts<{
        title: string;
        ids?: string;
        grid?: boolean;
        at?: string;
        columns?: string;
        frame?: string;
        color?: string;
      }>();
      try {
        const body: Record<string, unknown> = { title: o.title };
        if (o.ids !== undefined) {
          body.elementIds = o.ids
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
        if (o.grid) {
          if (o.ids === undefined) throw new Error('--grid arranges --ids; give them.');
          body.layout = 'grid';
        }
        if (o.at !== undefined) body.at = parsePoint(o.at, '--at');
        if (o.columns !== undefined) body.columns = parsePositiveInt(o.columns, '--columns');
        if (o.frame !== undefined) body.frame = parseFrame(o.frame);
        if (o.color !== undefined) body.color = o.color;
        await send(this, 'POST', docId, 'sections', body, (c) =>
          c.addBoardSection(docId, body),
        );
      } catch (e) {
        outputError(e, this);
      }
    });

  board
    .command('move <doc-id>')
    .description('Move / resize elements from a JSON array of { id, x, y, w?, h? } (a moved section carries its contents)')
    .option('--file <path>', 'Read the moves from a JSON file (- for stdin)')
    .option('--data <json>', 'The moves as a JSON string')
    .action(async function (this: Command, docId: string) {
      const o = this.opts<{ file?: string; data?: string }>();
      try {
        if ((o.file === undefined) === (o.data === undefined)) {
          throw new Error('Give exactly one of --file <path> or --data <json>.');
        }
        const raw = o.data ?? readInput(o.file!);
        let moves: unknown;
        try {
          moves = JSON.parse(raw);
        } catch {
          throw new Error('The moves are not valid JSON.');
        }
        if (!Array.isArray(moves)) {
          throw new Error('The moves must be a JSON array of { id, x, y, w?, h? }.');
        }
        await send(this, 'PATCH', docId, 'elements', moves, (c) =>
          c.moveBoardElements(docId, moves),
        );
      } catch (e) {
        outputError(e, this);
      }
    });

  board
    .command('add-text <doc-id>')
    .description('Add a text box (a summary, a heading) at --x/--y, beside --near, or beside the content')
    .option('--text <text>', 'The text (newlines become paragraphs)')
    .option('--file <path>', 'Read the text from a file (- for stdin)')
    .option('--near <element-id>', 'Place it beside this element (a section, say)')
    .option('--side <side>', 'Which side of --near: right, left, below, above', 'right')
    .option('--x <x>', 'Top-left x')
    .option('--y <y>', 'Top-left y')
    .option('--width <w>', 'Box width (default: 400)')
    .option('--font-size <n>', 'Font size (default: 18)')
    .option('--bold', 'Bold text')
    .action(async function (this: Command, docId: string) {
      const o = this.opts<{
        text?: string;
        file?: string;
        near?: string;
        side: string;
        x?: string;
        y?: string;
        width?: string;
        fontSize?: string;
        bold?: boolean;
      }>();
      try {
        if ((o.text === undefined) === (o.file === undefined)) {
          throw new Error('Give exactly one of --text or --file.');
        }
        const text = (o.text ?? readInput(o.file!)).replace(/\s+$/, '');
        const body: Record<string, unknown> = { text };
        if ((o.x === undefined) !== (o.y === undefined)) {
          throw new Error('Give both --x and --y, or neither.');
        }
        if (o.x !== undefined) {
          body.x = parseNumber(o.x, '--x');
          body.y = parseNumber(o.y!, '--y');
        }
        if (o.near !== undefined) {
          body.near = o.near;
          body.side = o.side;
        }
        if (o.width !== undefined) body.w = parseNumber(o.width, '--width');
        if (o.fontSize !== undefined) body.fontSize = parseNumber(o.fontSize, '--font-size');
        if (o.bold) body.bold = true;
        await send(this, 'POST', docId, 'text', body, (c) => c.addBoardText(docId, body));
      } catch (e) {
        outputError(e, this);
      }
    });
}
