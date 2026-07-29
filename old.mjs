// original home
export function classifyResult(result) {
  const isQuota = /session limit|usage limit|quota/i.test(result.detail);
  return { retryable: !isQuota, detail: result.detail };
}
