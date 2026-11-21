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
