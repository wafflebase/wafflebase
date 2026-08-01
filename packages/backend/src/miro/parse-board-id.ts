import { BadRequestException } from '@nestjs/common';

/** Matches the board id segment of a canonical Miro board *path*. */
const BOARD_PATH_RE = /^\/app\/(?:board|live-embed)\/([^/?#]+)/i;

/**
 * The host must really be Miro's, checked against a parsed `URL.hostname`
 * rather than by searching the raw string.
 *
 * DO NOT loosen this back into a substring/`includes` test. `miro.com` can
 * appear anywhere in an attacker-controlled URL — in the path
 * (`https://evil.com/miro.com/app/board/X`), in the userinfo
 * (`https://miro.com@evil.com/...`), or as a lookalike host
 * (`notmiro.com`, `miro.com.evil.net`) — and every one of those would hand us
 * a board id sourced from someone else's link. The suffix test carries the
 * leading dot on purpose so it matches real subdomains only.
 */
function isMiroHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'miro.com' || host.endsWith('.miro.com');
}

/**
 * Parse the input as a URL. Scheme-less pastes (`miro.com/app/board/<id>/`)
 * are common enough to keep accepting, so they get an https prefix; anything
 * that already carries a scheme keeps it, so `http://…` stays visible to the
 * protocol check rather than being silently upgraded.
 */
function toUrl(value: string): URL | null {
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
    return new URL(hasScheme ? value : `https://${value}`);
  } catch {
    return null;
  }
}

/**
 * `decodeURIComponent` throws a raw `URIError` on a malformed percent
 * sequence (e.g. `ab%zz`). Both call sites below take user input, so
 * translate that into the contracted `BadRequestException` rather than
 * letting it escape as a 500. The message stays generic — never echo the
 * caller's input back.
 */
function decodeOrReject(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new BadRequestException('Malformed Miro board id');
  }

  // Re-check AFTER decoding. Both call sites validate the ENCODED form — the
  // bare-id branch rejects `/` and whitespace, the URL branch takes a
  // `[^/?#]+` path segment — and `%2F` passes both, then decodes into a
  // delimiter that is spliced into the Miro request path. The caller
  // re-escapes with `encodeURIComponent`, so this is defence in depth rather
  // than the only guard, but a board id containing a delimiter or whitespace
  // is not a real id in the first place.
  if (!decoded || /[/\\\s]/.test(decoded)) {
    throw new BadRequestException('Malformed Miro board id');
  }
  return decoded;
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

  // A bare id: no scheme, no slashes, no spaces. Checked before the URL
  // parse because `toUrl` would otherwise read a bare id as a hostname.
  if (!/[/\s]/.test(trimmed) && !/^https?:/i.test(trimmed)) {
    return decodeOrReject(trimmed);
  }

  const url = toUrl(trimmed);
  if (
    url &&
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    isMiroHost(url.hostname)
  ) {
    // `URL` leaves percent sequences in `pathname` untouched, so `%3D` padding
    // still reaches `decodeOrReject` exactly as it did with the raw string.
    const match = BOARD_PATH_RE.exec(url.pathname);
    if (match) {
      return decodeOrReject(match[1]);
    }
  }

  throw new BadRequestException(
    'Expected a Miro board URL like https://miro.com/app/board/<id>/ or a bare board id',
  );
}
