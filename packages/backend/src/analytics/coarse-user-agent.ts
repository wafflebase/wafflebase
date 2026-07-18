/**
 * Reduce a full User-Agent string to a coarse browser family for privacy.
 * We never store the raw UA (fingerprintable) — only one of a small set.
 * Order matters: Edge/Chrome both contain "Chrome"; check Edge first.
 */
export function coarseUserAgent(ua?: string): string {
  if (!ua) return 'Other';
  if (/\bEdg\//.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/.test(ua)) return 'Opera';
  if (/\bChrome\//.test(ua)) return 'Chrome';
  if (/\bFirefox\//.test(ua)) return 'Firefox';
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return 'Safari';
  return 'Other';
}
