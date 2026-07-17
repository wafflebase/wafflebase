import { coarseUserAgent } from './coarse-user-agent';

describe('coarseUserAgent', () => {
  it('maps Chrome UA to "Chrome"', () => {
    expect(
      coarseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      ),
    ).toBe('Chrome');
  });
  it('maps Safari UA (no Chrome token) to "Safari"', () => {
    expect(
      coarseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/17 Safari/605',
      ),
    ).toBe('Safari');
  });
  it('returns "Other" for unknown/empty', () => {
    expect(coarseUserAgent(undefined)).toBe('Other');
    expect(coarseUserAgent('curl/8.0')).toBe('Other');
  });
});
