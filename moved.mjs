export function classifyResult(result) {
  const isQuota = /session limit|usage limit|quota/i.test(result.detail);
  return { retryable: !isQuota, detail: result.detail };
}
export function brandNewHelper(x) { return String(x).padStart(12, '0'); }
validateSessionToken(request) is deprecated
