import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createSession, type DebugItem } from "../index";
import { __resetRehydrateForTests, useDebugSession } from "./use-debug-session";

/**
 * These cover the two ways a session could silently lose reports, both of which
 * shipped in the first draft of this hook:
 *
 *   - the rehydrate never ran under StrictMode, which — since this overlay is
 *     DEV-only — meant it never ran at all;
 *   - a session emptied by the reporter was never written, so the next load
 *     restored the items they had deleted.
 */

const META_KEY = "wb.debug-report.session";

const item = (id: string): DebugItem => ({
  id,
  createdAt: 1,
  note: `note ${id}`,
  target: { kind: "viewport", rect: { x: 0, y: 0, w: 10, h: 10 } },
  disposition: "verify",
  agentCandidate: false,
});

function seed(items: DebugItem[]): void {
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ schema: 1, sessionId: "previous", savedAt: 1, items }),
  );
}

function persisted(): DebugItem[] | undefined {
  const raw = localStorage.getItem(META_KEY);
  return raw ? (JSON.parse(raw).items as DebugItem[]) : undefined;
}

beforeEach(() => {
  localStorage.clear();
  __resetRehydrateForTests();
});

afterEach(() => {
  localStorage.clear();
  __resetRehydrateForTests();
});

function Probe({ session }: { session: ReturnType<typeof createSession> }) {
  const view = useDebugSession(session);
  return (
    <div>
      <span data-testid="count">{view.items.length}</span>
      <span data-testid="notes">{view.items.map((i) => i.note).join(",")}</span>
      <span data-testid="persistent">{String(view.persistent)}</span>
      <span data-testid="dropped">{view.droppedCaptures.join(",")}</span>
    </div>
  );
}

describe("useDebugSession", () => {
  it("rehydrates a persisted session under StrictMode", async () => {
    // The overlay is DEV-only, so StrictMode's mount/unmount/remount is the
    // ONLY environment it runs in: a rehydrate that loses this race never runs.
    seed([item("a"), item("b")]);
    const session = createSession();
    render(
      <StrictMode>
        <Probe session={session} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"));
    expect(screen.getByTestId("notes").textContent).toBe("note a,note b");
  });

  it("does not swallow a report made while the read was in flight", async () => {
    seed([item("old")]);
    const session = createSession();
    session.add({
      note: "made just now",
      target: { kind: "viewport", rect: { x: 0, y: 0, w: 1, h: 1 } },
    });
    render(<Probe session={session} />);
    // `persistent` is false in jsdom regardless — there is no IndexedDB — so
    // the thing to wait for is the list itself.
    await waitFor(() =>
      expect(screen.getByTestId("notes").textContent).toBe("made just now"),
    );
    expect(screen.getByTestId("count").textContent).toBe("1");
  });

  it("reports the captures that were already gone", async () => {
    const withCapture: DebugItem = {
      ...item("a"),
      capture: { id: "cap-gone", w: 10, h: 10, bytes: 100, layers: 1, mime: "image/jpeg" },
    };
    seed([withCapture]);
    const session = createSession();
    render(<Probe session={session} />);
    // The blob store is empty (jsdom has no IndexedDB, so it is in-memory and
    // fresh), so the restored item's image cannot be there.
    await waitFor(() => expect(screen.getByTestId("dropped").textContent).toBe("a"));
  });

  it("persists a session emptied by the reporter, instead of resurrecting it", async () => {
    const session = createSession();
    render(<Probe session={session} />);
    session.add({
      note: "first",
      target: { kind: "viewport", rect: { x: 0, y: 0, w: 1, h: 1 } },
    });
    await waitFor(() => expect(persisted()).toHaveLength(1));

    session.clear();
    // Guarding the write on a non-empty list meant this never wrote, so the next
    // page load restored the item the reporter had just deleted.
    await waitFor(() => expect(persisted()).toEqual([]));
  });

  it("says persistence failed when the browser refuses to store metadata", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("site data blocked");
      },
    });
    try {
      __resetRehydrateForTests();
      const session = createSession();
      render(<Probe session={session} />);
      session.add({
        note: "will not survive",
        target: { kind: "viewport", rect: { x: 0, y: 0, w: 1, h: 1 } },
      });
      await waitFor(() =>
        expect(screen.getByTestId("persistent").textContent).toBe("false"),
      );
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
      __resetRehydrateForTests();
    }
  });
});
