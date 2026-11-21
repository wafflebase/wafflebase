/**
 * The client's copy of the server's channel-name rule, so the dialog can say
 * what a name will become before it is submitted. The server normalizes and
 * validates again; this only spares a round trip.
 */
const CHANNEL_NAME_RE = /^[a-z0-9가-힣][a-z0-9가-힣_-]{0,79}$/;

export function normalizeChannelName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

export function validChannelName(name: string): boolean {
  return CHANNEL_NAME_RE.test(name);
}

/**
 * What to say under a channel-name field: the rule when the name breaks it,
 * what it will become when normalizing changes it, and the rule otherwise.
 * `verb` finishes "Will be … as #name" — "created" or "renamed".
 */
export function channelNameHint(
  raw: string,
  verb: "created" | "renamed",
): { text: string; invalid: boolean } {
  const normalized = normalizeChannelName(raw);
  if (raw.trim() !== "" && !validChannelName(normalized)) {
    return {
      text: "Use letters, numbers, - and _, starting with a letter or number.",
      invalid: true,
    };
  }
  if (normalized && normalized !== raw) {
    return { text: `Will be ${verb} as #${normalized}`, invalid: false };
  }
  return {
    text: "Lower-case, no spaces. Spaces become dashes.",
    invalid: false,
  };
}
