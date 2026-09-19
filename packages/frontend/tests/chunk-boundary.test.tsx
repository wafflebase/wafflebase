import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

const captureException = vi.fn();
vi.mock("@sentry/react", async () => {
  const actual =
    await vi.importActual<typeof import("@sentry/react")>("@sentry/react");
  return {
    ...actual,
    captureException: (...args: unknown[]) => captureException(...args),
  };
});

import { ErrorBoundary } from "@sentry/react";
import { ChunkBoundary } from "@/components/chunk-boundary";

function ChunkBoom(): never {
  throw new TypeError("Importing a module script failed.");
}

function RealBug(): never {
  throw new TypeError("cannot read properties of undefined");
}

/** React logs every caught render error regardless of the boundary. */
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  toastError.mockClear();
  captureException.mockClear();
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("ChunkBoundary", () => {
  it("renders its children when nothing fails", () => {
    render(
      <ChunkBoundary>
        <p>the panel</p>
      </ChunkBoundary>,
    );

    expect(screen.getByText("the panel")).toBeTruthy();
  });

  it("contains a failed chunk instead of unmounting the editor", () => {
    // The property that matters. Before this boundary existed, the only
    // `ErrorBoundary` was the root one, so a side panel whose chunk would not
    // download replaced the whole document with a crash page.
    render(
      <div>
        <p>the editor</p>
        <ChunkBoundary label="The history panel">
          <ChunkBoom />
        </ChunkBoundary>
      </div>,
    );

    expect(screen.getByText("the editor")).toBeTruthy();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain("The history panel");
  });

  it("reports the contained failure", () => {
    render(
      <ChunkBoundary>
        <ChunkBoom />
      </ChunkBoundary>,
    );

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, options] = captureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, string> },
    ];
    expect(options.tags.chunk_recovery).toBe("contained");
  });

  it("renders nothing where the panel would have been", () => {
    const { container } = render(
      <ChunkBoundary>
        <ChunkBoom />
      </ChunkBoundary>,
    );

    expect(container.textContent).toBe("");
  });

  it("lets a real bug through to the boundary above it", () => {
    // A module that loaded and then threw is not a download problem. Turning
    // it into a toast would hide a crash and leave a blank panel behind.
    render(
      <ErrorBoundary fallback={<p>root fallback</p>}>
        <ChunkBoundary>
          <RealBug />
        </ChunkBoundary>
      </ErrorBoundary>,
    );

    expect(screen.getByText("root fallback")).toBeTruthy();
    expect(toastError).not.toHaveBeenCalled();
  });
});
