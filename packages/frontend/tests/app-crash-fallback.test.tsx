import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "@sentry/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppCrashFallback } from "../src/components/app-crash-fallback";

function Boom(): never {
  throw new Error("render exploded");
}

/** The rejection WebKit produces for a chunk that never loaded. */
function ChunkBoom(): never {
  throw new TypeError("Importing a module script failed.");
}

/**
 * The same shape `main.tsx` mounts: a render function, so the fallback can
 * tell a failed chunk load from a render throw.
 */
const fallback = ({ error }: { error: unknown }) => (
  <AppCrashFallback error={error} />
);

/**
 * React logs caught render errors to console.error regardless of the boundary.
 * Silenced so a passing test does not look like a failing one.
 */
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("root error boundary", () => {
  it("renders the fallback instead of unmounting the tree", () => {
    render(
      <ErrorBoundary fallback={fallback}>
        <Boom />
      </ErrorBoundary>
    );

    // The property that matters: the user sees something. Before this
    // boundary existed, a render throw left the page blank.
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary fallback={fallback}>
        <p>the app</p>
      </ErrorBoundary>
    );

    expect(screen.getByText("the app")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("names the cause when a chunk would not load", () => {
    // Getting here means `lazyWithRetry` already retried and, where it was
    // safe, reloaded. Telling this user to reload would be a false promise.
    render(
      <ErrorBoundary fallback={fallback}>
        <ChunkBoom />
      </ErrorBoundary>
    );

    expect(screen.getByText("Couldn't finish loading")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});
