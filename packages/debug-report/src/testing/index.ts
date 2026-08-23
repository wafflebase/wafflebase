/**
 * Helpers for testing a host's own wiring against this package.
 *
 * A SEPARATE ENTRY POINT (`@wafflebase/debug-report/testing`) rather than an
 * export from `/react`: these exist for tests and belong nowhere near the
 * surface a consumer ships. Wafflebase's engine-locator tests use them, and so
 * would any other host's.
 */

export * from './test-box';
