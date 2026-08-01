import { BadRequestException } from '@nestjs/common';

/** Matches the board id segment of a canonical Miro board URL. */
const BOARD_URL_RE = /miro\.com\/app\/(?:board|live-embed)\/([^/?#]+)/i;

/**
 * `decodeURIComponent` throws a raw `URIError` on a malformed percent
 * sequence (e.g. `ab%zz`). Both call sites below take user input, so
 * translate that into the contracted `BadRequestException` rather than
 * letting it escape as a 500. The message stays generic — never echo the
 * caller's input back.
 */
function decodeOrReject(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new BadRequestException('Malformed Miro board id');
  }
}

/**
 * Extract a Miro board id from a pasted board URL, or accept a bare id.
 *
 * Board ids are base64-ish and commonly end in `=`, which some systems
 * percent-encode to `%3D` when the link is copied around — decode it, since
 * the Miro API expects the raw `=` in the path.
 */
export function parseMiroBoardId(input: string): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    throw new BadRequestException('A Miro board URL or board id is required');
  }

  const match = BOARD_URL_RE.exec(trimmed);
  if (match) {
    return decodeOrReject(match[1]);
  }

  // A bare id: no scheme, no slashes, no spaces.
  if (!/[/\s]/.test(trimmed) && !/^https?:/i.test(trimmed)) {
    return decodeOrReject(trimmed);
  }

  throw new BadRequestException(
    'Expected a Miro board URL like https://miro.com/app/board/<id>/ or a bare board id',
  );
}
