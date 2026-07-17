import { describe, it, expect, vi } from "vitest";
import { pickFiles } from "@/app/documents/pick-files";

describe("pickFiles", () => {
  it("resolves the selected files and sets multiple on the input", async () => {
    const clicks: HTMLInputElement[] = [];
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      clicks.push(this as HTMLInputElement);
    };
    const p = pickFiles(".xlsx,.pdf");
    const input = clicks[0];
    expect(input.multiple).toBe(true);
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1])], "a.xlsx")],
    });
    input.onchange?.(new Event("change"));
    const files = await p;
    expect(files.map((f) => f.name)).toEqual(["a.xlsx"]);
    HTMLInputElement.prototype.click = orig;
  });

  it("resolves to an empty array when the user cancels", async () => {
    vi.useFakeTimers();
    const clicks: HTMLInputElement[] = [];
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      clicks.push(this as HTMLInputElement);
    };
    const p = pickFiles(".docx");
    expect(clicks[0].accept).toBe(".docx");
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(300);
    const files = await p;
    expect(files).toEqual([]);
    HTMLInputElement.prototype.click = orig;
    vi.useRealTimers();
  });
});
