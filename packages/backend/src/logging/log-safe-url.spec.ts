import { logSafeUrl } from './log-safe-url';

/**
 * The access-log `req` serializer's redaction.
 *
 * `/auth` query strings carry single-use login material — the CLI's `nonce`
 * and PKCE `code_challenge` outbound, GitHub's `code` and `state` inbound —
 * and every 4xx there is logged at `warn`, so a miss here parks a replayable
 * login in a file operators, log shippers and agent harnesses all read. The
 * boundary cases are the whole control: it has to cover every spelling the
 * router accepts, and no more than that.
 */
describe('logSafeUrl', () => {
  it('replaces the query string of an /auth URL', () => {
    expect(logSafeUrl('/auth/github?mode=cli&nonce=n&code_challenge=c')).toBe(
      '/auth/github?<redacted>',
    );
    expect(logSafeUrl('/auth/github/callback?code=abc&state=xyz')).toBe(
      '/auth/github/callback?<redacted>',
    );
    expect(logSafeUrl('/auth?x=1')).toBe('/auth?<redacted>');
  });

  // Express's router is case-insensitive and matches the decoded path, so
  // these reach `AuthController` exactly as the lowercase spellings do. A
  // literal-prefix test would log their secrets in full.
  it('redacts the spellings the router accepts but the literal misses', () => {
    expect(logSafeUrl('/AUTH/github?nonce=n')).toBe('/AUTH/github?<redacted>');
    expect(logSafeUrl('/Auth/github/callback?code=abc')).toBe(
      '/Auth/github/callback?<redacted>',
    );
    expect(logSafeUrl('/%61uth/github?nonce=n')).toBe(
      '/%61uth/github?<redacted>',
    );
    expect(logSafeUrl('//auth/github?code=abc')).toBe(
      '//auth/github?<redacted>',
    );
  });

  it('keeps the query string everywhere else', () => {
    expect(logSafeUrl('/documents?folderId=1')).toBe('/documents?folderId=1');
    // `/authz` is a different path, not an `/auth` sub-route — its ordinary
    // parameters survive.
    expect(logSafeUrl('/authz?next=/x')).toBe('/authz?next=/x');
    expect(logSafeUrl('/api/v1/auth?x=1')).toBe('/api/v1/auth?x=1');
  });

  // `/auth` is not the only route that takes a credential on the query
  // string. A share-link `token` is the whole of an anonymous visitor's
  // access to a document, and the request that carries it is not under
  // `/auth`, so a path-only rule left it in the log verbatim.
  it('redacts a granting parameter outside /auth, keeping the rest', () => {
    expect(logSafeUrl('/documents/abc/file?token=s3cret')).toBe(
      '/documents/abc/file?token=<redacted>',
    );
    expect(logSafeUrl('/documents/abc/file?page=2&token=s3cret&zoom=1')).toBe(
      '/documents/abc/file?page=2&token=<redacted>&zoom=1',
    );
    // Query parameter names are case-insensitive to Express's consumers only
    // by convention, so match on the folded name.
    expect(logSafeUrl('/x?Token=s3cret&api_key=k')).toBe(
      '/x?Token=<redacted>&api_key=<redacted>',
    );
    // The name is kept — it is what makes the line worth reading.
    expect(logSafeUrl('/x?token')).toBe('/x?token');
  });

  it('passes through a URL with no query string unchanged', () => {
    expect(logSafeUrl('/auth/github')).toBe('/auth/github');
    expect(logSafeUrl('/health')).toBe('/health');
  });

  // pino calls the serializer with whatever is on the request object.
  it('passes through a non-string url', () => {
    expect(logSafeUrl(undefined)).toBeUndefined();
    expect(logSafeUrl(null)).toBeNull();
    expect(logSafeUrl(42)).toBe(42);
  });

  // A malformed escape cannot be decoded; redacting on the raw spelling
  // costs a query string in a log line, the alternative costs a login.
  it('still redacts an /auth path with a malformed percent escape', () => {
    expect(logSafeUrl('/auth/%zz?code=abc')).toBe('/auth/%zz?<redacted>');
  });
});
