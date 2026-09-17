import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The property under test is not "Sentry works" — it is that Sentry is
 * **inert** unless a deployment configured it.
 *
 * That default is the reason a committed `packages/frontend/.env.production`
 * was removed from this repo: every fork and self-host that built with no
 * overrides silently addressed wafflebase's own backend, Yorkie project and
 * Google Analytics property. A DSN baked in as a default would restore exactly
 * that, with users' error reports and URLs as the payload. `VITE_GA_ID` is
 * guarded the same way in `vite.config.ts`.
 *
 * So the assertion is about `Sentry.init` never being CALLED, not about its
 * arguments: a call with a falsy dsn still installs global handlers and still
 * patches `fetch`.
 */
vi.mock("@sentry/react", () => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: "BrowserTracing" })),
}));

// Mutable, because the empty-origin case below is a distinct branch and a
// fixed non-empty mock would let a regression to `[""]` pass unnoticed.
let mockOrigin = "https://api.example.com";
vi.mock("@/api/images", () => ({
  backendOrigin: () => mockOrigin,
}));

async function loadWithDsn(dsn: string | undefined) {
  vi.resetModules();
  vi.stubEnv("VITE_SENTRY_DSN", dsn as string);
  const Sentry = await import("@sentry/react");
  const { initSentry } = await import("../src/sentry");
  return { Sentry, initSentry };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mockOrigin = "https://api.example.com";
});

describe("initSentry", () => {
  it("does not initialize the SDK when no DSN is configured", async () => {
    const { Sentry, initSentry } = await loadWithDsn("");
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("initializes with the DSN when one is configured", async () => {
    const { Sentry, initSentry } = await loadWithDsn("https://k@example/1");
    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.init).mock.calls[0][0]).toMatchObject({
      dsn: "https://k@example/1",
      sendDefaultPii: false,
    });
  });

  it("propagates trace headers to our own API origin and nowhere else", async () => {
    const { Sentry, initSentry } = await loadWithDsn("https://k@example/1");
    initSentry();
    // An empty-string entry would be a substring of every URL, which would
    // attach `sentry-trace`/`baggage` to third-party requests. See the note
    // in `sentry.ts` — `backendOrigin()` returns "" on a same-origin deploy.
    expect(
      vi.mocked(Sentry.init).mock.calls[0][0]?.tracePropagationTargets
    ).toEqual(["https://api.example.com"]);
  });

  it("omits trace targets entirely on a same-origin deployment", async () => {
    // `backendOrigin()` is "" when VITE_BACKEND_API_URL is unset. Sentry
    // matches these entries as SUBSTRINGS, and every URL contains "", so
    // `[""]` would attach sentry-trace/baggage to third-party requests —
    // a leak, not a no-op. Omitting the key falls back to the SDK default of
    // same-origin plus localhost.
    mockOrigin = "";
    const { Sentry, initSentry } = await loadWithDsn("https://k@example/1");
    initSentry();

    const options = vi.mocked(Sentry.init).mock.calls[0][0]!;
    expect(options.tracePropagationTargets).toBeUndefined();
    expect("tracePropagationTargets" in options).toBe(false);
  });

  it("never throws, so a broken SDK cannot stop the app from mounting", async () => {
    // `initSentry()` runs at module top level in `main.tsx`, before
    // `createRoot().render()` — outside the error boundary, and before it
    // exists. A throw escaping here means a blank page, which is worse than
    // the state before error tracking was added.
    const { Sentry, initSentry } = await loadWithDsn("https://k@example/1");
    vi.mocked(Sentry.init).mockImplementation(() => {
      throw new Error("integration blew up");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => initSentry()).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("falls back to the default sample rate rather than to 1.0 on a bad value", async () => {
    const { Sentry, initSentry } = await loadWithDsn("https://k@example/1");
    vi.stubEnv("VITE_SENTRY_TRACES_SAMPLE_RATE", "100");
    initSentry();
    expect(vi.mocked(Sentry.init).mock.calls[0][0]?.tracesSampleRate).toBe(0.1);
  });
});
