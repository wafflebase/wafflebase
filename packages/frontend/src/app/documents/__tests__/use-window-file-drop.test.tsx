import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { useWindowFileDrop } from "@/app/documents/use-window-file-drop";

function Probe({ onFiles }: { onFiles: (f: File[]) => void }) {
  const dragging = useWindowFileDrop(onFiles);
  return <div data-testid="state">{dragging ? "on" : "off"}</div>;
}

/** Dispatch a window drag event carrying a jsdom-friendly fake dataTransfer. */
function fireDrag(type: string, opts: { files?: File[]; hasFiles?: boolean }) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", {
    value: {
      types: opts.hasFiles === false ? [] : ["Files"],
      files: opts.files ?? [],
    },
  });
  act(() => {
    window.dispatchEvent(e);
  });
  return e;
}

afterEach(() => cleanup());

describe("useWindowFileDrop", () => {
  it("turns on for a file dragenter and off on the matching dragleave", () => {
    render(<Probe onFiles={() => {}} />);
    expect(screen.getByTestId("state").textContent).toBe("off");

    fireDrag("dragenter", {});
    expect(screen.getByTestId("state").textContent).toBe("on");

    fireDrag("dragleave", {});
    expect(screen.getByTestId("state").textContent).toBe("off");
  });

  it("ignores non-file drags", () => {
    render(<Probe onFiles={() => {}} />);
    fireDrag("dragenter", { hasFiles: false });
    expect(screen.getByTestId("state").textContent).toBe("off");
  });

  it("delivers files and clears on drop, preventing default", () => {
    const onFiles = vi.fn();
    render(<Probe onFiles={onFiles} />);
    fireDrag("dragenter", {});

    const file = new File([new Uint8Array([1])], "a.xlsx");
    const dropEvt = fireDrag("drop", { files: [file] });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual([
      "a.xlsx",
    ]);
    expect(dropEvt.defaultPrevented).toBe(true);
    expect(screen.getByTestId("state").textContent).toBe("off");
  });

  it("force-clears the overlay on Escape when no dragleave fires", () => {
    render(<Probe onFiles={() => {}} />);
    fireDrag("dragenter", {});
    expect(screen.getByTestId("state").textContent).toBe("on");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.getByTestId("state").textContent).toBe("off");
  });

  it("does not flicker off when the pointer crosses nested children", () => {
    render(<Probe onFiles={() => {}} />);
    // enter outer, enter inner child (depth 2), leave inner (depth 1) — still on
    fireDrag("dragenter", {});
    fireDrag("dragenter", {});
    fireDrag("dragleave", {});
    expect(screen.getByTestId("state").textContent).toBe("on");
    fireDrag("dragleave", {});
    expect(screen.getByTestId("state").textContent).toBe("off");
  });
});
