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
import { registerBoardSetContentCommand } from './content-write.js';

/**
 * `board` — the infinite-canvas document type.
 *
 * Only content read and write live here, because that is what was missing:
 * the content endpoint accepted `doc` / `slides` / `note` and rejected a
 * board, so a board document could be created and copied but never read or
 * edited without a browser. Listing, renaming and deleting a board are the
 * type-agnostic `docs` commands, which have always worked on one.
 *
 * A board's content is one flat `elements` array in world coordinates — there
 * are no slides, layouts or masters. The elements themselves are the slides
 * engine's own shapes, since a board is "one unbounded slide".
 */
export function registerBoardCommand(program: Command) {
  const board = program
    .command('board')
    .alias('boards')
    .description('Read and write board (infinite canvas) content');

  board
    .command('content <doc-id>')
    .description('Read board content as JSON')
    .action(async function (this: Command, docId: string) {
      const opts = getGlobalOpts(this);
      try {
        // Inside the try: the preview path is built from an id and `seg()`
        // refuses a `.` / `..` one, so that refusal has to reach
        // `outputError` as the error envelope rather than escape the handler.
        if (opts.dryRun) {
          printDryRun(
            getConfig(opts),
            'GET',
            `/documents/${seg(docId)}/content`,
          );
          return;
        }
        const fmt = parseOutputFormat(opts.format);
        const res = await getClient(opts).getBoardContent(docId);
        if (!res.ok) return forwardUpstreamError(res, this);
        output(res.data, fmt);
      } catch (e) {
        outputError(e, this);
      }
    });

  registerBoardSetContentCommand(board);
}
