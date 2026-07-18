import { describe, it, expect, vi, afterEach } from "vitest";
import { pickFiles } from "@/app/documents/pick-files";

describe("pickFiles", () => {
  // Restore mocked prototype methods and timers even if an assertion throws,
  // so a failing test can't leak polluted globals into later tests.
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("resolves the selected files and sets multiple on the input", async () => {
    const clicks: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      clicks.push(this);
    });
    const p = pickFiles(".xlsx,.pdf");
    const input = clicks[0];
    expect(input.multiple).toBe(true);
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1])], "a.xlsx")],
    });
    input.onchange?.(new Event("change"));
    const files = await p;
    expect(files.map((f) => f.name)).toEqual(["a.xlsx"]);
  });

  it("resolves to an empty array when the user cancels", async () => {
    vi.useFakeTimers();
    const clicks: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      clicks.push(this);
    });
    const p = pickFiles(".docx");
    expect(clicks[0].accept).toBe(".docx");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(300);
    const files = await p;
    expect(files).toEqual([]);
  });
});
